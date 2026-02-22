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

    expect(normalized?.codexSessionId).toBeNull();
    expect(normalized?.codexSessionStatus).toBe('none');
    expect(normalized?.createdTime).toBe('2026-02-01T17:00:00.000Z');
    expect(normalized?.tileColor).toBeUndefined();
    expect(normalized?.favorite).toBe(false);
    expect(
      parseGameMetadata({
        id: 'bad',
        parentId: 3,
        createdTime: '2026-02-01T17:00:00.000Z'
      })
    ).toBeNull();
  });

  it('preserves codexSessionId when present and rejects invalid codexSessionId values', () => {
    expect(
      parseGameMetadata({
        id: 'v2',
        parentId: 'v1',
        createdTime: '2026-02-02T00:00:00.000Z',
        codexSessionId: '019c48a7-3918-7123-bc60-0d7cddb4d5d4'
      })
    ).toEqual({
      id: 'v2',
      parentId: 'v1',
      createdTime: '2026-02-02T00:00:00.000Z',
      favorite: false,
      codexSessionId: '019c48a7-3918-7123-bc60-0d7cddb4d5d4',
      codexSessionStatus: 'stopped'
    });

    expect(
      parseGameMetadata({
        id: 'v2',
        parentId: null,
        createdTime: '2026-02-02T00:00:00.000Z',
        codexSessionId: 42
      })
    ).toBeNull();
  });

  it('accepts explicit codex session lifecycle status values', () => {
    expect(
      parseGameMetadata({
        id: 'v3',
        parentId: 'v2',
        createdTime: '2026-02-03T00:00:00.000Z',
        codexSessionStatus: 'created'
      })
    ).toEqual({
      id: 'v3',
      parentId: 'v2',
      createdTime: '2026-02-03T00:00:00.000Z',
      favorite: false,
      codexSessionId: null,
      codexSessionStatus: 'created'
    });

    expect(
      parseGameMetadata({
        id: 'v3',
        parentId: null,
        createdTime: '2026-02-03T00:00:00.000Z',
        codexSessionStatus: 'invalid-status'
      })
    ).toEqual({
      id: 'v3',
      parentId: null,
      createdTime: '2026-02-03T00:00:00.000Z',
      favorite: false,
      codexSessionId: null,
      codexSessionStatus: 'none'
    });
  });

  it('normalizes valid tile colors and rejects invalid tileColor values', () => {
    expect(
      parseGameMetadata({
        id: 'v4',
        parentId: 'v3',
        createdTime: '2026-02-04T00:00:00.000Z',
        tileColor: '#1a2b3c'
      })
    ).toEqual({
      id: 'v4',
      parentId: 'v3',
      createdTime: '2026-02-04T00:00:00.000Z',
      tileColor: '#1A2B3C',
      favorite: false,
      codexSessionId: null,
      codexSessionStatus: 'none'
    });

    expect(
      parseGameMetadata({
        id: 'v4',
        parentId: null,
        createdTime: '2026-02-04T00:00:00.000Z',
        tileColor: 'blue'
      })
    ).toEqual({
      id: 'v4',
      parentId: null,
      createdTime: '2026-02-04T00:00:00.000Z',
      tileColor: undefined,
      favorite: false,
      codexSessionId: null,
      codexSessionStatus: 'none'
    });

    expect(
      parseGameMetadata({
        id: 'v4',
        parentId: null,
        createdTime: '2026-02-04T00:00:00.000Z',
        tileColor: 12
      })
    ).toBeNull();
  });

  it('accepts optional three-word labels and rejects invalid types', () => {
    expect(
      parseGameMetadata({
        id: 'v6',
        parentId: null,
        createdTime: '2026-02-06T00:00:00.000Z',
        threeWords: 'build-neon-racing'
      })
    ).toEqual({
      id: 'v6',
      threeWords: 'build-neon-racing',
      parentId: null,
      createdTime: '2026-02-06T00:00:00.000Z',
      favorite: false,
      codexSessionId: null,
      codexSessionStatus: 'none'
    });

    expect(
      parseGameMetadata({
        id: 'v6',
        parentId: null,
        createdTime: '2026-02-06T00:00:00.000Z',
        threeWords: 42
      })
    ).toBeNull();
  });

  it('accepts prompt text and rejects invalid prompt values', () => {
    expect(
      parseGameMetadata({
        id: 'v7',
        parentId: null,
        createdTime: '2026-02-07T00:00:00.000Z',
        prompt: 'line 1\nline 2'
      })
    ).toEqual({
      id: 'v7',
      parentId: null,
      createdTime: '2026-02-07T00:00:00.000Z',
      prompt: 'line 1\nline 2',
      favorite: false,
      codexSessionId: null,
      codexSessionStatus: 'none'
    });

    expect(
      parseGameMetadata({
        id: 'v7',
        parentId: null,
        createdTime: '2026-02-07T00:00:00.000Z',
        prompt: '   '
      })
    ).toEqual({
      id: 'v7',
      parentId: null,
      createdTime: '2026-02-07T00:00:00.000Z',
      favorite: false,
      codexSessionId: null,
      codexSessionStatus: 'none'
    });

    expect(
      parseGameMetadata({
        id: 'v7',
        parentId: null,
        createdTime: '2026-02-07T00:00:00.000Z',
        prompt: 42
      })
    ).toBeNull();
  });

  it('parses favorite booleans and rejects invalid favorite values', () => {
    expect(
      parseGameMetadata({
        id: 'v5',
        parentId: null,
        createdTime: '2026-02-05T00:00:00.000Z',
        favorite: true
      })
    ).toEqual({
      id: 'v5',
      parentId: null,
      createdTime: '2026-02-05T00:00:00.000Z',
      favorite: true,
      codexSessionId: null,
      codexSessionStatus: 'none'
    });

    expect(
      parseGameMetadata({
        id: 'v5',
        parentId: null,
        createdTime: '2026-02-05T00:00:00.000Z',
        favorite: 'yes'
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
