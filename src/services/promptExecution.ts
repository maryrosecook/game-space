import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';

export interface CodexRunner {
  run(prompt: string, cwd: string): Promise<void>;
}

export class SpawnCodexRunner implements CodexRunner {
  async run(prompt: string, cwd: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const childProcess = spawn('codex', ['exec', '-'], {
        cwd,
        stdio: ['pipe', 'ignore', 'pipe']
      });

      let errorOutput = '';
      childProcess.stderr.setEncoding('utf8');
      childProcess.stderr.on('data', (chunk: string) => {
        errorOutput += chunk;
      });

      childProcess.on('error', (error) => {
        reject(error);
      });

      childProcess.on('close', (exitCode) => {
        if (exitCode === 0) {
          resolve();
          return;
        }

        const details = errorOutput.trim().length > 0 ? `: ${errorOutput.trim()}` : '';
        reject(new Error(`codex exec failed with exit code ${exitCode ?? 'unknown'}${details}`));
      });

      childProcess.stdin.end(prompt);
    });
  }
}

export function composeCodexPrompt(buildPrompt: string, userPrompt: string): string {
  const normalizedBuildPrompt = buildPrompt.trimEnd();
  return `${normalizedBuildPrompt}\n\n${userPrompt}`;
}

export async function readBuildPromptFile(buildPromptPath: string): Promise<string> {
  return fs.readFile(buildPromptPath, 'utf8');
}
