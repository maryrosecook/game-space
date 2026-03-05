import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';


const CLAUDE_IDEATION_SYSTEM_PROMPT =
  'Use maximum thinking depth for ideation. You have exactly one turn. Return only the final idea text.';

export type IdeaGenerationBaseGameContext = {
  id: string;
  label: string;
  prompt?: string | null;
  readme?: string | null;
};

export type IdeationSpawnProcess = typeof spawn;
type IdeationRunFailureReason = 'aborted' | 'failed';
type IdeationRunFailure = {
  reason: IdeationRunFailureReason;
  message: string;
};

function normalizeIdeaOutput(rawOutput: string): string | null {
  const cleaned = rawOutput.trim().replaceAll(/\s+/g, ' ');
  if (cleaned.length === 0) {
    return null;
  }

  return cleaned;
}

function readIdeationModelFromEnv(): string {
  const model = process.env.IDEATION_MODEL;
  if (typeof model !== 'string') {
    return 'opus';
  }

  const normalizedModel = model.trim();
  if (normalizedModel.length === 0) {
    return 'opus';
  }

  return normalizedModel;
}

function readClaudeIdeationCommandOverrideFromEnv(): string | null {
  const override = process.env.CLAUDE_CLI_PATH;
  if (typeof override !== 'string') {
    return null;
  }

  const normalizedOverride = override.trim();
  if (normalizedOverride.length === 0) {
    return null;
  }

  return normalizedOverride;
}

async function canExecute(commandPath: string): Promise<boolean> {
  try {
    await fs.access(commandPath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveClaudeIdeationCommand(): Promise<string> {
  const commandOverride = readClaudeIdeationCommandOverrideFromEnv();
  if (commandOverride) {
    return commandOverride;
  }

  const absoluteCandidates = [
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
    path.join(process.env.HOME ?? '', '.local', 'bin', 'claude')
  ];

  for (const candidate of absoluteCandidates) {
    if (candidate.length === 0) {
      continue;
    }

    if (await canExecute(candidate)) {
      return candidate;
    }
  }

  return 'claude';
}

function extractTheGameSection(readmeText: string): string | null {
  const sectionMatch = readmeText.match(/(?:^|\n)## The Game\s*\n([\s\S]*?)(?:\n##\s|$)/);
  if (!sectionMatch || typeof sectionMatch[1] !== 'string') {
    return null;
  }

  const normalizedSection = sectionMatch[1].trim();
  return normalizedSection.length > 0 ? normalizedSection : null;
}

function summarizeReadmeContext(readmeText: string | null | undefined): string | null {
  if (typeof readmeText !== 'string') {
    return null;
  }

  const normalized = readmeText.trim();
  if (normalized.length === 0) {
    return null;
  }

  const theGameSection = extractTheGameSection(normalized);
  if (theGameSection) {
    return theGameSection;
  }

  return normalized.slice(0, 2000);
}

export function buildClaudeIdeationArgs(model: string, sessionId: string): string[] {
  return [
    '--print',
    '--dangerously-skip-permissions',
    '--model',
    model,
    '--session-id',
    sessionId,
    '--append-system-prompt',
    CLAUDE_IDEATION_SYSTEM_PROMPT
  ];
}


function composeIdeationPrompt(
  gameBuildPrompt: string,
  ideationPrompt: string,
  baseGameContext: IdeaGenerationBaseGameContext
): string {
  const ideationDirective =
    baseGameContext.id === 'starter'
      ? 'Because the base game is starter, propose a fully fleshed-out game concept that includes a core loop, player input, win/loss conditions, player instructions, and a concrete art style.'
      : 'Because the base game is not starter, propose exactly one meaningful mechanics change that makes the gameplay more compelling or meaningfully better.';

  const promptParts = [
    gameBuildPrompt.trimEnd(),
    '',
    ideationPrompt.trimEnd(),
    '',
    ideationDirective,
    '',
    'Base game context for this ideation run:',
    `- id: ${baseGameContext.id}`,
    `- label: ${baseGameContext.label}`
  ];

  const baseGamePrompt = typeof baseGameContext.prompt === 'string' ? baseGameContext.prompt.trim() : '';
  if (baseGamePrompt.length > 0) {
    promptParts.push(`- creation prompt: ${baseGamePrompt}`);
  }

  const readmeContext = summarizeReadmeContext(baseGameContext.readme);
  if (readmeContext) {
    promptParts.push('', 'Base game README context:', readmeContext);
  }

  return promptParts.join('\n');
}

export async function generateIdeaPrompt(
  gameBuildPromptPath: string,
  ideationPromptPath: string,
  cwd: string,
  baseGameContext: IdeaGenerationBaseGameContext,
  signal?: AbortSignal,
  spawnProcess: IdeationSpawnProcess = spawn
): Promise<string> {
  const [gameBuildPrompt, ideationPrompt] = await Promise.all([
    fs.readFile(gameBuildPromptPath, 'utf8'),
    fs.readFile(ideationPromptPath, 'utf8')
  ]);

  const fullPrompt = composeIdeationPrompt(gameBuildPrompt, ideationPrompt, baseGameContext);
  const model = readIdeationModelFromEnv();
  const command = await resolveClaudeIdeationCommand();

  return runIdeaGenerationForModel(command, model, fullPrompt, cwd, signal, spawnProcess);
}

function runIdeaGenerationForModel(
  command: string,
  model: string,
  fullPrompt: string,
  cwd: string,
  signal: AbortSignal | undefined,
  spawnProcess: IdeationSpawnProcess
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const childProcess = spawnProcess(command, buildClaudeIdeationArgs(model, randomUUID()), {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let settled = false;

    function rejectIfPending(error: IdeationRunFailure): void {
      if (settled) {
        return;
      }

      settled = true;
      reject(new Error(error.message));
    }

    function resolveIfPending(prompt: string): void {
      if (settled) {
        return;
      }

      settled = true;
      resolve(prompt);
    }

    function abortGeneration(): void {
      childProcess.kill('SIGTERM');
      rejectIfPending({
        reason: 'aborted',
        message: 'claude ideation command aborted'
      });
    }

    if (signal) {
      if (signal.aborted) {
        abortGeneration();
        return;
      }

      signal.addEventListener('abort', abortGeneration, { once: true });
      childProcess.on('close', () => {
        signal.removeEventListener('abort', abortGeneration);
      });
    }

    let stdoutText = '';
    let stderrText = '';

    childProcess.stdout.setEncoding('utf8');
    childProcess.stdout.on('data', (chunk: string) => {
      stdoutText += chunk;
    });

    childProcess.stderr.setEncoding('utf8');
    childProcess.stderr.on('data', (chunk: string) => {
      stderrText += chunk;
    });

    childProcess.on('error', (error) => {
      rejectIfPending({
        reason: 'failed',
        message:
          error instanceof Error
            ? `claude ideation command failed: ${error.message}`
            : 'claude ideation command failed'
      });
    });

    childProcess.on('close', (exitCode) => {
      if (exitCode !== 0) {
        const normalizedError = stderrText.trim();
        const normalizedStdout = stdoutText.trim();
        const detailsSource = normalizedError.length > 0 ? normalizedError : normalizedStdout;
        const details = detailsSource.length > 0 ? `: ${detailsSource}` : '';
        rejectIfPending({
          reason: 'failed',
          message: `claude ideation command failed with exit code ${exitCode ?? 'unknown'}${details}`
        });
        return;
      }

      const normalized = normalizeIdeaOutput(stdoutText);
      if (!normalized) {
        rejectIfPending({
          reason: 'failed',
          message: 'claude ideation command returned an empty idea'
        });
        return;
      }

      resolveIfPending(normalized);
    });

    childProcess.stdin.end(fullPrompt);
  });
}
