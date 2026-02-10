import { promises as fs } from 'node:fs';
import path from 'node:path';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import type { CodexRunner } from '../src/services/promptExecution';
import { createGameFixture, createTempDirectory } from './testHelpers';

type CapturedRun = {
  prompt: string;
  cwd: string;
};

class CapturingRunner implements CodexRunner {
  public readonly calls: CapturedRun[] = [];

  async run(prompt: string, cwd: string): Promise<void> {
    this.calls.push({ prompt, cwd });
  }
}

class ControlledRunner implements CodexRunner {
  public readonly calls: CapturedRun[] = [];
  private readonly pendingRuns: Array<{
    resolve: () => void;
    reject: (error: Error) => void;
  }> = [];

  async run(prompt: string, cwd: string): Promise<void> {
    this.calls.push({ prompt, cwd });
    await new Promise<void>((resolve, reject) => {
      this.pendingRuns.push({
        resolve,
        reject: (error: Error) => {
          reject(error);
        }
      });
    });
  }

  completeNext(): void {
    const nextRun = this.pendingRuns.shift();
    if (!nextRun) {
      throw new Error('No pending runs to resolve');
    }

    nextRun.resolve();
  }

  failNext(error: Error): void {
    const nextRun = this.pendingRuns.shift();
    if (!nextRun) {
      throw new Error('No pending runs to reject');
    }

    nextRun.reject(error);
  }
}

function waitForNextTick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('express app integration', () => {
  it('renders homepage in reverse chronological order and re-reads versions each request', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-home-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    await fs.mkdir(gamesRootPath, { recursive: true });

    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'older',
        parentId: null,
        createdTime: '2026-01-01T00:00:00.000Z'
      }
    });

    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'newer',
        parentId: 'older',
        createdTime: '2026-02-01T00:00:00.000Z'
      }
    });

    const app = createApp({
      gamesRootPath,
      buildPromptPath: path.join(process.cwd(), 'game-build-prompt.md')
    });

    const homepage = await request(app).get('/').expect(200);
    const newerIndex = homepage.text.indexOf('data-version-id="newer"');
    const olderIndex = homepage.text.indexOf('data-version-id="older"');
    expect(newerIndex).toBeGreaterThan(-1);
    expect(olderIndex).toBeGreaterThan(newerIndex);

    const css = await request(app).get('/public/styles.css').expect(200);
    expect(css.text).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));');

    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'newest',
        parentId: 'newer',
        createdTime: '2026-03-01T00:00:00.000Z'
      }
    });

    const refreshedHomepage = await request(app).get('/').expect(200);
    expect(refreshedHomepage.text).toContain('data-version-id="newest"');
  });

  it('renders game view with edit button and slide-down prompt controls', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-game-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    await fs.mkdir(gamesRootPath, { recursive: true });

    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'v1',
        parentId: null,
        createdTime: '2026-02-01T00:00:00.000Z'
      }
    });

    const app = createApp({
      gamesRootPath,
      buildPromptPath: path.join(process.cwd(), 'game-build-prompt.md')
    });

    const gameView = await request(app).get('/game/v1').expect(200);
    expect(gameView.text).toContain('id="edit-button"');
    expect(gameView.text).toContain('✏️');
    expect(gameView.text).toContain('id="prompt-panel"');
    expect(gameView.text).toContain('id="prompt-close"');
    expect(gameView.text).toContain('id="prompt-status"');
    expect(gameView.text).toContain('×');
  });

  it('forks before launching codex prompt execution and returns immediately', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-prompt-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    await fs.mkdir(gamesRootPath, { recursive: true });

    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'source',
        parentId: null,
        createdTime: '2026-02-01T00:00:00.000Z'
      }
    });

    const buildPromptPath = path.join(tempDirectoryPath, 'game-build-prompt.md');
    await fs.writeFile(buildPromptPath, 'BASE PROMPT\n', 'utf8');

    const codexRunner = new CapturingRunner();
    const app = createApp({
      gamesRootPath,
      buildPromptPath,
      codexRunner
    });

    const userPrompt = 'line 1\n"quoted"\nline 3';
    const response = await request(app)
      .post('/api/games/source/prompts')
      .send({ prompt: userPrompt })
      .set('Content-Type', 'application/json')
      .expect(202);

    expect(typeof response.body.forkId).toBe('string');
    expect(typeof response.body.statusUrl).toBe('string');

    const forkId = response.body.forkId as string;
    const forkMetadataPath = path.join(gamesRootPath, forkId, 'metadata.json');
    const forkMetadataText = await fs.readFile(forkMetadataPath, 'utf8');
    const forkMetadata = JSON.parse(forkMetadataText) as {
      id: string;
      parentId: string | null;
      createdTime: string;
    };

    expect(forkMetadata.id).toBe(forkId);
    expect(forkMetadata.parentId).toBe('source');

    expect(codexRunner.calls).toHaveLength(1);
    expect(codexRunner.calls[0]?.cwd).toBe(path.join(gamesRootPath, forkId));
    expect(codexRunner.calls[0]?.prompt).toBe(`BASE PROMPT\n\n${userPrompt}`);

    const statusResponse = await request(app).get(response.body.statusUrl).expect(200);
    expect(['running', 'succeeded']).toContain(statusResponse.body.state);
  });

  it('reports prompt status transitions from running to succeeded', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-status-success-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    await fs.mkdir(gamesRootPath, { recursive: true });

    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'source',
        parentId: null,
        createdTime: '2026-02-01T00:00:00.000Z'
      }
    });

    const buildPromptPath = path.join(tempDirectoryPath, 'game-build-prompt.md');
    await fs.writeFile(buildPromptPath, 'BASE PROMPT\n', 'utf8');

    const codexRunner = new ControlledRunner();
    const app = createApp({
      gamesRootPath,
      buildPromptPath,
      codexRunner,
      logError: () => {}
    });

    const response = await request(app)
      .post('/api/games/source/prompts')
      .send({ prompt: 'turn blue' })
      .set('Content-Type', 'application/json')
      .expect(202);

    const statusUrl = response.body.statusUrl as string;
    const runningStatus = await request(app).get(statusUrl).expect(200);
    expect(runningStatus.body.state).toBe('running');
    expect(runningStatus.body.error).toBeNull();
    expect(runningStatus.body.completedTime).toBeNull();

    codexRunner.completeNext();
    await waitForNextTick();

    const succeededStatus = await request(app).get(statusUrl).expect(200);
    expect(succeededStatus.body.state).toBe('succeeded');
    expect(succeededStatus.body.error).toBeNull();
    expect(typeof succeededStatus.body.completedTime).toBe('string');
  });

  it('reports prompt status failures with error text', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-status-failure-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    await fs.mkdir(gamesRootPath, { recursive: true });

    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'source',
        parentId: null,
        createdTime: '2026-02-01T00:00:00.000Z'
      }
    });

    const buildPromptPath = path.join(tempDirectoryPath, 'game-build-prompt.md');
    await fs.writeFile(buildPromptPath, 'BASE PROMPT\n', 'utf8');

    const codexRunner = new ControlledRunner();
    const app = createApp({
      gamesRootPath,
      buildPromptPath,
      codexRunner,
      logError: () => {}
    });

    const response = await request(app)
      .post('/api/games/source/prompts')
      .send({ prompt: 'turn blue' })
      .set('Content-Type', 'application/json')
      .expect(202);

    const statusUrl = response.body.statusUrl as string;
    codexRunner.failNext(new Error('codex exploded'));
    await waitForNextTick();

    const failedStatus = await request(app).get(statusUrl).expect(200);
    expect(failedStatus.body.state).toBe('failed');
    expect(failedStatus.body.error).toContain('codex exploded');
    expect(typeof failedStatus.body.completedTime).toBe('string');
  });
});
