import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createForkedGameVersion } from '../src/services/forkGameVersion';
import { readMetadataFile } from '../src/services/gameVersions';
import { createGameFixture, createTempDirectory } from './testHelpers';

describe('createForkedGameVersion', () => {
  it('forks a game directory, links lineage, and leaves source untouched', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-fork-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    await fs.mkdir(gamesRootPath, { recursive: true });

    const sourceDirectoryPath = await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'source-game',
        parentId: null,
        createdTime: '2026-02-01T00:00:00.000Z'
      }
    });

    await fs.mkdir(path.join(sourceDirectoryPath, 'node_modules', 'dep'), { recursive: true });
    await fs.writeFile(path.join(sourceDirectoryPath, 'node_modules', 'dep', 'index.js'), 'module.exports={};\n');

    const created = await createForkedGameVersion({
      gamesRootPath,
      sourceVersionId: 'source-game',
      idFactory: () => 'fork-game',
      now: () => new Date('2026-03-02T00:00:00.000Z')
    });

    expect(created).toEqual({
      id: 'fork-game',
      parentId: 'source-game',
      createdTime: '2026-03-02T00:00:00.000Z'
    });

    const forkMetadata = await readMetadataFile(path.join(gamesRootPath, 'fork-game', 'metadata.json'));
    expect(forkMetadata).toEqual(created);

    const copiedSource = await fs.readFile(path.join(gamesRootPath, 'fork-game', 'src/main.ts'), 'utf8');
    expect(copiedSource).toContain('export const value = 1;');

    await expect(fs.access(path.join(gamesRootPath, 'fork-game', 'node_modules'))).rejects.toThrow();

    const sourceMetadata = await readMetadataFile(path.join(gamesRootPath, 'source-game', 'metadata.json'));
    expect(sourceMetadata).toEqual({
      id: 'source-game',
      parentId: null,
      createdTime: '2026-02-01T00:00:00.000Z'
    });
  });

  it('retries when a generated fork id already exists', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-fork-retry-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    await fs.mkdir(gamesRootPath, { recursive: true });

    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'source-game',
        parentId: null,
        createdTime: '2026-02-01T00:00:00.000Z'
      }
    });

    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'calm-oak-river',
        parentId: null,
        createdTime: '2026-02-15T00:00:00.000Z'
      }
    });

    const generatedIds = ['calm-oak-river', 'linen-drift-sage'];
    const created = await createForkedGameVersion({
      gamesRootPath,
      sourceVersionId: 'source-game',
      idFactory: () => generatedIds.shift() ?? 'linen-drift-sage',
      now: () => new Date('2026-03-02T00:00:00.000Z')
    });

    expect(created.id).toBe('linen-drift-sage');

    const forkMetadata = await readMetadataFile(path.join(gamesRootPath, 'linen-drift-sage', 'metadata.json'));
    expect(forkMetadata?.parentId).toBe('source-game');
  });

  it('throws when idFactory generates an invalid fork id', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-fork-invalid-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    await fs.mkdir(gamesRootPath, { recursive: true });

    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'source-game',
        parentId: null,
        createdTime: '2026-02-01T00:00:00.000Z'
      }
    });

    await expect(
      createForkedGameVersion({
        gamesRootPath,
        sourceVersionId: 'source-game',
        idFactory: () => '../invalid-id'
      })
    ).rejects.toThrow('Generated fork version id is invalid: ../invalid-id');
  });
});
