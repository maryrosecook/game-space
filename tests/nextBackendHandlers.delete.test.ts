import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ADMIN_SESSION_COOKIE_NAME,
  createAdminSessionCookieHeader,
} from '../src/services/adminAuth';
import { CSRF_COOKIE_NAME } from '../src/services/csrf';
import { readMetadataFile } from '../src/services/gameVersions';
import { handleApiGameDelete } from '../src/services/nextBackendHandlers';
import { createGameFixture, createTempDirectory } from './testHelpers';

const TEST_SESSION_SECRET = 'session-secret-for-tests-must-be-long';
const TEST_PASSWORD_HASH =
  'scrypt$ASNFZ4mrze8BI0VniavN7w==$M+OVA7qtmUR3CHE87sPzm7h2MpJU1PXNk9qSpl2YPwHyaL8eByBbvuCTXEVTUVc/mwL9EhXgQ14qdOIyRUXu1Q==';

type AuthEnvSnapshot = {
  passwordHash: string | undefined;
  sessionSecret: string | undefined;
};

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

function createDeleteRequest(options: {
  sessionToken: string;
  csrfToken: string;
  versionId: string;
}): Request {
  const cookieHeader = [
    `${ADMIN_SESSION_COOKIE_NAME}=${encodeURIComponent(options.sessionToken)}`,
    `${CSRF_COOKIE_NAME}=${encodeURIComponent(options.csrfToken)}`,
  ].join('; ');

  return new Request(`https://game-space.local/api/games/${options.versionId}`, {
    method: 'DELETE',
    headers: {
      host: 'game-space.local',
      origin: 'https://game-space.local',
      cookie: cookieHeader,
      'x-csrf-token': options.csrfToken,
    },
  });
}

async function withDeleteFixture(
  operation: (fixture: { gamesRootPath: string }) => Promise<void>
): Promise<void> {
  const tempDirectoryPath = await createTempDirectory('game-space-delete-');
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
  await createGameFixture({
    gamesRootPath,
    metadata: {
      id: 'lineage-root',
      parentId: 'starter',
      createdTime: '2026-03-07T00:00:00.000Z',
    },
  });
  await createGameFixture({
    gamesRootPath,
    metadata: {
      id: 'lineage-child',
      parentId: 'lineage-root',
      createdTime: '2026-03-08T00:00:00.000Z',
    },
  });

  const previousCwd = process.cwd();
  process.chdir(repoRootPath);

  try {
    await operation({ gamesRootPath });
  } finally {
    process.chdir(previousCwd);
  }
}

describe('next backend delete handler', () => {
  it('backfills lineage ids for surviving clones before deleting a lineage member', async () => {
    const envSnapshot = setAuthEnvForTest();
    const { sessionToken } = await createAdminSessionCookieHeader(TEST_SESSION_SECRET);

    try {
      await withDeleteFixture(async ({ gamesRootPath }) => {
        const response = await handleApiGameDelete(
          createDeleteRequest({
            sessionToken,
            csrfToken: 'csrf-delete-lineage',
            versionId: 'lineage-root',
          }),
          'lineage-root',
        );

        expect(response.status).toBe(200);
        await expect(fs.access(path.join(gamesRootPath, 'lineage-root'))).rejects.toThrow();

        const survivingMetadata = await readMetadataFile(
          path.join(gamesRootPath, 'lineage-child', 'metadata.json')
        );
        expect(survivingMetadata?.lineageId).toBe('lineage-root');
      });
    } finally {
      restoreAuthEnv(envSnapshot);
    }
  });
});
