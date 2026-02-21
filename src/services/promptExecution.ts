import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';

import { isObjectRecord } from './fsUtils';
import { readCodegenConfigFromEnv, type CodegenConfig } from './codegenConfig';

export type CodexRunResult = {
  sessionId: string | null;
  success: boolean;
  failureMessage: string | null;
};

export type CodexRunOptions = {
  onSessionId?: (sessionId: string) => void;
};

export interface CodexRunner {
  run(prompt: string, cwd: string, options?: CodexRunOptions): Promise<CodexRunResult>;
}

export function parseSessionIdFromCodexEventLine(serializedEventLine: string): string | null {
  let rawEvent: unknown;
  try {
    rawEvent = JSON.parse(serializedEventLine) as unknown;
  } catch {
    return null;
  }

  if (!isObjectRecord(rawEvent) || typeof rawEvent.type !== 'string') {
    return null;
  }

  const claudeSessionId = rawEvent.session_id;
  if (typeof claudeSessionId === 'string' && claudeSessionId.length > 0) {
    return claudeSessionId;
  }

  const claudeSessionIdCamelCase = rawEvent.sessionId;
  if (typeof claudeSessionIdCamelCase === 'string' && claudeSessionIdCamelCase.length > 0) {
    return claudeSessionIdCamelCase;
  }

  if (rawEvent.type === 'thread.started') {
    const threadId = rawEvent.thread_id;
    return typeof threadId === 'string' && threadId.length > 0 ? threadId : null;
  }

  if (rawEvent.type !== 'session_meta' || !('payload' in rawEvent)) {
    return null;
  }

  const payload = rawEvent.payload;
  if (!isObjectRecord(payload) || typeof payload.id !== 'string' || payload.id.length === 0) {
    return null;
  }

  return payload.id;
}

function maybeCaptureSessionId(
  serializedEventLine: string,
  currentSessionId: string | null
): string | null {
  if (currentSessionId) {
    return currentSessionId;
  }

  return parseSessionIdFromCodexEventLine(serializedEventLine);
}

function notifySessionId(onSessionId: ((sessionId: string) => void) | undefined, sessionId: string): void {
  if (!onSessionId) {
    return;
  }

  try {
    onSessionId(sessionId);
  } catch {
    // Session callback should never terminate prompt execution.
  }
}

function drainStdoutLines(
  bufferedOutput: string,
  currentSessionId: string | null,
  onSessionId: ((sessionId: string) => void) | undefined
): { remainingOutput: string; sessionId: string | null } {
  let output = bufferedOutput;
  let sessionId = currentSessionId;

  for (;;) {
    const newlineIndex = output.indexOf('\n');
    if (newlineIndex === -1) {
      return {
        remainingOutput: output,
        sessionId
      };
    }

    const line = output.slice(0, newlineIndex).trim();
    if (line.length > 0) {
      const nextSessionId = maybeCaptureSessionId(line, sessionId);
      if (!sessionId && nextSessionId) {
        notifySessionId(onSessionId, nextSessionId);
      }

      sessionId = nextSessionId;
    }

    output = output.slice(newlineIndex + 1);
  }
}

export class SpawnCodexRunner implements CodexRunner {
  async run(prompt: string, cwd: string, options: CodexRunOptions = {}): Promise<CodexRunResult> {
    return new Promise<CodexRunResult>((resolve, reject) => {
      const { onSessionId } = options;
      const childProcess = spawn('codex', ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', '-'], {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let errorOutput = '';
      let stdoutBuffer = '';
      let sessionId: string | null = null;

      childProcess.stdout.setEncoding('utf8');
      childProcess.stdout.on('data', (chunk: string) => {
        stdoutBuffer += chunk;
        const drained = drainStdoutLines(stdoutBuffer, sessionId, onSessionId);
        stdoutBuffer = drained.remainingOutput;
        sessionId = drained.sessionId;
      });

      childProcess.stderr.setEncoding('utf8');
      childProcess.stderr.on('data', (chunk: string) => {
        errorOutput += chunk;
      });

      childProcess.on('error', (error) => {
        reject(error);
      });

      childProcess.on('close', (exitCode) => {
        const finalLine = stdoutBuffer.trim();
        if (finalLine.length > 0) {
          const nextSessionId = maybeCaptureSessionId(finalLine, sessionId);
          if (!sessionId && nextSessionId) {
            notifySessionId(onSessionId, nextSessionId);
          }

          sessionId = nextSessionId;
        }

        if (exitCode === 0) {
          resolve({
            sessionId,
            success: true,
            failureMessage: null
          });
          return;
        }

        const details = errorOutput.trim().length > 0 ? `: ${errorOutput.trim()}` : '';
        resolve({
          sessionId,
          success: false,
          failureMessage: `codex exec failed with exit code ${exitCode ?? 'unknown'}${details}`
        });
      });

      childProcess.stdin.end(prompt);
    });
  }
}

type SpawnClaudeRunnerOptions = {
  model: string;
  thinking: string;
};

function buildClaudeRunnerArgs(model: string, thinking: string, sessionId: string): string[] {
  const args: string[] = [
    '--verbose',
    '--print',
    '--output-format',
    'stream-json',
    '--dangerously-skip-permissions',
    '--model',
    model,
    '--session-id',
    sessionId
  ];

  if (thinking.trim().length > 0) {
    args.push(
      '--append-system-prompt',
      `Use ${thinking.trim()} thinking mode while preserving complete and correct output.`
    );
  }

  return args;
}

export class SpawnClaudeRunner implements CodexRunner {
  private readonly model: string;
  private readonly thinking: string;

  constructor(options: SpawnClaudeRunnerOptions) {
    this.model = options.model;
    this.thinking = options.thinking;
  }

  async run(prompt: string, cwd: string, options: CodexRunOptions = {}): Promise<CodexRunResult> {
    return new Promise<CodexRunResult>((resolve, reject) => {
      const { onSessionId } = options;
      const generatedSessionId = randomUUID();
      notifySessionId(onSessionId, generatedSessionId);
      const args = buildClaudeRunnerArgs(this.model, this.thinking, generatedSessionId);
      const childProcess = spawn('claude', args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let errorOutput = '';
      let stdoutBuffer = '';
      let sessionId: string | null = generatedSessionId;

      childProcess.stdout.setEncoding('utf8');
      childProcess.stdout.on('data', (chunk: string) => {
        stdoutBuffer += chunk;
        const drained = drainStdoutLines(stdoutBuffer, sessionId, onSessionId);
        stdoutBuffer = drained.remainingOutput;
        sessionId = drained.sessionId;
      });

      childProcess.stderr.setEncoding('utf8');
      childProcess.stderr.on('data', (chunk: string) => {
        errorOutput += chunk;
      });

      childProcess.on('error', (error) => {
        reject(error);
      });

      childProcess.on('close', (exitCode) => {
        const finalLine = stdoutBuffer.trim();
        if (finalLine.length > 0) {
          const nextSessionId = maybeCaptureSessionId(finalLine, sessionId);
          if (!sessionId && nextSessionId) {
            notifySessionId(onSessionId, nextSessionId);
          }

          sessionId = nextSessionId;
        }

        if (exitCode === 0) {
          resolve({
            sessionId,
            success: true,
            failureMessage: null
          });
          return;
        }

        const details = errorOutput.trim().length > 0 ? `: ${errorOutput.trim()}` : '';
        resolve({
          sessionId,
          success: false,
          failureMessage: `claude exec failed with exit code ${exitCode ?? 'unknown'}${details}`
        });
      });

      childProcess.stdin.end(prompt);
    });
  }
}

type ReadCodegenConfig = () => CodegenConfig;

export class SpawnCodegenRunner implements CodexRunner {
  private readonly readCodegenConfig: ReadCodegenConfig;
  private readonly codexRunner: CodexRunner;

  constructor(
    readCodegenConfig: ReadCodegenConfig = () => readCodegenConfigFromEnv(),
    codexRunner: CodexRunner = new SpawnCodexRunner()
  ) {
    this.readCodegenConfig = readCodegenConfig;
    this.codexRunner = codexRunner;
  }

  async run(prompt: string, cwd: string, options: CodexRunOptions = {}): Promise<CodexRunResult> {
    const codegenConfig = this.readCodegenConfig();
    if (codegenConfig.provider !== 'claude') {
      return this.codexRunner.run(prompt, cwd, options);
    }

    const claudeRunner = new SpawnClaudeRunner({
      model: codegenConfig.claudeModel,
      thinking: codegenConfig.claudeThinking
    });

    return claudeRunner.run(prompt, cwd, options);
  }
}

export function composeCodexPrompt(buildPrompt: string, userPrompt: string): string {
  const normalizedBuildPrompt = buildPrompt.trimEnd();
  return `${normalizedBuildPrompt}\n\n${userPrompt}`;
}

export async function readBuildPromptFile(buildPromptPath: string): Promise<string> {
  return fs.readFile(buildPromptPath, 'utf8');
}
