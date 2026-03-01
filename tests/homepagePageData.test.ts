import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildHomepagePageData } from '../src/react/homepagePageData';
import type { GameVersion } from '../src/types';

function createVersion(partial: Partial<GameVersion> & Pick<GameVersion, 'id' | 'createdTime'>): GameVersion {
  return {
    id: partial.id,
    parentId: partial.parentId ?? null,
    createdTime: partial.createdTime,
    directoryPath: partial.directoryPath ?? path.join('/tmp/games', partial.id),
    threeWords: partial.threeWords,
    tileColor: partial.tileColor,
    favorite: partial.favorite,
    tileSnapshotPath: partial.tileSnapshotPath
  };
}

describe('buildHomepagePageData', () => {
  it('returns favorites only for logged-out visitors and maps tile defaults', () => {
    const versions: GameVersion[] = [
      createVersion({
        id: 'alpha',
        createdTime: '2026-01-01T00:00:00.000Z',
        favorite: false,
        tileColor: '#000000'
      }),
      createVersion({
        id: 'beta-version',
        createdTime: '2026-01-02T00:00:00.000Z',
        favorite: true,
        threeWords: 'beta-splash-mode',
        tileSnapshotPath: '/games/beta-version/snapshots/tile.png'
      }),
      createVersion({
        id: 'gamma',
        createdTime: '2026-01-03T00:00:00.000Z',
        favorite: true
      })
    ];

    const data = buildHomepagePageData(versions, { isAdmin: false });

    expect(data).toEqual({
      authLabel: 'Login',
      showIdeasLink: false,
      tiles: [
        {
          id: 'beta-version',
          href: '/game/beta-version',
          displayId: 'beta splash mode',
          tileColor: '#1D3557',
          isFavorite: true,
          tileSnapshotPath: '/games/beta-version/snapshots/tile.png'
        },
        {
          id: 'gamma',
          href: '/game/gamma',
          displayId: 'gamma',
          tileColor: '#1D3557',
          isFavorite: true,
          tileSnapshotPath: null
        }
      ]
    });
  });

  it('returns all versions for admins and preserves explicit tile color', () => {
    const versions: GameVersion[] = [
      createVersion({
        id: 'alpha',
        createdTime: '2026-01-01T00:00:00.000Z',
        favorite: false,
        tileColor: '#123456'
      })
    ];

    const data = buildHomepagePageData(versions, { isAdmin: true });

    expect(data.authLabel).toBe('Admin');
    expect(data.showIdeasLink).toBe(true);
    expect(data.tiles).toHaveLength(1);
    expect(data.tiles[0]).toMatchObject({
      id: 'alpha',
      href: '/game/alpha',
      displayId: 'alpha',
      tileColor: '#123456',
      isFavorite: false
    });
  });
});
