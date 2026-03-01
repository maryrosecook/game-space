import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import * as faviconRoute from '../next-app/app/favicon.ico/route';
import * as gamesRoute from '../next-app/app/games/[versionId]/[...assetPath]/route';
import * as publicRoute from '../next-app/app/public/[...assetPath]/route';
import { handleGamesAssetGet, handlePublicAssetGet } from '../src/services/nextBackendHandlers';
import { createGameFixture, createTempDirectory } from './testHelpers';

type StaticFixture = {
  repoRootPath: string;
  gamesRootPath: string;
};

async function withStaticFixture(operation: (fixture: StaticFixture) => Promise<void>): Promise<void> {
  const tempDirectoryPath = await createTempDirectory('game-space-next-static-');
  const repoRootPath = path.join(tempDirectoryPath, 'repo');
  const gamesRootPath = path.join(repoRootPath, 'games');
  await fs.mkdir(path.join(repoRootPath, 'src', 'public'), { recursive: true });
  await fs.mkdir(gamesRootPath, { recursive: true });

  const previousCwd = process.cwd();
  process.chdir(repoRootPath);

  try {
    await operation({
      repoRootPath,
      gamesRootPath
    });
  } finally {
    process.chdir(previousCwd);
  }
}

describe('next backend static handlers', () => {
  it('serves /public assets and keeps explicit Option B GET-only semantics', async () => {
    await withStaticFixture(async ({ repoRootPath }) => {
      const publicDirectoryPath = path.join(repoRootPath, 'src', 'public');
      const stylesPath = path.join(publicDirectoryPath, 'styles.css');
      const stylesSource = 'body { color: #123456; }\n';
      await fs.writeFile(stylesPath, stylesSource, 'utf8');

      const stylesResponse = await handlePublicAssetGet(new Request('https://game-space.local/public/styles.css'));
      expect(stylesResponse.status).toBe(200);
      expect(stylesResponse.headers.get('content-type')).toBe('text/css; charset=utf-8');
      expect(await stylesResponse.text()).toBe(stylesSource);

      const rangeRequestResponse = await handlePublicAssetGet(
        new Request('https://game-space.local/public/styles.css', {
          headers: {
            Range: 'bytes=0-3',
            'If-None-Match': '"test-etag"'
          }
        })
      );
      expect(rangeRequestResponse.status).toBe(200);
      expect(await rangeRequestResponse.text()).toBe(stylesSource);
      expect(rangeRequestResponse.headers.get('accept-ranges')).toBeNull();
      expect(rangeRequestResponse.headers.get('etag')).toBeNull();
      expect(rangeRequestResponse.headers.get('last-modified')).toBeNull();
    });
  });

  it('returns 404 for unsafe or missing /public asset paths', async () => {
    await withStaticFixture(async ({ repoRootPath }) => {
      await fs.writeFile(path.join(repoRootPath, 'src', 'public', 'styles.css'), 'body {}\n', 'utf8');

      const blockedPaths = [
        '/public/.env',
        '/public/%2e%2e/secret.txt',
        '/public/icons/%2ehidden.svg',
        '/public/%2e%2e%2fstyles.css',
        '/public/missing.css'
      ];

      for (const blockedPath of blockedPaths) {
        const blockedResponse = await handlePublicAssetGet(new Request(`https://game-space.local${blockedPath}`));
        expect(blockedResponse.status).toBe(404);
        expect(await blockedResponse.text()).toBe('Not found');
      }
    });
  });

  it('serves allowlisted /games runtime files and blocks denylisted paths', async () => {
    await withStaticFixture(async ({ gamesRootPath }) => {
      const gameDirectoryPath = await createGameFixture({
        gamesRootPath,
        metadata: {
          id: 'starter',
          parentId: null,
          createdTime: '2026-02-01T00:00:00.000Z'
        }
      });

      await fs.mkdir(path.join(gameDirectoryPath, 'dist', 'assets'), { recursive: true });
      await fs.writeFile(path.join(gameDirectoryPath, 'dist', 'assets', 'chunk.js'), 'export const chunk = 1;\n', 'utf8');
      await fs.writeFile(path.join(gameDirectoryPath, 'dist', 'reload-token.txt'), 'reload-token\n', 'utf8');
      await fs.mkdir(path.join(gameDirectoryPath, 'dist', 'nested'), { recursive: true });
      await fs.writeFile(path.join(gameDirectoryPath, 'dist', 'nested', 'reload-token.txt'), 'reload-token\n', 'utf8');
      await fs.writeFile(path.join(gameDirectoryPath, 'dist', 'game.js.map'), '{"version":3}\n', 'utf8');
      await fs.mkdir(path.join(gameDirectoryPath, 'snapshots'), { recursive: true });
      await fs.writeFile(path.join(gameDirectoryPath, 'snapshots', 'tile.png'), Buffer.from([137, 80, 78, 71]));

      const gameBundleResponse = await handleGamesAssetGet(
        new Request('https://game-space.local/games/starter/dist/game.js')
      );
      expect(gameBundleResponse.status).toBe(200);
      expect(gameBundleResponse.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
      expect(await gameBundleResponse.text()).toContain('startGame');

      const tileSnapshotResponse = await handleGamesAssetGet(
        new Request('https://game-space.local/games/starter/snapshots/tile.png')
      );
      expect(tileSnapshotResponse.status).toBe(200);
      expect(tileSnapshotResponse.headers.get('content-type')).toBe('image/png');

      const rangeRequestResponse = await handleGamesAssetGet(
        new Request('https://game-space.local/games/starter/dist/game.js', {
          headers: {
            Range: 'bytes=0-10'
          }
        })
      );
      expect(rangeRequestResponse.status).toBe(200);
      expect(await rangeRequestResponse.text()).toContain('startGame');
      expect(rangeRequestResponse.headers.get('accept-ranges')).toBeNull();

      const blockedPaths = [
        '/games/starter/metadata.json',
        '/games/starter/src/main.ts',
        '/games/starter/package.json',
        '/games/starter/node_modules/pkg/index.js',
        '/games/starter/dist/reload-token.txt',
        '/games/starter/dist/nested/reload-token.txt',
        '/games/starter/dist/game.js.map',
        '/games/starter/dist/%2e%2e/metadata.json',
        '/games/starter/dist/%2ehidden.js',
        '/games/starter/snapshots/not-tile.png'
      ];

      for (const blockedPath of blockedPaths) {
        const blockedResponse = await handleGamesAssetGet(new Request(`https://game-space.local${blockedPath}`));
        expect(blockedResponse.status).toBe(404);
        expect(await blockedResponse.text()).toBe('Not found');
      }
    });
  });

  it('keeps static route modules as GET-only handlers and returns 204 for /favicon.ico', async () => {
    expect(Object.prototype.hasOwnProperty.call(publicRoute, 'GET')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(publicRoute, 'HEAD')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(gamesRoute, 'GET')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(gamesRoute, 'HEAD')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(faviconRoute, 'GET')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(faviconRoute, 'HEAD')).toBe(false);

    const response = faviconRoute.GET();
    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
  });
});
