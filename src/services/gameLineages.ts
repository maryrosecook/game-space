import type { GameMetadata, GameVersion } from '../types';
import { compareByCreatedTimeDesc } from './gameVersions';

const STARTER_VERSION_ID = 'starter';

type LineageVersionLike = Pick<GameMetadata, 'id' | 'parentId' | 'lineageId'>;

export type GameLineage = {
  lineageId: string;
  versions: readonly GameVersion[];
};

function normalizeLineageId(lineageId: string | null | undefined): string | null {
  if (typeof lineageId !== 'string') {
    return null;
  }

  const trimmedLineageId = lineageId.trim();
  return trimmedLineageId.length > 0 ? trimmedLineageId : null;
}

function resolveLineageIdFromMap(
  version: LineageVersionLike,
  versionById: ReadonlyMap<string, LineageVersionLike>
): string {
  const storedLineageId = normalizeLineageId(version.lineageId);
  if (storedLineageId) {
    return storedLineageId;
  }

  let currentVersion: LineageVersionLike = version;
  const visitedVersionIds = new Set<string>();
  while (true) {
    const currentStoredLineageId = normalizeLineageId(currentVersion.lineageId);
    if (currentStoredLineageId) {
      return currentStoredLineageId;
    }

    if (currentVersion.parentId === null) {
      return currentVersion.id;
    }

    if (visitedVersionIds.has(currentVersion.id)) {
      return currentVersion.id;
    }

    visitedVersionIds.add(currentVersion.id);
    const parentVersion = versionById.get(currentVersion.parentId);
    if (!parentVersion) {
      return currentVersion.id;
    }

    if (parentVersion.id === STARTER_VERSION_ID) {
      return currentVersion.id;
    }

    currentVersion = parentVersion;
  }
}

export function resolveGameLineageId(
  versionId: string,
  versions: readonly LineageVersionLike[]
): string | null {
  const versionById = new Map(versions.map((version) => [version.id, version]));
  const version = versionById.get(versionId);
  if (!version) {
    return null;
  }

  return resolveLineageIdFromMap(version, versionById);
}

export function groupGameVersionsByLineage(versions: readonly GameVersion[]): GameLineage[] {
  const versionById = new Map(versions.map((version) => [version.id, version]));
  const versionsByLineageId = new Map<string, GameVersion[]>();
  for (const version of versions) {
    const lineageId = resolveLineageIdFromMap(version, versionById);
    const lineageVersions = versionsByLineageId.get(lineageId);
    if (lineageVersions) {
      lineageVersions.push(version);
      continue;
    }

    versionsByLineageId.set(lineageId, [version]);
  }

  return Array.from(versionsByLineageId.entries())
    .map(([lineageId, lineageVersions]) => ({
      lineageId,
      versions: [...lineageVersions].sort(compareByCreatedTimeDesc),
    }))
    .sort((left, right) => {
      const leftRepresentative = left.versions[0];
      const rightRepresentative = right.versions[0];
      if (!leftRepresentative || !rightRepresentative) {
        return 0;
      }

      return compareByCreatedTimeDesc(leftRepresentative, rightRepresentative);
    });
}

export function findGameLineage(
  versionId: string,
  versions: readonly GameVersion[]
): GameLineage | null {
  for (const lineage of groupGameVersionsByLineage(versions)) {
    if (lineage.versions.some((version) => version.id === versionId)) {
      return lineage;
    }
  }

  return null;
}
