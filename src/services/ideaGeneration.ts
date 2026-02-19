import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';

function normalizeIdeaOutput(rawOutput: string): string | null {
  const cleaned = rawOutput.trim().replaceAll(/\s+/g, ' ');
  if (cleaned.length === 0) {
    return null;
  }

  return cleaned;
}

export async function generateIdeaPrompt(
  gameBuildPromptPath: string,
  ideationPromptPath: string,
  cwd: string
): Promise<string> {
  const [gameBuildPrompt, ideationPrompt] = await Promise.all([
    fs.readFile(gameBuildPromptPath, 'utf8'),
    fs.readFile(ideationPromptPath, 'utf8')
  ]);

  const fullPrompt = `${gameBuildPrompt.trimEnd()}\n\n${ideationPrompt.trimEnd()}`;

  return new Promise<string>((resolve, reject) => {
    const childProcess = spawn('codex', ['exec', '--dangerously-bypass-approvals-and-sandbox', '-'], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe']
    });

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
      reject(error);
    });

    childProcess.on('close', (exitCode) => {
      if (exitCode !== 0) {
        const details = stderrText.trim().length > 0 ? `: ${stderrText.trim()}` : '';
        reject(new Error(`codex ideation command failed with exit code ${exitCode ?? 'unknown'}${details}`));
        return;
      }

      const normalized = normalizeIdeaOutput(stdoutText);
      if (!normalized) {
        reject(new Error('codex ideation command returned an empty idea')); 
        return;
      }

      resolve(normalized);
    });

    childProcess.stdin.end(fullPrompt);
  });
}
