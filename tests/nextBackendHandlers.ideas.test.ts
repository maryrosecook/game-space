import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ADMIN_SESSION_COOKIE_NAME,
  createAdminSessionCookieHeader,
} from '../src/services/adminAuth';
import { CSRF_COOKIE_NAME } from '../src/services/csrf';
import {
  handleApiIdeasArchive,
  handleApiIdeasGet,
} from '../src/services/nextBackendHandlers';
import { createTempDirectory } from './testHelpers';

const TEST_SESSION_SECRET = 'session-secret-for-tests-must-be-long';
const TEST_PASSWORD_HASH =
  'scrypt$ASNFZ4mrze8BI0VniavN7w==$M+OVA7qtmUR3CHE87sPzm7h2MpJU1PXNk9qSpl2YPwHyaL8eByBbvuCTXEVTUVc/mwL9EhXgQ14qdOIyRUXu1Q==';

type AuthEnvSnapshot = {
  passwordHash: string | undefined;
  sessionSecret: string | undefined;
};

type IdeasFixture = {
  ideasPath: string;
};

type PersistedIdea = {
  prompt: string;
  hasBeenBuilt: boolean;
  archived?: boolean;
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

function createIdeasGetRequest(sessionToken: string): Request {
  return new Request('https://game-space.local/api/ideas', {
    headers: {
      host: 'game-space.local',
      origin: 'https://game-space.local',
      cookie: `${ADMIN_SESSION_COOKIE_NAME}=${encodeURIComponent(sessionToken)}`,
    },
  });
}

function createIdeasArchiveRequest(options: {
  sessionToken: string;
  csrfToken: string;
  ideaIndex: number;
}): Request {
  const cookieHeader = [
    `${ADMIN_SESSION_COOKIE_NAME}=${encodeURIComponent(options.sessionToken)}`,
    `${CSRF_COOKIE_NAME}=${encodeURIComponent(options.csrfToken)}`,
  ].join('; ');

  return new Request(`https://game-space.local/api/ideas/${encodeURIComponent(String(options.ideaIndex))}`, {
    method: 'DELETE',
    headers: {
      host: 'game-space.local',
      origin: 'https://game-space.local',
      cookie: cookieHeader,
      'x-csrf-token': options.csrfToken,
    },
  });
}

async function withIdeasFixture(
  ideas: readonly PersistedIdea[],
  operation: (fixture: IdeasFixture) => Promise<void>,
): Promise<void> {
  const tempDirectoryPath = await createTempDirectory('game-space-next-ideas-');
  const repoRootPath = path.join(tempDirectoryPath, 'repo');
  await fs.mkdir(repoRootPath, { recursive: true });
  const ideasPath = path.join(repoRootPath, 'ideas.json');
  await fs.writeFile(ideasPath, `${JSON.stringify(ideas, null, 2)}\n`, 'utf8');

  const previousCwd = process.cwd();
  process.chdir(repoRootPath);

  try {
    await operation({ ideasPath });
  } finally {
    process.chdir(previousCwd);
  }
}

describe('next backend ideas handlers', () => {
  it('filters archived ideas from API list while treating legacy ideas as active', async () => {
    const envSnapshot = setAuthEnvForTest();
    const { sessionToken } = await createAdminSessionCookieHeader(TEST_SESSION_SECRET);

    try {
      await withIdeasFixture(
        [
          { prompt: ' legacy active idea ', hasBeenBuilt: false },
          { prompt: 'hidden archived idea', hasBeenBuilt: false, archived: true },
          { prompt: 'visible built idea', hasBeenBuilt: true, archived: false },
        ],
        async () => {
          const response = await handleApiIdeasGet(createIdeasGetRequest(sessionToken));
          expect(response.status).toBe(200);
          const payload = (await response.json()) as {
            ideas?: unknown;
            isGenerating?: unknown;
          };
          expect(payload.isGenerating === true || payload.isGenerating === false).toBe(true);
          expect(payload.ideas).toEqual([
            { prompt: 'legacy active idea', hasBeenBuilt: false },
            { prompt: 'visible built idea', hasBeenBuilt: true },
          ]);
        },
      );
    } finally {
      restoreAuthEnv(envSnapshot);
    }
  });

  it('archives selected active idea while preserving persisted history', async () => {
    const envSnapshot = setAuthEnvForTest();
    const { sessionToken } = await createAdminSessionCookieHeader(TEST_SESSION_SECRET);
    const csrfToken = 'ideas-archive-csrf-token';

    try {
      await withIdeasFixture(
        [
          { prompt: 'historical archived', hasBeenBuilt: false, archived: true },
          { prompt: 'active keep', hasBeenBuilt: false, archived: false },
          { prompt: 'active archive me', hasBeenBuilt: true, archived: false },
        ],
        async ({ ideasPath }) => {
          const response = await handleApiIdeasArchive(
            createIdeasArchiveRequest({
              sessionToken,
              csrfToken,
              ideaIndex: 1,
            }),
            '1',
          );

          expect(response.status).toBe(200);
          const payload = (await response.json()) as { ideas?: unknown };
          expect(payload.ideas).toEqual([
            { prompt: 'active keep', hasBeenBuilt: false },
          ]);

          const persistedIdeas = JSON.parse(await fs.readFile(ideasPath, 'utf8')) as PersistedIdea[];
          expect(persistedIdeas).toEqual([
            { prompt: 'historical archived', hasBeenBuilt: false, archived: true },
            { prompt: 'active keep', hasBeenBuilt: false, archived: false },
            { prompt: 'active archive me', hasBeenBuilt: true, archived: true },
          ]);
        },
      );
    } finally {
      restoreAuthEnv(envSnapshot);
    }
  });
});
