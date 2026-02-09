import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildAllGames,
  extractVersionIdFromSourcePath,
  type CommandRunner
} from '../src/services/gameBuildPipeline';
import { createGameFixture, createTempDirectory } from './testHelpers';

describe('game build pipeline', () => {
  it('runs install/build commands scoped to each game directory', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-build-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    await fs.mkdir(gamesRootPath, { recursive: true });

    const alphaPath = await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'alpha',
        parentId: null,
        createdTime: '2026-02-02T00:00:00.000Z'
      }
    });

    const betaPath = await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'beta',
        parentId: 'alpha',
        createdTime: '2026-02-03T00:00:00.000Z'
      }
    });

    await fs.mkdir(path.join(betaPath, 'node_modules'), { recursive: true });

    const calls: string[] = [];
    const run: CommandRunner = async (command, args) => {
      calls.push(`${command} ${args.join(' ')}`);
    };

    const builtDirectories = await buildAllGames(gamesRootPath, run);

    expect(builtDirectories).toEqual([alphaPath, betaPath]);
    expect(calls).toEqual([
      `npm --prefix ${alphaPath} install`,
      `npm --prefix ${alphaPath} run build`,
      `npm --prefix ${betaPath} run build`
    ]);
  });

  it('extracts version ids from watched source paths', () => {
    const gamesRootPath = '/tmp/repo/games';
    const sourcePath = '/tmp/repo/games/v1/src/main.ts';
    const outsidePath = '/tmp/repo/src/main.ts';

    expect(extractVersionIdFromSourcePath(sourcePath, gamesRootPath)).toBe('v1');
    expect(extractVersionIdFromSourcePath(outsidePath, gamesRootPath)).toBeNull();
  });
});
