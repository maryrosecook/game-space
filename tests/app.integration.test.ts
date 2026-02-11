import { promises as fs } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app';
import type { CodexRunOptions, CodexRunResult, CodexRunner } from '../src/services/promptExecution';
import { createGameFixture, createTempDirectory } from './testHelpers';

type CapturedRun = {
  prompt: string;
  cwd: string;
};

class CapturingRunner implements CodexRunner {
  public readonly calls: CapturedRun[] = [];
  private readonly sessionId: string | null;

  constructor(sessionId: string | null = null) {
    this.sessionId = sessionId;
  }

  async run(prompt: string, cwd: string, options?: CodexRunOptions): Promise<CodexRunResult> {
    void options;
    this.calls.push({ prompt, cwd });
    return {
      sessionId: this.sessionId,
      success: true,
      failureMessage: null
    };
  }
}

class FailingRunner implements CodexRunner {
  private readonly sessionId: string | null;

  constructor(sessionId: string | null = null) {
    this.sessionId = sessionId;
  }

  async run(prompt: string, cwd: string, options?: CodexRunOptions): Promise<CodexRunResult> {
    void prompt;
    void cwd;
    void options;
    return {
      sessionId: this.sessionId,
      success: false,
      failureMessage: 'codex exec failed with exit code 1: approval denied'
    };
  }
}

class SessionCallbackOnlyRunner implements CodexRunner {
  private readonly sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  async run(prompt: string, cwd: string, options?: CodexRunOptions): Promise<CodexRunResult> {
    void prompt;
    void cwd;
    options?.onSessionId?.(this.sessionId);

    return new Promise<CodexRunResult>(() => {
      // Simulate a long-running codex process that has started but not exited yet.
    });
  }
}

type StoredMetadata = {
  id: string;
  parentId: string | null;
  createdTime: string;
  codexSessionId?: string | null;
};

async function readMetadata(metadataPath: string): Promise<StoredMetadata> {
  const serialized = await fs.readFile(metadataPath, 'utf8');
  return JSON.parse(serialized) as StoredMetadata;
}

async function waitForSessionId(metadataPath: string, expectedSessionId: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const metadata = await readMetadata(metadataPath);
    if (metadata.codexSessionId === expectedSessionId) {
      return;
    }

    await delay(5);
  }

  throw new Error(`Session id ${expectedSessionId} was not persisted in time`);
}

async function waitForErrorLog(loggedErrors: readonly string[], expectedMessagePart: string): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (loggedErrors.some((message) => message.includes(expectedMessagePart))) {
      return;
    }

    await delay(5);
  }

  throw new Error(`Expected log containing "${expectedMessagePart}" was not emitted in time`);
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
    expect(homepage.text).not.toContain('Choose any version to play.');
    const newerIndex = homepage.text.indexOf('data-version-id="newer"');
    const olderIndex = homepage.text.indexOf('data-version-id="older"');
    expect(newerIndex).toBeGreaterThan(-1);
    expect(olderIndex).toBeGreaterThan(newerIndex);

    const css = await request(app).get('/public/styles.css').expect(200);
    expect(css.text).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));');
    expect(css.text).toContain('--render-aspect-width: 9;');
    expect(css.text).toContain('width: min(100vw, calc(100vh * var(--render-aspect-width) / var(--render-aspect-height)));');

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
    expect(gameView.text).toContain('class="game-stage"');
    expect(gameView.text).toContain('class="game-render-area"');
    expect(gameView.text).toContain('id="edit-button"');
    expect(gameView.text).toContain('✏️');
    expect(gameView.text).toContain('id="prompt-panel"');
    expect(gameView.text).toContain('id="prompt-close"');
    expect(gameView.text).toContain('×');
    expect(gameView.text).not.toContain('/public/game-live-reload.js');
  });

  it('injects live reload script into game view when enabled', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-game-live-reload-');
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
      buildPromptPath: path.join(process.cwd(), 'game-build-prompt.md'),
      enableGameLiveReload: true
    });

    const gameView = await request(app).get('/game/v1').expect(200);
    expect(gameView.text).toContain('/public/game-live-reload.js');
  });

  it('renders codex page with a version selector', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-codex-page-');
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

    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'v2',
        parentId: 'v1',
        createdTime: '2026-02-02T00:00:00.000Z'
      }
    });

    const app = createApp({
      gamesRootPath,
      buildPromptPath: path.join(process.cwd(), 'game-build-prompt.md')
    });

    const codexPage = await request(app).get('/codex').expect(200);
    expect(codexPage.text).toContain('id="codex-game-select"');
    expect(codexPage.text).toContain('<option value="v1">');
    expect(codexPage.text).toContain('<option value="v2">');
    expect(codexPage.text).toContain('/public/codex-view.js');
  });

  it('returns transcript data for a game linked to a codex session id', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-codex-api-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    const codexSessionsRootPath = path.join(tempDirectoryPath, 'codex-sessions');
    await fs.mkdir(gamesRootPath, { recursive: true });

    const sessionId = '019c48a7-3918-7123-bc60-0d7cddb4d5d4';
    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'v1',
        parentId: null,
        createdTime: '2026-02-01T00:00:00.000Z',
        codexSessionId: sessionId
      }
    });

    const sessionDirectoryPath = path.join(codexSessionsRootPath, '2026', '02', '10');
    await fs.mkdir(sessionDirectoryPath, { recursive: true });
    await fs.writeFile(
      path.join(sessionDirectoryPath, `rollout-2026-02-10T10-00-00-${sessionId}.jsonl`),
      [
        '{"timestamp":"2026-02-10T10:00:00.000Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"add gravity"}]}}',
        '{"timestamp":"2026-02-10T10:00:01.000Z","type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Adding gravity now."}]}}'
      ].join('\n'),
      'utf8'
    );

    const app = createApp({
      gamesRootPath,
      codexSessionsRootPath,
      buildPromptPath: path.join(process.cwd(), 'game-build-prompt.md')
    });

    const response = await request(app).get('/api/codex-sessions/v1').expect(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.sessionId).toBe(sessionId);
    expect(response.body.messages).toEqual([
      {
        role: 'user',
        text: 'add gravity',
        timestamp: '2026-02-10T10:00:00.000Z'
      },
      {
        role: 'assistant',
        text: 'Adding gravity now.',
        timestamp: '2026-02-10T10:00:01.000Z'
      }
    ]);
  });

  it('returns no-session status when metadata has no linked codex session', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-codex-none-');
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

    const response = await request(app).get('/api/codex-sessions/v1').expect(200);
    expect(response.body).toEqual({
      status: 'no-session',
      versionId: 'v1'
    });
  });

  it('returns session-file-missing when metadata references a missing session file', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-codex-missing-file-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    const codexSessionsRootPath = path.join(tempDirectoryPath, 'codex-sessions');
    await fs.mkdir(gamesRootPath, { recursive: true });
    await fs.mkdir(codexSessionsRootPath, { recursive: true });

    const sessionId = '019c48a7-3918-7123-bc60-0d7cddb4d5d4';
    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'v1',
        parentId: null,
        createdTime: '2026-02-01T00:00:00.000Z',
        codexSessionId: sessionId
      }
    });

    const app = createApp({
      gamesRootPath,
      codexSessionsRootPath,
      buildPromptPath: path.join(process.cwd(), 'game-build-prompt.md')
    });

    const response = await request(app).get('/api/codex-sessions/v1').expect(200);
    expect(response.body).toEqual({
      status: 'session-file-missing',
      versionId: 'v1',
      sessionId
    });
  });

  it('forks before launching codex prompt execution, returns immediately, and stores session id', async () => {
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

    const persistedSessionId = '019c48a7-3918-7123-bc60-0d7cddb4d5d4';
    const codexRunner = new CapturingRunner(persistedSessionId);
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

    const forkId = response.body.forkId as string;
    expect(forkId).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);

    expect(codexRunner.calls).toHaveLength(1);
    expect(codexRunner.calls[0]?.cwd).toBe(path.join(gamesRootPath, forkId));
    expect(codexRunner.calls[0]?.prompt).toBe(`BASE PROMPT\n\n${userPrompt}`);

    const forkMetadataPath = path.join(gamesRootPath, forkId, 'metadata.json');
    await waitForSessionId(forkMetadataPath, persistedSessionId);

    const forkMetadata = await readMetadata(forkMetadataPath);
    expect(forkMetadata.id).toBe(forkId);
    expect(forkMetadata.parentId).toBe('source');
    expect(forkMetadata.codexSessionId).toBe(persistedSessionId);
  });

  it('stores session id and logs failure when codex run returns unsuccessful result', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-prompt-failure-');
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

    const persistedSessionId = '019c48a7-3918-7123-bc60-0d7cddb4d5d4';
    const loggedErrors: string[] = [];
    const app = createApp({
      gamesRootPath,
      buildPromptPath,
      codexRunner: new FailingRunner(persistedSessionId),
      logError: (message: string) => {
        loggedErrors.push(message);
      }
    });

    const response = await request(app)
      .post('/api/games/source/prompts')
      .send({ prompt: 'try to change movement' })
      .set('Content-Type', 'application/json')
      .expect(202);

    const forkId = response.body.forkId as string;
    const forkMetadataPath = path.join(gamesRootPath, forkId, 'metadata.json');
    await waitForSessionId(forkMetadataPath, persistedSessionId);
    await waitForErrorLog(loggedErrors, `codex exec failed for ${forkId}`);

    const forkMetadata = await readMetadata(forkMetadataPath);
    expect(forkMetadata.codexSessionId).toBe(persistedSessionId);
  });

  it('stores session id immediately when runner emits it before completion', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-app-prompt-early-session-');
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

    const emittedSessionId = '019c49ae-107f-7790-8634-176d6ce7df3b';
    const app = createApp({
      gamesRootPath,
      buildPromptPath,
      codexRunner: new SessionCallbackOnlyRunner(emittedSessionId)
    });

    const response = await request(app)
      .post('/api/games/source/prompts')
      .send({ prompt: 'darken the ball fill color' })
      .set('Content-Type', 'application/json')
      .expect(202);

    const forkId = response.body.forkId as string;
    const forkMetadataPath = path.join(gamesRootPath, forkId, 'metadata.json');
    await waitForSessionId(forkMetadataPath, emittedSessionId);

    const forkMetadata = await readMetadata(forkMetadataPath);
    expect(forkMetadata.codexSessionId).toBe(emittedSessionId);
  });
});
