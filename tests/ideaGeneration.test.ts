import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import { PassThrough } from 'node:stream';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { generateIdeaPrompt, type IdeationSpawnProcess } from '../src/services/ideaGeneration';
import { createTempDirectory } from './testHelpers';

type MockSpawnedProcess = EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  stdin: PassThrough;
  kill: ReturnType<typeof vi.fn>;
};

function createMockSpawnedProcess() {
  const processEmitter = new EventEmitter() as MockSpawnedProcess;
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();
  const kill = vi.fn(() => true);

  processEmitter.stdout = stdout;
  processEmitter.stderr = stderr;
  processEmitter.stdin = stdin;
  processEmitter.kill = kill;

  let stdinText = '';
  stdin.setEncoding('utf8');
  stdin.on('data', (chunk: string) => {
    stdinText += chunk;
  });

  return {
    processEmitter,
    stdout,
    stderr,
    kill,
    readStdinText() {
      return stdinText;
    }
  };
}

function spawnStubFor(processEmitter: MockSpawnedProcess): ReturnType<typeof vi.fn> {
  return vi.fn<IdeationSpawnProcess>(() => processEmitter as never);
}

async function waitForSpawnCall(spawnStub: ReturnType<typeof vi.fn>): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (spawnStub.mock.calls.length > 0) {
      return;
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }

  throw new Error('Expected spawn to be called');
}


describe('generateIdeaPrompt', () => {
  const originalIdeationModel = process.env.IDEATION_MODEL;
  const originalClaudeCliPath = process.env.CLAUDE_CLI_PATH;

  beforeEach(() => {
    delete process.env.IDEATION_MODEL;
    delete process.env.CLAUDE_CLI_PATH;
  });

  afterEach(() => {
    if (typeof originalIdeationModel === 'string') {
      process.env.IDEATION_MODEL = originalIdeationModel;
    } else {
      delete process.env.IDEATION_MODEL;
    }

    if (typeof originalClaudeCliPath === 'string') {
      process.env.CLAUDE_CLI_PATH = originalClaudeCliPath;
    } else {
      delete process.env.CLAUDE_CLI_PATH;
    }
  });

  it('invokes claude with single-turn max-thinking prompt and includes base-game context', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-idea-generation-');
    const buildPromptPath = path.join(tempDirectoryPath, 'game-build-prompt.md');
    const ideationPromptPath = path.join(tempDirectoryPath, 'ideation.md');

    await fs.writeFile(buildPromptPath, 'BASE PROMPT\n', 'utf8');
    await fs.writeFile(ideationPromptPath, 'IDEATE\n', 'utf8');

    const spawnedProcess = createMockSpawnedProcess();
    const spawnStub = spawnStubFor(spawnedProcess.processEmitter);

    const generationPromise = generateIdeaPrompt(
      buildPromptPath,
      ideationPromptPath,
      tempDirectoryPath,
      {
        id: 'sparkle-zone',
        label: 'sparkle zone game',
        prompt: 'existing base prompt',
        readme: '# Starter\n\n## The Game\nFast balls and particle trails.\n\n## Scope\nIgnore this part.'
      },
      undefined,
      spawnStub
    );

    await waitForSpawnCall(spawnStub);
    spawnedProcess.stdout.write('  Build a neon arena paddle duel with touch lane swaps.  ');
    spawnedProcess.processEmitter.emit('close', 0);

    await expect(generationPromise).resolves.toBe('Build a neon arena paddle duel with touch lane swaps.');

    expect(spawnStub).toHaveBeenCalledTimes(1);
    const [command, args, options] = spawnStub.mock.calls[0] as [string, string[], { cwd: string }];
    expect(command).toBe('claude');
    expect(args).toContain('--print');
    expect(args).toContain('--dangerously-skip-permissions');
    expect(args).toContain('--model');
    expect(args).toContain('opus');
    expect(args).toContain('--append-system-prompt');
    expect(options.cwd).toBe(tempDirectoryPath);

    const serializedPrompt = spawnedProcess.readStdinText();
    expect(serializedPrompt).toContain('BASE PROMPT');
    expect(serializedPrompt).toContain('IDEATE');
    expect(serializedPrompt).toContain('Because the base game is not starter, propose exactly one meaningful mechanics change that makes the gameplay more compelling or meaningfully better.');
    expect(serializedPrompt).toContain('Base game context for this ideation run:');
    expect(serializedPrompt).toContain('- id: sparkle-zone');
    expect(serializedPrompt).toContain('- label: sparkle zone game');
    expect(serializedPrompt).toContain('- creation prompt: existing base prompt');
    expect(serializedPrompt).toContain('Fast balls and particle trails.');
    expect(serializedPrompt).not.toContain('Ignore this part.');
  });


  it('adds a starter-specific ideation directive when starter is the selected base game', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-idea-generation-starter-directive-');
    const buildPromptPath = path.join(tempDirectoryPath, 'game-build-prompt.md');
    const ideationPromptPath = path.join(tempDirectoryPath, 'ideation.md');

    await fs.writeFile(buildPromptPath, 'BASE PROMPT\n', 'utf8');
    await fs.writeFile(ideationPromptPath, 'IDEATE\n', 'utf8');

    const spawnedProcess = createMockSpawnedProcess();
    const spawnStub = spawnStubFor(spawnedProcess.processEmitter);

    const generationPromise = generateIdeaPrompt(
      buildPromptPath,
      ideationPromptPath,
      tempDirectoryPath,
      {
        id: 'starter',
        label: 'starter',
        prompt: null,
        readme: null
      },
      undefined,
      spawnStub
    );

    await waitForSpawnCall(spawnStub);
    spawnedProcess.stdout.write('starter idea');
    spawnedProcess.processEmitter.emit('close', 0);

    await expect(generationPromise).resolves.toBe('starter idea');

    const serializedPrompt = spawnedProcess.readStdinText();
    expect(serializedPrompt).toContain(
      'Because the base game is starter, propose a fully fleshed-out game concept that includes a core loop, player input, win/loss conditions, player instructions, and a concrete art style.'
    );
  });

  it('aborts the running claude ideation command when the signal aborts', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-idea-generation-abort-');
    const buildPromptPath = path.join(tempDirectoryPath, 'game-build-prompt.md');
    const ideationPromptPath = path.join(tempDirectoryPath, 'ideation.md');

    await fs.writeFile(buildPromptPath, 'BASE PROMPT\n', 'utf8');
    await fs.writeFile(ideationPromptPath, 'IDEATE\n', 'utf8');

    const spawnedProcess = createMockSpawnedProcess();
    const spawnStub = spawnStubFor(spawnedProcess.processEmitter);

    const abortController = new AbortController();
    const generationPromise = generateIdeaPrompt(
      buildPromptPath,
      ideationPromptPath,
      tempDirectoryPath,
      {
        id: 'starter',
        label: 'starter',
        prompt: null,
        readme: null
      },
      abortController.signal,
      spawnStub
    );

    abortController.abort();

    await expect(generationPromise).rejects.toThrow('claude ideation command aborted');
    expect(spawnedProcess.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('includes stderr details when the ideation command fails', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-idea-generation-failure-');
    const buildPromptPath = path.join(tempDirectoryPath, 'game-build-prompt.md');
    const ideationPromptPath = path.join(tempDirectoryPath, 'ideation.md');

    await fs.writeFile(buildPromptPath, 'BASE PROMPT\n', 'utf8');
    await fs.writeFile(ideationPromptPath, 'IDEATE\n', 'utf8');

    const spawnedProcess = createMockSpawnedProcess();
    const spawnStub = spawnStubFor(spawnedProcess.processEmitter);

    const generationPromise = generateIdeaPrompt(
      buildPromptPath,
      ideationPromptPath,
      tempDirectoryPath,
      {
        id: 'starter',
        label: 'starter',
        prompt: null,
        readme: null
      },
      undefined,
      spawnStub
    );

    await waitForSpawnCall(spawnStub);
    spawnedProcess.stderr.write('simulated error output');
    spawnedProcess.processEmitter.emit('close', 1);

    await expect(generationPromise).rejects.toThrow(
      'claude ideation command failed with exit code 1: simulated error output'
    );
  });

  it('includes stdout details when stderr is empty', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-idea-generation-stdout-failure-');
    const buildPromptPath = path.join(tempDirectoryPath, 'game-build-prompt.md');
    const ideationPromptPath = path.join(tempDirectoryPath, 'ideation.md');

    await fs.writeFile(buildPromptPath, 'BASE PROMPT\n', 'utf8');
    await fs.writeFile(ideationPromptPath, 'IDEATE\n', 'utf8');

    const spawnedProcess = createMockSpawnedProcess();
    const spawnStub = spawnStubFor(spawnedProcess.processEmitter);

    const generationPromise = generateIdeaPrompt(
      buildPromptPath,
      ideationPromptPath,
      tempDirectoryPath,
      {
        id: 'starter',
        label: 'starter',
        prompt: null,
        readme: null
      },
      undefined,
      spawnStub
    );

    await waitForSpawnCall(spawnStub);
    spawnedProcess.stdout.write('Please run /login');
    spawnedProcess.processEmitter.emit('close', 1);

    await expect(generationPromise).rejects.toThrow(
      'claude ideation command failed with exit code 1: Please run /login'
    );
  });


  it('normalizes spawn errors to claude ideation failure messages', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-idea-generation-spawn-error-');
    const buildPromptPath = path.join(tempDirectoryPath, 'game-build-prompt.md');
    const ideationPromptPath = path.join(tempDirectoryPath, 'ideation.md');

    await fs.writeFile(buildPromptPath, 'BASE PROMPT\n', 'utf8');
    await fs.writeFile(ideationPromptPath, 'IDEATE\n', 'utf8');

    const spawnedProcess = createMockSpawnedProcess();
    const spawnStub = spawnStubFor(spawnedProcess.processEmitter);

    const generationPromise = generateIdeaPrompt(
      buildPromptPath,
      ideationPromptPath,
      tempDirectoryPath,
      {
        id: 'starter',
        label: 'starter',
        prompt: null,
        readme: null
      },
      undefined,
      spawnStub
    );

    await waitForSpawnCall(spawnStub);
    spawnedProcess.processEmitter.emit('error', new Error('spawn claude ENOENT'));

    await expect(generationPromise).rejects.toThrow('claude ideation command failed: spawn claude ENOENT');
  });

  it('uses CLAUDE_CLI_PATH when provided', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-idea-generation-cli-override-');
    const buildPromptPath = path.join(tempDirectoryPath, 'game-build-prompt.md');
    const ideationPromptPath = path.join(tempDirectoryPath, 'ideation.md');

    await fs.writeFile(buildPromptPath, 'BASE PROMPT\n', 'utf8');
    await fs.writeFile(ideationPromptPath, 'IDEATE\n', 'utf8');

    process.env.CLAUDE_CLI_PATH = '/custom/bin/claude';

    const spawnedProcess = createMockSpawnedProcess();
    const spawnStub = spawnStubFor(spawnedProcess.processEmitter);

    const generationPromise = generateIdeaPrompt(
      buildPromptPath,
      ideationPromptPath,
      tempDirectoryPath,
      {
        id: 'starter',
        label: 'starter',
        prompt: null,
        readme: null
      },
      undefined,
      spawnStub
    );

    await waitForSpawnCall(spawnStub);
    spawnedProcess.stdout.write('idea from override path');
    spawnedProcess.processEmitter.emit('close', 0);

    await expect(generationPromise).resolves.toBe('idea from override path');
    expect(spawnStub).toHaveBeenCalledTimes(1);
    expect(spawnStub.mock.calls[0]?.[0]).toBe('/custom/bin/claude');
  });
});
