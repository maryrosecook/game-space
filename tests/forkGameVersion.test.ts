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

    expect(created).toMatchObject({
      id: 'fork-game',
      parentId: 'source-game',
      createdTime: '2026-03-02T00:00:00.000Z',
      favorite: false,
      codexSessionId: null,
      codexSessionStatus: 'none'
    });
    expect(created.tileColor).toMatch(/^#[0-9A-F]{6}$/);

    const forkMetadata = await readMetadataFile(path.join(gamesRootPath, 'fork-game', 'metadata.json'));
    expect(forkMetadata).toEqual(created);

    const copiedSource = await fs.readFile(path.join(gamesRootPath, 'fork-game', 'src/main.ts'), 'utf8');
    expect(copiedSource).toContain('export const value = 1;');


    const forkPackageJson = JSON.parse(
      await fs.readFile(path.join(gamesRootPath, 'fork-game', 'package.json'), 'utf8')
    ) as {
      scripts?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };
    expect(forkPackageJson.scripts?.typecheck).toBe('tsc --noEmit');
    expect(forkPackageJson.devDependencies?.typescript).toBe('^5.6.3');

    const sourcePackageJson = JSON.parse(await fs.readFile(path.join(sourceDirectoryPath, 'package.json'), 'utf8')) as {
      scripts?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };
    expect(sourcePackageJson.scripts?.typecheck).toBeUndefined();
    expect(sourcePackageJson.devDependencies?.typescript).toBeUndefined();
    await expect(fs.access(path.join(gamesRootPath, 'fork-game', 'node_modules'))).rejects.toThrow();

    const sourceMetadata = await readMetadataFile(path.join(gamesRootPath, 'source-game', 'metadata.json'));
    expect(sourceMetadata).toEqual({
      id: 'source-game',
      parentId: null,
      createdTime: '2026-02-01T00:00:00.000Z',
      favorite: false,
      codexSessionId: null,
      codexSessionStatus: 'none'
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

  it('derives a descriptive three-word id from the source prompt and appends a random suffix', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-fork-prompt-id-');
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

    const created = await createForkedGameVersion({
      gamesRootPath,
      sourceVersionId: 'source-game',
      sourcePrompt: 'Build a neon racing game with drifting cars and boost pads',
      now: () => new Date('2026-03-02T00:00:00.000Z')
    });

    expect(created.id).toMatch(/^build-neon-racing-[a-z0-9]{10}$/);

    const second = await createForkedGameVersion({
      gamesRootPath,
      sourceVersionId: 'source-game',
      sourcePrompt: 'Build a neon racing game with drifting cars and boost pads',
      now: () => new Date('2026-03-02T00:00:00.000Z')
    });

    expect(second.id).toMatch(/^build-neon-racing-[a-z0-9]{10}$/);
    expect(second.id).not.toBe(created.id);
  });

  it('uses fallback words and appends a random suffix when no source prompt is provided', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-fork-fallback-id-');
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

    const created = await createForkedGameVersion({
      gamesRootPath,
      sourceVersionId: 'source-game',
      now: () => new Date('2026-03-02T00:00:00.000Z')
    });

    expect(created.id).toMatch(/^new-arcade-game-[a-z0-9]{10}$/);
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
