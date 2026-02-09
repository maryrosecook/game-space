import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { gameDirectoryPath, isSafeVersionId, readMetadataFile } from './gameVersions';
import type { GameMetadata } from '../types';

const excludedDirectoryNames = new Set(['node_modules']);

type CreateForkedGameVersionOptions = {
  gamesRootPath: string;
  sourceVersionId: string;
  idFactory?: () => string;
  now?: () => Date;
};

export async function createForkedGameVersion(options: CreateForkedGameVersionOptions): Promise<GameMetadata> {
  const {
    gamesRootPath,
    sourceVersionId,
    idFactory = randomUUID,
    now = () => new Date()
  } = options;

  if (!isSafeVersionId(sourceVersionId)) {
    throw new Error(`Invalid source version id: ${sourceVersionId}`);
  }

  const sourceDirectoryPath = gameDirectoryPath(gamesRootPath, sourceVersionId);
  const sourceMetadataPath = path.join(sourceDirectoryPath, 'metadata.json');
  const sourceMetadata = await readMetadataFile(sourceMetadataPath);
  if (!sourceMetadata) {
    throw new Error(`Source version metadata missing: ${sourceVersionId}`);
  }

  const forkVersionId = idFactory();
  if (!isSafeVersionId(forkVersionId)) {
    throw new Error(`Generated fork version id is invalid: ${forkVersionId}`);
  }

  const forkDirectoryPath = gameDirectoryPath(gamesRootPath, forkVersionId);
  await fs.cp(sourceDirectoryPath, forkDirectoryPath, {
    recursive: true,
    filter: (copiedSourcePath) => {
      const baseName = path.basename(copiedSourcePath);
      return !excludedDirectoryNames.has(baseName);
    }
  });

  const forkMetadata: GameMetadata = {
    id: forkVersionId,
    parentId: sourceVersionId,
    createdTime: now().toISOString()
  };

  const forkMetadataPath = path.join(forkDirectoryPath, 'metadata.json');
  await fs.writeFile(forkMetadataPath, `${JSON.stringify(forkMetadata, null, 2)}\n`, 'utf8');

  return forkMetadata;
}
