import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';

const IDEAS_STARTER_VERSION_ID = 'starter';

function normalizeIdeaOutput(rawOutput: string): string | null {
  const cleaned = rawOutput.trim().replaceAll(/\s+/g, ' ');
  if (cleaned.length === 0) {
    return null;
  }

  return cleaned;
}

export function buildIdeationDirective(baseGameVersionId: string): string {
  if (baseGameVersionId === IDEAS_STARTER_VERSION_ID) {
    return [
      `Base game for ideation: \`${IDEAS_STARTER_VERSION_ID}\`.`,
      'Ideation mode: full game concept.',
      'Generate one original game concept that can be built from the starter template.',
    ].join('\n');
  }

  return [
    `Base game for ideation: \`${baseGameVersionId}\`.`,
    'Ideation mode: focused mechanics improvement.',
    `Generate one focused mechanics improvement for the existing \`${baseGameVersionId}\` game.`,
  ].join('\n');
}

export function buildIdeaGenerationInput(options: {
  gameBuildPrompt: string;
  ideationPrompt: string;
  baseGameVersionId: string;
}): string {
  return `${options.gameBuildPrompt.trimEnd()}\n\n${buildIdeationDirective(options.baseGameVersionId)}\n\n${options.ideationPrompt.trimEnd()}`;
}

export async function generateIdeaPrompt(
  gameBuildPromptPath: string,
  ideationPromptPath: string,
  cwd: string,
  baseGameVersionId: string,
  signal?: AbortSignal
): Promise<string> {
  const [gameBuildPrompt, ideationPrompt] = await Promise.all([
    fs.readFile(gameBuildPromptPath, 'utf8'),
    fs.readFile(ideationPromptPath, 'utf8')
  ]);

  const fullPrompt = buildIdeaGenerationInput({
    gameBuildPrompt,
    ideationPrompt,
    baseGameVersionId,
  });

  return new Promise<string>((resolve, reject) => {
    const childProcess = spawn('codex', ['exec', '--dangerously-bypass-approvals-and-sandbox', '-'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let settled = false;

    function rejectIfPending(error: Error): void {
      if (settled) {
        return;
      }

      settled = true;
      reject(error);
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
      rejectIfPending(new Error('codex ideation command aborted'));
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
      rejectIfPending(error);
    });

    childProcess.on('close', (exitCode) => {
      if (exitCode !== 0) {
        const details = stderrText.trim().length > 0 ? `: ${stderrText.trim()}` : '';
        rejectIfPending(new Error(`codex ideation command failed with exit code ${exitCode ?? 'unknown'}${details}`));
        return;
      }

      const normalized = normalizeIdeaOutput(stdoutText);
      if (!normalized) {
        rejectIfPending(new Error('codex ideation command returned an empty idea'));
        return;
      }

      resolveIfPending(normalized);
    });

    childProcess.stdin.end(fullPrompt);
  });
}
