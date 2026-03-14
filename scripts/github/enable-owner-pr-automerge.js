#!/usr/bin/env node

const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const DEFAULT_MAX_ATTEMPTS = 6;
const DEFAULT_RETRY_DELAY_MS = 10_000;

async function main() {
  const payload = await readEventPayload();
  const pr = payload.pull_request;

  const repositoryFullName = resolveRepositoryFullName(payload);
  const repositoryOwner = resolveRepositoryOwner(payload, repositoryFullName);

  const skipMessage = getSkipMessage({
    pr,
    repositoryFullName,
    repositoryOwner
  });
  if (skipMessage !== null) {
    console.info(skipMessage);
    return;
  }

  const prNumber = resolvePullRequestNumber(pr);
  const maxAttempts = readPositiveIntegerEnvironmentVariable(
    'OWNER_PR_AUTOMERGE_MAX_ATTEMPTS',
    DEFAULT_MAX_ATTEMPTS
  );
  const retryDelayMs = readNonNegativeIntegerEnvironmentVariable(
    'OWNER_PR_AUTOMERGE_RETRY_DELAY_MS',
    DEFAULT_RETRY_DELAY_MS
  );

  if (await isAutoMergeAlreadyEnabled(repositoryFullName, prNumber)) {
    console.info(`Auto-merge already enabled for PR #${prNumber}.`);
    return;
  }

  await enableAutoMergeWithRetries({
    repositoryFullName,
    prNumber,
    maxAttempts,
    retryDelayMs
  });

  console.info(`Enabled auto-merge for PR #${prNumber}.`);
}

async function readEventPayload() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (typeof eventPath !== 'string' || eventPath.length === 0) {
    throw new Error('GITHUB_EVENT_PATH is required.');
  }

  const eventSource = await fs.readFile(eventPath, 'utf8');

  try {
    return JSON.parse(eventSource);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse GitHub event payload: ${message}`);
  }
}

function resolveRepositoryFullName(payload) {
  const repositoryFullName =
    readNonEmptyString(process.env.GITHUB_REPOSITORY) ?? readNonEmptyString(payload.repository?.full_name);

  if (repositoryFullName === null) {
    throw new Error('GITHUB_REPOSITORY is required.');
  }

  return repositoryFullName;
}

function resolveRepositoryOwner(payload, repositoryFullName) {
  return (
    readNonEmptyString(process.env.GITHUB_REPOSITORY_OWNER) ??
    readNonEmptyString(payload.repository?.owner?.login) ??
    repositoryFullName.split('/')[0]
  );
}

function getSkipMessage({ pr, repositoryFullName, repositoryOwner }) {
  if (!isRecord(pr)) {
    return 'No pull request payload found. Skipping.';
  }

  if (pr.base?.ref !== 'main') {
    return `Skipping PR #${pr.number}: base branch is ${pr.base?.ref ?? 'unknown'}, expected main.`;
  }

  if (pr.draft === true) {
    return `Skipping PR #${pr.number}: draft PRs are not eligible.`;
  }

  if (pr.user?.login !== repositoryOwner) {
    return `Skipping PR #${pr.number}: author ${pr.user?.login ?? 'unknown'} is not repository owner ${repositoryOwner}.`;
  }

  const isSameRepository =
    pr.head?.repo?.full_name === repositoryFullName && pr.head?.repo?.fork !== true;

  if (!isSameRepository) {
    return `Skipping PR #${pr.number}: head repository must be ${repositoryFullName} and must not be a fork.`;
  }

  return null;
}

function resolvePullRequestNumber(pr) {
  if (!isRecord(pr) || !Number.isInteger(pr.number) || pr.number < 1) {
    throw new Error('Pull request payload is missing a valid pull request number.');
  }

  return pr.number;
}

async function isAutoMergeAlreadyEnabled(repositoryFullName, prNumber) {
  const view = await runGhCommand([
    'pr',
    'view',
    '--json',
    'autoMergeRequest',
    '--repo',
    repositoryFullName,
    String(prNumber)
  ]);

  let response;
  try {
    response = JSON.parse(view.stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse gh pr view response: ${message}`);
  }

  return isRecord(response) && response.autoMergeRequest !== null;
}

async function enableAutoMergeWithRetries({
  repositoryFullName,
  prNumber,
  maxAttempts,
  retryDelayMs
}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await runGhCommand([
        'pr',
        'merge',
        '--auto',
        '--repo',
        repositoryFullName,
        String(prNumber)
      ]);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (isBenignAutoMergeMessage(message)) {
        console.info(`Auto-merge already enabled for PR #${prNumber}.`);
        return;
      }

      const isLastAttempt = attempt === maxAttempts;
      if (isRetryableUnstableStatusMessage(message) && !isLastAttempt) {
        console.info(
          `PR #${prNumber} is still in unstable status on attempt ${attempt}/${maxAttempts}; retrying in ${retryDelayMs}ms.`
        );
        await sleep(retryDelayMs);
        continue;
      }

      throw new Error(`Failed to enable auto-merge for PR #${prNumber}: ${message}`);
    }
  }
}

function isBenignAutoMergeMessage(message) {
  return (
    /already (has )?auto-merge enabled/i.test(message) ||
    /already in (a )?merge queue/i.test(message)
  );
}

function isRetryableUnstableStatusMessage(message) {
  return /pull request is in unstable status/i.test(message);
}

async function runGhCommand(args) {
  try {
    return await execFileAsync('gh', args, {
      env: process.env
    });
  } catch (error) {
    const commandOutput = extractCommandOutput(error);
    throw new Error(commandOutput);
  }
}

function extractCommandOutput(error) {
  if (!isRecord(error)) {
    return String(error);
  }

  const stderr = readNonEmptyString(error.stderr);
  const stdout = readNonEmptyString(error.stdout);
  const message = readNonEmptyString(error.message);

  return [stderr, stdout, message].filter((value) => value !== null).join('\n');
}

function readPositiveIntegerEnvironmentVariable(name, fallbackValue) {
  const value = process.env[name];
  if (value === undefined) {
    return fallbackValue;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer when provided.`);
  }

  return parsed;
}

function readNonNegativeIntegerEnvironmentVariable(name, fallbackValue) {
  const value = process.env[name];
  if (value === undefined) {
    return fallbackValue;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer when provided.`);
  }

  return parsed;
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function isRecord(value) {
  return typeof value === 'object' && value !== null;
}

function readNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
