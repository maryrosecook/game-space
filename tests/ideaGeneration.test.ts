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

async function waitForSpawnCallCount(spawnStub: ReturnType<typeof vi.fn>, count: number): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (spawnStub.mock.calls.length >= count) {
      return;
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }

  throw new Error(`Expected spawn to be called ${count} times`);
}

describe('generateIdeaPrompt', () => {
  const originalIdeationModel = process.env.IDEATION_MODEL;
  const originalCodegenClaudeModel = process.env.CODEGEN_CLAUDE_MODEL;

  beforeEach(() => {
    delete process.env.IDEATION_MODEL;
    delete process.env.CODEGEN_CLAUDE_MODEL;
  });

  afterEach(() => {
    if (typeof originalIdeationModel === 'string') {
      process.env.IDEATION_MODEL = originalIdeationModel;
    } else {
      delete process.env.IDEATION_MODEL;
    }

    if (typeof originalCodegenClaudeModel === 'string') {
      process.env.CODEGEN_CLAUDE_MODEL = originalCodegenClaudeModel;
    } else {
      delete process.env.CODEGEN_CLAUDE_MODEL;
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
    expect(serializedPrompt).toContain('Base game context for this ideation run:');
    expect(serializedPrompt).toContain('- id: sparkle-zone');
    expect(serializedPrompt).toContain('- label: sparkle zone game');
    expect(serializedPrompt).toContain('- creation prompt: existing base prompt');
    expect(serializedPrompt).toContain('Fast balls and particle trails.');
    expect(serializedPrompt).not.toContain('Ignore this part.');
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
    spawnedProcess.processEmitter.emit('error', new Error('spawn claude EACCES'));

    await expect(generationPromise).rejects.toThrow('claude ideation command failed: spawn claude EACCES');
  });


  it('falls back to codex when claude executable is unavailable', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-idea-generation-fallback-codex-');
    const buildPromptPath = path.join(tempDirectoryPath, 'game-build-prompt.md');
    const ideationPromptPath = path.join(tempDirectoryPath, 'ideation.md');

    await fs.writeFile(buildPromptPath, 'BASE PROMPT\n', 'utf8');
    await fs.writeFile(ideationPromptPath, 'IDEATE\n', 'utf8');

    const claudeAttempt = createMockSpawnedProcess();
    const codexAttempt = createMockSpawnedProcess();
    const spawnStub = vi
      .fn()
      .mockImplementationOnce(() => claudeAttempt.processEmitter)
      .mockImplementationOnce(() => codexAttempt.processEmitter);

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
      spawnStub as unknown as IdeationSpawnProcess
    );

    await waitForSpawnCall(spawnStub);
    claudeAttempt.processEmitter.emit('error', new Error('spawn claude ENOENT'));
    await waitForSpawnCallCount(spawnStub, 2);
    codexAttempt.stdout.write(
      JSON.stringify({
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'codex-generated fallback idea' }]
        }
      }) + '\n'
    );
    codexAttempt.processEmitter.emit('close', 0);

    await expect(generationPromise).resolves.toBe('codex-generated fallback idea');

    expect(spawnStub).toHaveBeenCalledTimes(2);
    const firstCommand = spawnStub.mock.calls[0]?.[0] as string;
    const secondCommand = spawnStub.mock.calls[1]?.[0] as string;
    expect(firstCommand).toBe('claude');
    expect(secondCommand).toBe('codex');
  });

  it('retries with CODEGEN_CLAUDE_MODEL when the primary ideation model fails for model access', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-idea-generation-fallback-model-');
    const buildPromptPath = path.join(tempDirectoryPath, 'game-build-prompt.md');
    const ideationPromptPath = path.join(tempDirectoryPath, 'ideation.md');

    await fs.writeFile(buildPromptPath, 'BASE PROMPT\n', 'utf8');
    await fs.writeFile(ideationPromptPath, 'IDEATE\n', 'utf8');

    process.env.IDEATION_MODEL = 'opus';
    process.env.CODEGEN_CLAUDE_MODEL = 'claude-sonnet-4-6';

    const firstAttempt = createMockSpawnedProcess();
    const secondAttempt = createMockSpawnedProcess();
    const spawnStub = vi
      .fn()
      .mockImplementationOnce(() => firstAttempt.processEmitter)
      .mockImplementationOnce(() => secondAttempt.processEmitter);

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
      spawnStub as unknown as IdeationSpawnProcess
    );

    await waitForSpawnCall(spawnStub);
    firstAttempt.stderr.write('does not have access to model opus');
    firstAttempt.processEmitter.emit('close', 1);
    await waitForSpawnCallCount(spawnStub, 2);
    secondAttempt.stdout.write('fallback idea text');
    secondAttempt.processEmitter.emit('close', 0);

    await expect(generationPromise).resolves.toBe('fallback idea text');
    expect(spawnStub).toHaveBeenCalledTimes(2);
    const firstArgs = spawnStub.mock.calls[0]?.[1] as string[];
    const secondArgs = spawnStub.mock.calls[1]?.[1] as string[];
    expect(firstArgs).toContain('opus');
    expect(secondArgs).toContain('claude-sonnet-4-6');
  });
});
