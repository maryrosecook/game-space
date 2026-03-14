import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { createTempDirectory, writeJsonFile } from './testHelpers';

const SCRIPT_PATH = path.join(process.cwd(), 'scripts', 'github', 'enable-owner-pr-automerge.js');

type ScriptRunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type ScriptFixture = {
  tempDirectoryPath: string;
  ghArgumentsPath: string;
  ghCallCountPath: string;
  ghBehavior: GhBehavior;
};

type GhBehavior = 'already-enabled' | 'fail-on-call' | 'unstable-then-success';

type PullRequestEvent = {
  repository: {
    full_name: string;
    owner: {
      login: string;
    };
  };
  pull_request: {
    number: number;
    base: {
      ref: string;
    };
    draft: boolean;
    user: {
      login: string;
    };
    head: {
      repo: {
        full_name: string;
        fork: boolean;
      };
    };
  };
};

async function createScriptFixture(behavior: GhBehavior): Promise<ScriptFixture> {
  const tempDirectoryPath = await createTempDirectory('game-space-owner-pr-automerge-');
  const binDirectoryPath = path.join(tempDirectoryPath, 'bin');
  const ghArgumentsPath = path.join(tempDirectoryPath, 'gh-args.jsonl');
  const ghCallCountPath = path.join(tempDirectoryPath, 'gh-call-count.txt');
  const ghPath = path.join(binDirectoryPath, 'gh');

  await fs.mkdir(binDirectoryPath, { recursive: true });
  await fs.writeFile(
    ghPath,
    `#!/usr/bin/env node
const fs = require('node:fs');

const args = process.argv.slice(2);
const behavior = process.env.TEST_GH_BEHAVIOR;
const argumentsPath = process.env.TEST_GH_ARGS_FILE;
const callCountPath = process.env.TEST_GH_CALL_COUNT_FILE;
const successAttempt = Number.parseInt(process.env.TEST_GH_SUCCESS_ATTEMPT || '3', 10);

if (argumentsPath) {
  fs.appendFileSync(argumentsPath, \`\${JSON.stringify(args)}\\n\`, 'utf8');
}

if (args[0] === 'pr' && args[1] === 'view') {
  if (behavior === 'already-enabled') {
    process.stdout.write(JSON.stringify({ autoMergeRequest: { enabledAt: '2026-03-14T00:00:00.000Z' } }));
    process.exit(0);
  }

  process.stdout.write(JSON.stringify({ autoMergeRequest: null }));
  process.exit(0);
}

if (args[0] === 'api' && args[1] === 'repos/maryrosecook/memphis') {
  process.stdout.write(
    JSON.stringify({
      allow_merge_commit: true,
      allow_squash_merge: true,
      allow_rebase_merge: true
    })
  );
  process.exit(0);
}

if (args[0] === 'pr' && args[1] === 'merge') {
  const previousCount = fs.existsSync(callCountPath)
    ? Number.parseInt(fs.readFileSync(callCountPath, 'utf8'), 10)
    : 0;
  const nextCount = Number.isInteger(previousCount) ? previousCount + 1 : 1;
  fs.writeFileSync(callCountPath, String(nextCount), 'utf8');

  if (behavior === 'unstable-then-success') {
    if (nextCount < successAttempt) {
      process.stderr.write('GraphQL: Pull request is in unstable status\\n');
      process.exit(1);
    }

    process.stdout.write('Enabled auto-merge.\\n');
    process.exit(0);
  }

  process.stderr.write('gh should not have been called\\n');
  process.exit(1);
}

process.stderr.write(\`Unexpected gh invocation: \${args.join(' ')}\\n\`);
process.exit(1);
`,
    'utf8'
  );
  await fs.chmod(ghPath, 0o755);

  return {
    tempDirectoryPath,
    ghArgumentsPath,
    ghCallCountPath,
    ghBehavior: behavior
  };
}

async function runOwnerPrAutomergeScript({
  fixture,
  eventPayload,
  maxAttempts = 4,
  retryDelayMs = 1,
  successAttempt = 3
}: {
  fixture: ScriptFixture;
  eventPayload: Record<string, unknown>;
  maxAttempts?: number;
  retryDelayMs?: number;
  successAttempt?: number;
}): Promise<ScriptRunResult> {
  const eventPath = path.join(fixture.tempDirectoryPath, 'event.json');
  await writeJsonFile(eventPath, eventPayload);

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT_PATH], {
      env: {
        ...process.env,
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_REPOSITORY: 'maryrosecook/memphis',
        GITHUB_REPOSITORY_OWNER: 'maryrosecook',
        OWNER_PR_AUTOMERGE_MAX_ATTEMPTS: String(maxAttempts),
        OWNER_PR_AUTOMERGE_RETRY_DELAY_MS: String(retryDelayMs),
        TEST_GH_ARGS_FILE: fixture.ghArgumentsPath,
        TEST_GH_BEHAVIOR: fixture.ghBehavior,
        TEST_GH_CALL_COUNT_FILE: fixture.ghCallCountPath,
        TEST_GH_SUCCESS_ATTEMPT: String(successAttempt),
        PATH: `${path.join(fixture.tempDirectoryPath, 'bin')}${path.delimiter}${process.env.PATH ?? ''}`
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        exitCode: code ?? 0,
        stdout,
        stderr
      });
    });
  });
}

async function readGhCalls(argumentsPath: string): Promise<readonly string[][]> {
  try {
    const contents = await fs.readFile(argumentsPath, 'utf8');
    return contents
      .trim()
      .split('\n')
      .filter((line) => line.length > 0)
      .map(parseStringArrayLine);
  } catch (error) {
    const code = getErrorCode(error);
    if (code === 'ENOENT') {
      return [];
    }

    throw error;
  }
}

function parseStringArrayLine(line: string): string[] {
  const parsed = JSON.parse(line);
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string')) {
    throw new Error('Expected gh arguments log to contain JSON string arrays.');
  }

  return parsed;
}

async function readGhMergeCallCount(callCountPath: string): Promise<number> {
  try {
    const value = await fs.readFile(callCountPath, 'utf8');
    return Number.parseInt(value, 10);
  } catch (error) {
    const code = getErrorCode(error);
    if (code === 'ENOENT') {
      return 0;
    }

    throw error;
  }
}

function createPullRequestEvent(): PullRequestEvent {
  return {
    repository: {
      full_name: 'maryrosecook/memphis',
      owner: {
        login: 'maryrosecook'
      }
    },
    pull_request: {
      number: 112,
      base: {
        ref: 'main'
      },
      draft: false,
      user: {
        login: 'maryrosecook'
      },
      head: {
        repo: {
          full_name: 'maryrosecook/memphis',
          fork: false
        }
      }
    }
  };
}

function getErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return null;
  }

  const code = error.code;
  return typeof code === 'string' ? code : null;
}

describe('owner PR auto-merge helper script', () => {
  it('skips non-owner PRs without invoking gh', async () => {
    const fixture = await createScriptFixture('fail-on-call');
    const eventPayload = createPullRequestEvent();
    eventPayload.pull_request.user.login = 'someone-else';

    const result = await runOwnerPrAutomergeScript({
      fixture,
      eventPayload
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('author someone-else is not repository owner maryrosecook');
    expect(await readGhCalls(fixture.ghArgumentsPath)).toEqual([]);
  });

  it('retries unstable status until gh enables auto-merge', async () => {
    const fixture = await createScriptFixture('unstable-then-success');
    const result = await runOwnerPrAutomergeScript({
      fixture,
      eventPayload: createPullRequestEvent(),
      successAttempt: 3
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('retrying in 1ms');
    expect(result.stdout).toContain('Enabled auto-merge for PR #112.');
    expect(await readGhCalls(fixture.ghArgumentsPath)).toEqual([
      ['pr', 'view', '--json', 'autoMergeRequest', '--repo', 'maryrosecook/memphis', '112'],
      ['api', 'repos/maryrosecook/memphis'],
      ['pr', 'merge', '--auto', '--squash', '--repo', 'maryrosecook/memphis', '112'],
      ['pr', 'merge', '--auto', '--squash', '--repo', 'maryrosecook/memphis', '112'],
      ['pr', 'merge', '--auto', '--squash', '--repo', 'maryrosecook/memphis', '112']
    ]);
    expect(await readGhMergeCallCount(fixture.ghCallCountPath)).toBe(3);
  });

  it('treats pre-enabled auto-merge as a success without merging again', async () => {
    const fixture = await createScriptFixture('already-enabled');
    const result = await runOwnerPrAutomergeScript({
      fixture,
      eventPayload: createPullRequestEvent()
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Auto-merge already enabled for PR #112.');
    expect(await readGhCalls(fixture.ghArgumentsPath)).toEqual([
      ['pr', 'view', '--json', 'autoMergeRequest', '--repo', 'maryrosecook/memphis', '112']
    ]);
    expect(await readGhMergeCallCount(fixture.ghCallCountPath)).toBe(0);
  });

  it('fails after exhausting unstable-status retries', async () => {
    const fixture = await createScriptFixture('unstable-then-success');
    const result = await runOwnerPrAutomergeScript({
      fixture,
      eventPayload: createPullRequestEvent(),
      maxAttempts: 2,
      successAttempt: 10
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('retrying in 1ms');
    expect(result.stderr).toContain('Failed to enable auto-merge for PR #112:');
    expect(await readGhCalls(fixture.ghArgumentsPath)).toEqual([
      ['pr', 'view', '--json', 'autoMergeRequest', '--repo', 'maryrosecook/memphis', '112'],
      ['api', 'repos/maryrosecook/memphis'],
      ['pr', 'merge', '--auto', '--squash', '--repo', 'maryrosecook/memphis', '112'],
      ['pr', 'merge', '--auto', '--squash', '--repo', 'maryrosecook/memphis', '112']
    ]);
  });
});
