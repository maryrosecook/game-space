import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ADMIN_SESSION_COOKIE_NAME,
  createAdminSessionCookieHeader,
} from '../src/services/adminAuth';
import { CSRF_COOKIE_NAME } from '../src/services/csrf';
import { readMetadataFile } from '../src/services/gameVersions';
import { handleApiGameTileSnapshotPost } from '../src/services/nextBackendHandlers';
import { createGameFixture, createTempDirectory } from './testHelpers';

const TEST_SESSION_SECRET = 'session-secret-for-tests-must-be-long';
const TEST_PASSWORD_HASH =
  'scrypt$ASNFZ4mrze8BI0VniavN7w==$M+OVA7qtmUR3CHE87sPzm7h2MpJU1PXNk9qSpl2YPwHyaL8eByBbvuCTXEVTUVc/mwL9EhXgQ14qdOIyRUXu1Q==';
const ONE_BY_ONE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ0QAAAAASUVORK5CYII=';
const ONE_BY_ONE_PNG_DATA_URL = `data:image/png;base64,${ONE_BY_ONE_PNG_BASE64}`;

type AuthEnvSnapshot = {
  passwordHash: string | undefined;
  sessionSecret: string | undefined;
};

type TileSnapshotFixture = {
  gameDirectoryPath: string;
  metadataPath: string;
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

function createTileSnapshotRequest(options: {
  sessionToken: string;
  csrfToken: string;
  tilePngDataUrl: string;
}): Request {
  const cookieHeader = [
    `${ADMIN_SESSION_COOKIE_NAME}=${encodeURIComponent(options.sessionToken)}`,
    `${CSRF_COOKIE_NAME}=${encodeURIComponent(options.csrfToken)}`,
  ].join('; ');

  return new Request('https://game-space.local/api/games/starter/tile-snapshot', {
    method: 'POST',
    headers: {
      host: 'game-space.local',
      origin: 'https://game-space.local',
      cookie: cookieHeader,
      'x-csrf-token': options.csrfToken,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ tilePngDataUrl: options.tilePngDataUrl }),
  });
}

async function withTileSnapshotFixture(operation: (fixture: TileSnapshotFixture) => Promise<void>): Promise<void> {
  const tempDirectoryPath = await createTempDirectory('game-space-tile-snapshot-');
  const repoRootPath = path.join(tempDirectoryPath, 'repo');
  const gamesRootPath = path.join(repoRootPath, 'games');
  await fs.mkdir(gamesRootPath, { recursive: true });

  const gameDirectoryPath = await createGameFixture({
    gamesRootPath,
    metadata: {
      id: 'starter',
      parentId: null,
      createdTime: '2026-03-06T00:00:00.000Z',
    },
  });
  const metadataPath = path.join(gameDirectoryPath, 'metadata.json');

  const previousCwd = process.cwd();
  process.chdir(repoRootPath);

  try {
    await operation({
      gameDirectoryPath,
      metadataPath,
    });
  } finally {
    process.chdir(previousCwd);
  }
}

async function readTileSnapshotResponsePayload(response: Response): Promise<{
  status?: string;
  versionId?: string;
  tileSnapshotPath?: string;
  error?: string;
}> {
  const payload = await response.json();
  const payloadRecord: Record<string, unknown> = isRecord(payload) ? payload : {};

  return {
    status: typeof payloadRecord.status === 'string' ? payloadRecord.status : undefined,
    versionId: typeof payloadRecord.versionId === 'string' ? payloadRecord.versionId : undefined,
    tileSnapshotPath:
      typeof payloadRecord.tileSnapshotPath === 'string'
        ? payloadRecord.tileSnapshotPath
        : undefined,
    error: typeof payloadRecord.error === 'string' ? payloadRecord.error : undefined,
  };
}

describe('next backend tile snapshot handler', () => {
  it('persists and returns a unique cache-busted tile URL for each manual capture', async () => {
    const envSnapshot = setAuthEnvForTest();
    const { sessionToken } = await createAdminSessionCookieHeader(TEST_SESSION_SECRET);
    const csrfToken = 'csrf-token-for-manual-capture';

    try {
      await withTileSnapshotFixture(async ({ gameDirectoryPath, metadataPath }) => {
        const firstResponse = await handleApiGameTileSnapshotPost(
          createTileSnapshotRequest({
            sessionToken,
            csrfToken,
            tilePngDataUrl: ONE_BY_ONE_PNG_DATA_URL,
          }),
          'starter',
        );
        expect(firstResponse.status).toBe(200);
        const firstPayload = await readTileSnapshotResponsePayload(firstResponse);
        expect(firstPayload).toMatchObject({
          status: 'ok',
          versionId: 'starter',
        });
        expect(firstPayload.tileSnapshotPath).toMatch(/^\/games\/starter\/snapshots\/tile\.png\?v=/);

        const firstMetadata = await readMetadataFile(metadataPath);
        expect(firstMetadata?.tileSnapshotPath).toBe(firstPayload.tileSnapshotPath);
        const tileSnapshotFile = await fs.readFile(path.join(gameDirectoryPath, 'snapshots', 'tile.png'));
        expect(tileSnapshotFile.length).toBeGreaterThan(0);

        const secondResponse = await handleApiGameTileSnapshotPost(
          createTileSnapshotRequest({
            sessionToken,
            csrfToken,
            tilePngDataUrl: ONE_BY_ONE_PNG_DATA_URL,
          }),
          'starter',
        );
        expect(secondResponse.status).toBe(200);
        const secondPayload = await readTileSnapshotResponsePayload(secondResponse);
        expect(secondPayload).toMatchObject({
          status: 'ok',
          versionId: 'starter',
        });
        expect(secondPayload.tileSnapshotPath).toMatch(/^\/games\/starter\/snapshots\/tile\.png\?v=/);
        expect(secondPayload.tileSnapshotPath).not.toBe(firstPayload.tileSnapshotPath);

        const secondMetadata = await readMetadataFile(metadataPath);
        expect(secondMetadata?.tileSnapshotPath).toBe(secondPayload.tileSnapshotPath);
      });
    } finally {
      restoreAuthEnv(envSnapshot);
    }
  });

  it('returns 404 when the game metadata file is missing', async () => {
    const envSnapshot = setAuthEnvForTest();
    const { sessionToken } = await createAdminSessionCookieHeader(TEST_SESSION_SECRET);
    const csrfToken = 'csrf-token-for-missing-metadata';

    try {
      await withTileSnapshotFixture(async ({ metadataPath }) => {
        await fs.rm(metadataPath, { force: true });

        const response = await handleApiGameTileSnapshotPost(
          createTileSnapshotRequest({
            sessionToken,
            csrfToken,
            tilePngDataUrl: ONE_BY_ONE_PNG_DATA_URL,
          }),
          'starter',
        );
        expect(response.status).toBe(404);
        const payload = await readTileSnapshotResponsePayload(response);
        expect(payload.error).toBe('Game metadata not found');
      });
    } finally {
      restoreAuthEnv(envSnapshot);
    }
  });
});
