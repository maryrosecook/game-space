import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  isSafeVersionId,
  listGameVersions,
  parseGameMetadata,
  readMetadataFile,
  writeMetadataFile
} from '../src/services/gameVersions';
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

  it('writes complex prompt text as valid JSON metadata', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-write-metadata-prompt-');
    const metadataPath = path.join(tempDirectoryPath, 'metadata.json');
    const promptText = `Ember Shepherd — A cozy campfire puzzle-action game set in a ink-wash illustrated forest at dusk.
Entities & Mechanics:

Embers (amber, red, blue glowing sparks): fall from the top of the screen, bounce off platforms.
The player taps an ember mid-flight to flip its horizontal direction 180°. One tap = one redirect.
"Flame Towers" appear when 3 same-colored embers land together.
Rain clouds douse towers; lose all towers and it's game over.`;

    await writeMetadataFile(metadataPath, {
      id: 'ember-shepherd',
      parentId: null,
      createdTime: '2026-02-08T00:00:00.000Z',
      prompt: promptText,
      codexSessionId: null,
      codexSessionStatus: 'none'
    });

    const serializedMetadata = await fs.readFile(metadataPath, 'utf8');
    expect(() => JSON.parse(serializedMetadata)).not.toThrow();

    const parsedMetadata = await readMetadataFile(metadataPath);
    expect(parsedMetadata?.prompt).toBe(promptText);
  });

  it('serializes concurrent metadata writes without corrupting JSON', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-write-metadata-concurrent-');
    const metadataPath = path.join(tempDirectoryPath, 'metadata.json');
    const promptValues = Array.from(
      { length: 24 },
      (_, index) => `prompt ${index} — "slot ${index}"\nline two with slash / and tab\tvalue`
    );

    await Promise.all(
      promptValues.map((prompt, index) =>
        writeMetadataFile(metadataPath, {
          id: 'concurrent-game',
          parentId: 'source-game',
          createdTime: new Date(Date.UTC(2026, 1, 9, 0, 0, index)).toISOString(),
          prompt,
          favorite: index % 2 === 0,
          codexSessionId: null,
          codexSessionStatus: 'created'
        })
      )
    );

    const serializedMetadata = await fs.readFile(metadataPath, 'utf8');
    expect(() => JSON.parse(serializedMetadata)).not.toThrow();

    const parsedMetadata = await readMetadataFile(metadataPath);
    expect(parsedMetadata).not.toBeNull();
    if (!parsedMetadata) {
      throw new Error('Expected metadata after concurrent writes');
    }

    expect(parsedMetadata.id).toBe('concurrent-game');
    expect(promptValues).toContain(parsedMetadata.prompt);
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
