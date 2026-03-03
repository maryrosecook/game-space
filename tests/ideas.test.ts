import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { readIdeasFile, writeIdeasFile } from '../src/services/ideas';
import { createTempDirectory } from './testHelpers';

describe('ideas file persistence', () => {
  it('normalizes legacy ideas by defaulting base game metadata to starter', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-ideas-normalize-');
    const ideasPath = path.join(tempDirectoryPath, 'ideas.json');

    await fs.writeFile(
      ideasPath,
      `${JSON.stringify([{ prompt: 'legacy idea', hasBeenBuilt: false }], null, 2)}\n`,
      'utf8'
    );

    const ideas = await readIdeasFile(ideasPath);
    expect(ideas).toEqual([
      {
        prompt: 'legacy idea',
        hasBeenBuilt: false,
        baseGame: {
          id: 'starter',
          label: 'starter'
        }
      }
    ]);
  });

  it('preserves explicit base game metadata on read/write cycles', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-ideas-roundtrip-');
    const ideasPath = path.join(tempDirectoryPath, 'ideas.json');

    const initialIdeas = [
      {
        prompt: 'new idea',
        hasBeenBuilt: true,
        baseGame: {
          id: 'sparkle-zone',
          label: 'sparkle zone',
          tileSnapshotPath: '/games/sparkle-zone/snapshots/tile.png'
        }
      }
    ];

    await writeIdeasFile(ideasPath, initialIdeas);
    const persistedIdeas = await readIdeasFile(ideasPath);

    expect(persistedIdeas).toEqual(initialIdeas);
  });

  it('supports legacy base game fields for backward compatibility', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-ideas-legacy-base-game-');
    const ideasPath = path.join(tempDirectoryPath, 'ideas.json');

    await fs.writeFile(
      ideasPath,
      `${JSON.stringify(
        [
          {
            prompt: 'legacy with base game id',
            hasBeenBuilt: false,
            baseGameId: 'custom-game',
            baseGameLabel: 'custom game',
            baseGameTileSnapshotPath: '/games/custom-game/snapshots/tile.png'
          }
        ],
        null,
        2
      )}\n`,
      'utf8'
    );

    const ideas = await readIdeasFile(ideasPath);

    expect(ideas).toEqual([
      {
        prompt: 'legacy with base game id',
        hasBeenBuilt: false,
        baseGame: {
          id: 'custom-game',
          label: 'custom game',
          tileSnapshotPath: '/games/custom-game/snapshots/tile.png'
        }
      }
    ]);
  });
});
