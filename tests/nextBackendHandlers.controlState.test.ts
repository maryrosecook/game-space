import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ADMIN_SESSION_COOKIE_NAME,
  createAdminSessionCookieHeader,
} from '../src/services/adminAuth';
import { CSRF_COOKIE_NAME } from '../src/services/csrf';
import {
  controlStateFilePath,
  readControlStateFile,
} from '../src/services/gameControlState';
import {
  handleApiGameControlStateGet,
  handleApiGameControlStatePost,
} from '../src/services/nextBackendHandlers';
import { createGameFixture, createTempDirectory } from './testHelpers';

const TEST_SESSION_SECRET = 'session-secret-for-tests-must-be-long';
const TEST_PASSWORD_HASH =
  'scrypt$ASNFZ4mrze8BI0VniavN7w==$M+OVA7qtmUR3CHE87sPzm7h2MpJU1PXNk9qSpl2YPwHyaL8eByBbvuCTXEVTUVc/mwL9EhXgQ14qdOIyRUXu1Q==';

type AuthEnvSnapshot = {
  passwordHash: string | undefined;
  sessionSecret: string | undefined;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function setAuthEnvForTest(): AuthEnvSnapshot {
  const snapshot: AuthEnvSnapshot = {
    passwordHash: process.env.GAME_SPACE_ADMIN_PASSWORD_HASH,
    sessionSecret: process.env.GAME_SPACE_ADMIN_SESSION_SECRET,
  };

  process.env.GAME_SPACE_ADMIN_PASSWORD_HASH = TEST_PASSWORD_HASH;
  process.env.GAME_SPACE_ADMIN_SESSION_SECRET = TEST_SESSION_SECRET;

  return snapshot;
}

function restoreAuthEnv(snapshot: AuthEnvSnapshot): void {
  if (typeof snapshot.passwordHash === 'string') {
    process.env.GAME_SPACE_ADMIN_PASSWORD_HASH = snapshot.passwordHash;
  } else {
    delete process.env.GAME_SPACE_ADMIN_PASSWORD_HASH;
  }

  if (typeof snapshot.sessionSecret === 'string') {
    process.env.GAME_SPACE_ADMIN_SESSION_SECRET = snapshot.sessionSecret;
  } else {
    delete process.env.GAME_SPACE_ADMIN_SESSION_SECRET;
  }
}

function createControlStatePostRequest(options: {
  sessionToken: string;
  csrfToken: string;
  controlState: unknown;
}): Request {
  const cookieHeader = [
    `${ADMIN_SESSION_COOKIE_NAME}=${encodeURIComponent(options.sessionToken)}`,
    `${CSRF_COOKIE_NAME}=${encodeURIComponent(options.csrfToken)}`,
  ].join('; ');

  return new Request('https://game-space.local/api/games/starter/control-state', {
    method: 'POST',
    headers: {
      host: 'game-space.local',
      origin: 'https://game-space.local',
      cookie: cookieHeader,
      'x-csrf-token': options.csrfToken,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ controlState: options.controlState }),
  });
}

async function withControlStateFixture(
  operation: (fixture: { repoRootPath: string; gamesRootPath: string }) => Promise<void>
): Promise<void> {
  const tempDirectoryPath = await createTempDirectory('game-space-control-state-');
  const repoRootPath = path.join(tempDirectoryPath, 'repo');
  const gamesRootPath = path.join(repoRootPath, 'games');
  await fs.mkdir(gamesRootPath, { recursive: true });

  await createGameFixture({
    gamesRootPath,
    metadata: {
      id: 'starter',
      parentId: null,
      createdTime: '2026-03-06T00:00:00.000Z',
    },
  });

  const previousCwd = process.cwd();
  process.chdir(repoRootPath);

  try {
    await operation({ repoRootPath, gamesRootPath });
  } finally {
    process.chdir(previousCwd);
  }
}

async function readPayload(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json();
  return isRecord(payload) ? payload : {};
}

describe('next backend control-state handlers', () => {
  it('returns an empty control state when no file has been saved', async () => {
    await withControlStateFixture(async () => {
      const response = await handleApiGameControlStateGet('starter');
      expect(response.status).toBe(200);
      await expect(readPayload(response)).resolves.toEqual({
        status: 'ok',
        versionId: 'starter',
        controlState: {}
      });
    });
  });

  it('persists validated control state and returns it on read', async () => {
    const envSnapshot = setAuthEnvForTest();
    const { sessionToken } = await createAdminSessionCookieHeader(TEST_SESSION_SECRET);

    try {
      await withControlStateFixture(async ({ gamesRootPath }) => {
        const postResponse = await handleApiGameControlStatePost(
          createControlStatePostRequest({
            sessionToken,
            csrfToken: 'csrf-control-state',
            controlState: {
              globals: {
                particles: 8
              }
            },
          }),
          'starter',
        );
        expect(postResponse.status).toBe(200);
        await expect(readPayload(postResponse)).resolves.toEqual({
          status: 'ok',
          versionId: 'starter',
          controlState: {
            globals: {
              particles: 8
            }
          }
        });

        const savedControlState = await readControlStateFile(controlStateFilePath(gamesRootPath, 'starter'));
        expect(savedControlState).toEqual({
          globals: {
            particles: 8
          }
        });

        const getResponse = await handleApiGameControlStateGet('starter');
        expect(getResponse.status).toBe(200);
        await expect(readPayload(getResponse)).resolves.toEqual({
          status: 'ok',
          versionId: 'starter',
          controlState: {
            globals: {
              particles: 8
            }
          }
        });
      });
    } finally {
      restoreAuthEnv(envSnapshot);
    }
  });

  it('rejects invalid control state payloads', async () => {
    const envSnapshot = setAuthEnvForTest();
    const { sessionToken } = await createAdminSessionCookieHeader(TEST_SESSION_SECRET);

    try {
      await withControlStateFixture(async () => {
        const response = await handleApiGameControlStatePost(
          createControlStatePostRequest({
            sessionToken,
            csrfToken: 'csrf-invalid-control-state',
            controlState: {
              globals: {
                particles: { nested: true }
              }
            },
          }),
          'starter',
        );
        expect(response.status).toBe(400);
        await expect(readPayload(response)).resolves.toEqual({
          error: 'Control state must be an object with optional scalar globals'
        });
      });
    } finally {
      restoreAuthEnv(envSnapshot);
    }
  });

  it('serializes concurrent writes into valid JSON on disk', async () => {
    const envSnapshot = setAuthEnvForTest();
    const { sessionToken } = await createAdminSessionCookieHeader(TEST_SESSION_SECRET);

    try {
      await withControlStateFixture(async ({ gamesRootPath }) => {
        await Promise.all([
          handleApiGameControlStatePost(
            createControlStatePostRequest({
              sessionToken,
              csrfToken: 'csrf-concurrent-control-state',
              controlState: { globals: { particles: 2 } },
            }),
            'starter',
          ),
          handleApiGameControlStatePost(
            createControlStatePostRequest({
              sessionToken,
              csrfToken: 'csrf-concurrent-control-state',
              controlState: { globals: { particles: 9 } },
            }),
            'starter',
          )
        ]);

        const fileControlState = await readControlStateFile(controlStateFilePath(gamesRootPath, 'starter'));
        expect(fileControlState === null).toBe(false);
        expect([
          { globals: { particles: 2 } },
          { globals: { particles: 9 } }
        ]).toContainEqual(fileControlState);
      });
    } finally {
      restoreAuthEnv(envSnapshot);
    }
  });
});
