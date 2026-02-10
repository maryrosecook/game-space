import { type Dirent, promises as fs } from 'node:fs';
import path from 'node:path';

import { hasErrorCode, isObjectRecord } from './fsUtils';
import type { GameMetadata, GameVersion } from '../types';

const safeVersionIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

export function isSafeVersionId(versionId: string): boolean {
  return safeVersionIdPattern.test(versionId) && !versionId.includes('..');
}

export function parseGameMetadata(value: unknown): GameMetadata | null {
  if (!isObjectRecord(value)) {
    return null;
  }

  const { id, parentId, createdTime, codexSessionId } = value;
  if (typeof id !== 'string' || id.length === 0) {
    return null;
  }

  if (!(parentId === null || typeof parentId === 'string')) {
    return null;
  }

  if (typeof createdTime !== 'string') {
    return null;
  }

  const createdTimestamp = Date.parse(createdTime);
  if (!Number.isFinite(createdTimestamp)) {
    return null;
  }

  if (!(codexSessionId === undefined || codexSessionId === null || typeof codexSessionId === 'string')) {
    return null;
  }

  const normalizedSessionId = typeof codexSessionId === 'string' && codexSessionId.trim().length > 0 ? codexSessionId : null;

  return {
    id,
    parentId,
    createdTime: new Date(createdTimestamp).toISOString(),
    codexSessionId: normalizedSessionId
  };
}

export function compareByCreatedTimeDesc(left: GameVersion, right: GameVersion): number {
  const leftTimestamp = Date.parse(left.createdTime);
  const rightTimestamp = Date.parse(right.createdTime);
  const timestampDifference = rightTimestamp - leftTimestamp;
  if (timestampDifference !== 0) {
    return timestampDifference;
  }

  return right.id.localeCompare(left.id);
}

export async function readMetadataFile(metadataPath: string): Promise<GameMetadata | null> {
  let serializedMetadata: string;
  try {
    serializedMetadata = await fs.readFile(metadataPath, 'utf8');
  } catch (error: unknown) {
    if (hasErrorCode(error, 'ENOENT')) {
      return null;
    }

    throw error;
  }

  let rawMetadata: unknown;
  try {
    rawMetadata = JSON.parse(serializedMetadata) as unknown;
  } catch {
    return null;
  }

  return parseGameMetadata(rawMetadata);
}

export async function writeMetadataFile(metadataPath: string, metadata: GameMetadata): Promise<void> {
  const normalizedMetadata: GameMetadata = {
    ...metadata,
    codexSessionId: metadata.codexSessionId ?? null
  };
  await fs.writeFile(metadataPath, `${JSON.stringify(normalizedMetadata, null, 2)}\n`, 'utf8');
}

export async function listGameVersions(gamesRootPath: string): Promise<GameVersion[]> {
  let directoryEntries: Dirent[];
  try {
    directoryEntries = await fs.readdir(gamesRootPath, { withFileTypes: true });
  } catch (error: unknown) {
    if (hasErrorCode(error, 'ENOENT')) {
      return [];
    }

    throw error;
  }

  const versions: GameVersion[] = [];
  for (const entry of directoryEntries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const directoryPath = path.join(gamesRootPath, entry.name);
    const metadataPath = path.join(directoryPath, 'metadata.json');
    const metadata = await readMetadataFile(metadataPath);
    if (!metadata) {
      continue;
    }

    versions.push({
      ...metadata,
      directoryPath
    });
  }

  return versions.sort(compareByCreatedTimeDesc);
}

export function gameDirectoryPath(gamesRootPath: string, versionId: string): string {
  return path.join(gamesRootPath, versionId);
}

export async function hasGameDirectory(gamesRootPath: string, versionId: string): Promise<boolean> {
  try {
    const directoryStats = await fs.stat(gameDirectoryPath(gamesRootPath, versionId));
    return directoryStats.isDirectory();
  } catch (error: unknown) {
    if (hasErrorCode(error, 'ENOENT')) {
      return false;
    }

    throw error;
  }
}
