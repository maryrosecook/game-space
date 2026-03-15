import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildHomepagePageData } from '../src/app/shared/homepagePageData';
import type { GameVersion } from '../src/types';

function createVersion(partial: Partial<GameVersion> & Pick<GameVersion, 'id' | 'createdTime'>): GameVersion {
  return {
    id: partial.id,
    parentId: partial.parentId ?? null,
    lineageId: partial.lineageId,
    createdTime: partial.createdTime,
    directoryPath: partial.directoryPath ?? path.join('/tmp/games', partial.id),
    threeWords: partial.threeWords,
    tileColor: partial.tileColor,
    favorite: partial.favorite,
    tileSnapshotPath: partial.tileSnapshotPath
  };
}

describe('buildHomepagePageData', () => {
  it('returns one tile per lineage for logged-out visitors and keeps favorite visibility scoped to favorite clones', () => {
    const versions: GameVersion[] = [
      createVersion({
        id: 'alpha',
        createdTime: '2026-01-01T00:00:00.000Z',
        favorite: false,
        tileColor: '#000000'
      }),
      createVersion({
        id: 'beta-root',
        createdTime: '2026-01-02T00:00:00.000Z',
        parentId: 'starter',
        favorite: true,
        threeWords: 'beta-splash-mode',
        tileSnapshotPath: '/games/beta-root/snapshots/tile.png?v=cached'
      }),
      createVersion({
        id: 'beta-child',
        createdTime: '2026-01-04T00:00:00.000Z',
        parentId: 'beta-root',
        favorite: false,
        threeWords: 'beta-afterglow-shift',
        tileSnapshotPath: '/games/beta-child/snapshots/tile.png?v=cached'
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
          lineageId: 'gamma',
          id: 'gamma',
          href: '/game/gamma',
          displayId: 'gamma',
          tileColor: '#1D3557',
          isFavorite: true,
          tileSnapshotPath: null
        },
        {
          lineageId: 'beta-root',
          id: 'beta-root',
          href: '/game/beta-root',
          displayId: 'beta splash mode',
          tileColor: '#1D3557',
          isFavorite: true,
          tileSnapshotPath: '/games/beta-root/snapshots/tile.png?v=cached'
        }
      ]
    });
  });

  it('returns one tile per lineage for admins and uses the newest clone as the representative tile', () => {
    const versions: GameVersion[] = [
      createVersion({
        id: 'alpha',
        createdTime: '2026-01-01T00:00:00.000Z',
        favorite: false,
        tileColor: '#123456'
      }),
      createVersion({
        id: 'beta-root',
        createdTime: '2026-01-02T00:00:00.000Z',
        parentId: 'starter',
        favorite: true,
        threeWords: 'beta-splash-mode',
        tileSnapshotPath: '/games/beta-root/snapshots/tile.png?v=cached'
      }),
      createVersion({
        id: 'beta-child',
        createdTime: '2026-01-04T00:00:00.000Z',
        parentId: 'beta-root',
        favorite: false,
        threeWords: 'beta-afterglow-shift',
        tileColor: '#345678',
        tileSnapshotPath: '/games/beta-child/snapshots/tile.png?v=latest'
      })
    ];

    const data = buildHomepagePageData(versions, { isAdmin: true });

    expect(data).toEqual({
      authLabel: 'Admin',
      showIdeasLink: true,
      tiles: [
        {
          lineageId: 'beta-root',
          id: 'beta-child',
          href: '/game/beta-child',
          displayId: 'beta afterglow shift',
          tileColor: '#345678',
          isFavorite: true,
          tileSnapshotPath: '/games/beta-child/snapshots/tile.png?v=latest'
        },
        {
          lineageId: 'alpha',
          id: 'alpha',
          href: '/game/alpha',
          displayId: 'alpha',
          tileColor: '#123456',
          isFavorite: false,
          tileSnapshotPath: null
        }
      ]
    });
  });
});
