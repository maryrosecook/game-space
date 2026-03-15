import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  findGameLineage,
  groupGameVersionsByLineage,
  resolveGameLineageId,
} from '../src/services/gameLineages';
import type { GameVersion } from '../src/types';

function createVersion(
  partial: Partial<GameVersion> & Pick<GameVersion, 'id' | 'createdTime'>
): GameVersion {
  return {
    id: partial.id,
    parentId: partial.parentId ?? null,
    lineageId: partial.lineageId,
    createdTime: partial.createdTime,
    directoryPath: partial.directoryPath ?? path.join('/tmp/games', partial.id),
    threeWords: partial.threeWords,
    tileColor: partial.tileColor,
    favorite: partial.favorite,
    tileSnapshotPath: partial.tileSnapshotPath,
  };
}

describe('gameLineages', () => {
  it('derives a stable lineage id from starter-rooted parent chains', () => {
    const versions = [
      createVersion({
        id: 'starter',
        createdTime: '2026-03-01T00:00:00.000Z',
      }),
      createVersion({
        id: 'lineage-root',
        parentId: 'starter',
        createdTime: '2026-03-02T00:00:00.000Z',
      }),
      createVersion({
        id: 'lineage-child',
        parentId: 'lineage-root',
        createdTime: '2026-03-03T00:00:00.000Z',
      }),
    ];

    expect(resolveGameLineageId('starter', versions)).toBe('starter');
    expect(resolveGameLineageId('lineage-root', versions)).toBe('lineage-root');
    expect(resolveGameLineageId('lineage-child', versions)).toBe('lineage-root');
  });

  it('groups versions by stored lineage id even when the original lineage root is gone', () => {
    const versions = [
      createVersion({
        id: 'surviving-sibling',
        parentId: 'missing-root',
        lineageId: 'missing-root',
        createdTime: '2026-03-04T00:00:00.000Z',
      }),
      createVersion({
        id: 'surviving-latest',
        parentId: 'surviving-sibling',
        lineageId: 'missing-root',
        createdTime: '2026-03-05T00:00:00.000Z',
      }),
      createVersion({
        id: 'independent-root',
        createdTime: '2026-03-03T00:00:00.000Z',
      }),
    ];

    expect(groupGameVersionsByLineage(versions)).toEqual([
      {
        lineageId: 'missing-root',
        versions: [versions[1], versions[0]],
      },
      {
        lineageId: 'independent-root',
        versions: [versions[2]],
      },
    ]);
    expect(findGameLineage('surviving-sibling', versions)?.lineageId).toBe('missing-root');
  });
});
