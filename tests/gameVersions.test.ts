import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { isSafeVersionId, listGameVersions, parseGameMetadata } from '../src/services/gameVersions';
import { createGameFixture, createTempDirectory } from './testHelpers';

describe('game version discovery', () => {
  it('sorts valid game versions in reverse chronological order', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-list-');
    const gamesRootPath = path.join(tempDirectoryPath, 'games');
    await fs.mkdir(gamesRootPath, { recursive: true });

    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'old-game',
        parentId: null,
        createdTime: '2026-01-01T00:00:00.000Z'
      }
    });

    await createGameFixture({
      gamesRootPath,
      metadata: {
        id: 'new-game',
        parentId: 'old-game',
        createdTime: '2026-02-01T00:00:00.000Z'
      }
    });

    await fs.mkdir(path.join(gamesRootPath, 'broken'), { recursive: true });
    await fs.writeFile(
      path.join(gamesRootPath, 'broken', 'metadata.json'),
      '{"id":"broken","parentId":null,"createdTime":"not-a-time"}',
      'utf8'
    );

    const versions = await listGameVersions(gamesRootPath);
    expect(versions.map((version) => version.id)).toEqual(['new-game', 'old-game']);
  });

  it('normalizes parseable timestamps to ISO-8601 and rejects invalid structures', () => {
    const normalized = parseGameMetadata({
      id: 'v1',
      parentId: null,
      createdTime: '2026-02-01T12:00:00-05:00'
    });

    expect(normalized?.createdTime).toBe('2026-02-01T17:00:00.000Z');
    expect(
      parseGameMetadata({
        id: 'bad',
        parentId: 3,
        createdTime: '2026-02-01T17:00:00.000Z'
      })
    ).toBeNull();
  });

  it('accepts safe version ids and rejects dot-segment ids', () => {
    expect(isSafeVersionId('v1-bounce')).toBe(true);
    expect(isSafeVersionId('v1.2')).toBe(true);

    expect(isSafeVersionId('.')).toBe(false);
    expect(isSafeVersionId('..')).toBe(false);
    expect(isSafeVersionId('.hidden')).toBe(false);
    expect(isSafeVersionId('v1..2')).toBe(false);
  });
});
