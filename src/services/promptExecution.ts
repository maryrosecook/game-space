import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { isObjectRecord } from './fsUtils';
import { readCodegenConfigFromEnv, type CodegenConfig } from './codegenConfig';

export type CodexRunResult = {
  sessionId: string | null;
  success: boolean;
  failureMessage: string | null;
  completionDetected?: boolean;
};

export type CodexRunOptions = {
  onSessionId?: (sessionId: string) => void;
  imagePaths?: readonly string[];
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



type CodegenProviderForEvents = 'codex' | 'claude';

const CODEX_TERMINAL_EVENT_TYPES = new Set([
  'response.completed',
  'run.completed',
  'task_complete',
  'task_failed',
  'task_error',
  'task_cancelled',
  'task_canceled'
]);

export function parseGenerationCompleteEventLine(
  serializedEventLine: string,
  provider: CodegenProviderForEvents
): boolean {
  let rawEvent: unknown;
  try {
    rawEvent = JSON.parse(serializedEventLine) as unknown;
  } catch {
    return false;
  }

  if (!isObjectRecord(rawEvent) || typeof rawEvent.type !== 'string') {
    return false;
  }

  if (provider === 'claude') {
    return rawEvent.type === 'message_stop';
  }

  if (CODEX_TERMINAL_EVENT_TYPES.has(rawEvent.type)) {
    return true;
  }

  if (rawEvent.type !== 'event_msg' || !('payload' in rawEvent)) {
    return false;
  }

  const payload = rawEvent.payload;
  return isObjectRecord(payload) && typeof payload.type === 'string' && CODEX_TERMINAL_EVENT_TYPES.has(payload.type);
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
  onSessionId: ((sessionId: string) => void) | undefined,
  provider: CodegenProviderForEvents,
  completionDetected: boolean
): { remainingOutput: string; sessionId: string | null; completionDetected: boolean } {
  let output = bufferedOutput;
  let sessionId = currentSessionId;
  let detectedCompletion = completionDetected;

  for (;;) {
    const newlineIndex = output.indexOf('\n');
    if (newlineIndex === -1) {
      return {
        remainingOutput: output,
        sessionId,
        completionDetected: detectedCompletion
      };
    }

    const line = output.slice(0, newlineIndex).trim();
    if (line.length > 0) {
      const nextSessionId = maybeCaptureSessionId(line, sessionId);
      if (!sessionId && nextSessionId) {
        notifySessionId(onSessionId, nextSessionId);
      }

      sessionId = nextSessionId;
      detectedCompletion = detectedCompletion || parseGenerationCompleteEventLine(line, provider);
    }

    output = output.slice(newlineIndex + 1);
  }
}

export class SpawnCodexRunner implements CodexRunner {
  async run(prompt: string, cwd: string, options: CodexRunOptions = {}): Promise<CodexRunResult> {
    return new Promise<CodexRunResult>((resolve, reject) => {
      const { onSessionId, imagePaths = [] } = options;
      const childProcess = spawn('codex', buildCodexExecArgs(imagePaths), {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let errorOutput = '';
      let stdoutBuffer = '';
      let sessionId: string | null = null;
      let completionDetected = false;

      childProcess.stdout.setEncoding('utf8');
      childProcess.stdout.on('data', (chunk: string) => {
        stdoutBuffer += chunk;
        const drained = drainStdoutLines(stdoutBuffer, sessionId, onSessionId, 'codex', completionDetected);
        stdoutBuffer = drained.remainingOutput;
        sessionId = drained.sessionId;
        completionDetected = drained.completionDetected;
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
          completionDetected = completionDetected || parseGenerationCompleteEventLine(finalLine, 'codex');
        }

        if (exitCode === 0) {
          resolve({
            sessionId,
            success: true,
            failureMessage: null,
            completionDetected
          });
          return;
        }

        const details = errorOutput.trim().length > 0 ? `: ${errorOutput.trim()}` : '';
        resolve({
          sessionId,
          success: false,
          failureMessage: `codex exec failed with exit code ${exitCode ?? 'unknown'}${details}`,
          completionDetected
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

type ClaudeImageContentBlock = {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
};

type ClaudeTextContentBlock = {
  type: 'text';
  text: string;
};

type ClaudeUserInputLine = {
  type: 'user';
  session_id: string;
  message: {
    role: 'user';
    content: readonly (ClaudeImageContentBlock | ClaudeTextContentBlock)[];
  };
  parent_tool_use_id: null;
};

function mediaTypeForImagePath(imagePath: string): string {
  const fileExtension = path.extname(imagePath).toLowerCase();
  switch (fileExtension) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    default:
      throw new Error(
        `Claude annotation images must use png, jpg, jpeg, gif, or webp extensions. Received: ${imagePath}`
      );
  }
}

async function buildClaudeImageContentBlock(imagePath: string): Promise<ClaudeImageContentBlock> {
  const imageBytes = await fs.readFile(imagePath);
  return {
    type: 'image',
    source: {
      type: 'base64',
      media_type: mediaTypeForImagePath(imagePath),
      data: imageBytes.toString('base64')
    }
  };
}

export async function buildClaudeStreamJsonUserInput(
  prompt: string,
  imagePaths: readonly string[]
): Promise<string> {
  const imageContent = await Promise.all(imagePaths.map((imagePath) => buildClaudeImageContentBlock(imagePath)));
  const line: ClaudeUserInputLine = {
    type: 'user',
    session_id: '',
    message: {
      role: 'user',
      content: [...imageContent, { type: 'text', text: prompt }]
    },
    parent_tool_use_id: null
  };
  return `${JSON.stringify(line)}\n`;
}

function buildClaudeRunnerArgs(
  model: string,
  thinking: string,
  sessionId: string,
  useStreamJsonInput: boolean
): string[] {
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

  if (useStreamJsonInput) {
    args.push('--input-format', 'stream-json');
  }

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
    const { onSessionId, imagePaths = [] } = options;
    const useStreamJsonInput = imagePaths.length > 0;
    const promptInput = useStreamJsonInput
      ? await buildClaudeStreamJsonUserInput(prompt, imagePaths)
      : prompt;

    return new Promise<CodexRunResult>((resolve, reject) => {
      const generatedSessionId = randomUUID();
      notifySessionId(onSessionId, generatedSessionId);
      const args = buildClaudeRunnerArgs(
        this.model,
        this.thinking,
        generatedSessionId,
        useStreamJsonInput
      );
      const childProcess = spawn('claude', args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let errorOutput = '';
      let stdoutBuffer = '';
      let sessionId: string | null = generatedSessionId;
      let completionDetected = false;

      childProcess.stdout.setEncoding('utf8');
      childProcess.stdout.on('data', (chunk: string) => {
        stdoutBuffer += chunk;
        const drained = drainStdoutLines(stdoutBuffer, sessionId, onSessionId, 'claude', completionDetected);
        stdoutBuffer = drained.remainingOutput;
        sessionId = drained.sessionId;
        completionDetected = drained.completionDetected;
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
          completionDetected = completionDetected || parseGenerationCompleteEventLine(finalLine, 'claude');
        }

        if (exitCode === 0) {
          resolve({
            sessionId,
            success: true,
            failureMessage: null,
            completionDetected
          });
          return;
        }

        const details = errorOutput.trim().length > 0 ? `: ${errorOutput.trim()}` : '';
        resolve({
          sessionId,
          success: false,
          failureMessage: `claude exec failed with exit code ${exitCode ?? 'unknown'}${details}`,
          completionDetected
        });
      });

      childProcess.stdin.end(promptInput);
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

export function composeCodexPrompt(
  buildPrompt: string,
  userPrompt: string,
  annotationPngDataUrl: string | null = null
): string {
  const normalizedBuildPrompt = buildPrompt.trimEnd();
  const normalizedAnnotation =
    typeof annotationPngDataUrl === 'string' ? annotationPngDataUrl.trim() : '';

  if (normalizedAnnotation.length === 0) {
    return `${normalizedBuildPrompt}\n\n${userPrompt}`;
  }

  return `${normalizedBuildPrompt}\n\n${userPrompt}\n\n[annotation_overlay_png_data_url]\n${normalizedAnnotation}`;
}

export async function readBuildPromptFile(buildPromptPath: string): Promise<string> {
  return fs.readFile(buildPromptPath, 'utf8');
}

export function buildCodexExecArgs(imagePaths: readonly string[] = []): string[] {
  const imageArgs = imagePaths.flatMap((imagePath) => ['--image', imagePath]);
  return ['exec', '--json', '--dangerously-bypass-approvals-and-sandbox', ...imageArgs, '-'];
}
