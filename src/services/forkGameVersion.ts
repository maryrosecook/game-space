import { promises as fs } from 'node:fs';
import path from 'node:path';

import { pathExists } from './fsUtils';
import { gameDirectoryPath, isSafeVersionId, readMetadataFile, writeMetadataFile } from './gameVersions';
import type { GameMetadata } from '../types';

const excludedDirectoryNames = new Set(['node_modules']);
const maxForkIdAttempts = 32;
const forkIdWords = [
  'acorn',
  'amber',
  'brook',
  'calm',
  'cedar',
  'cloud',
  'coast',
  'copper',
  'dawn',
  'drift',
  'elm',
  'field',
  'flint',
  'glade',
  'harbor',
  'heather',
  'hollow',
  'iris',
  'ivy',
  'linen',
  'meadow',
  'mist',
  'oak',
  'opal',
  'palm',
  'pebble',
  'pine',
  'river',
  'sage',
  'spruce',
  'stone',
  'willow'
] as const;

type CreateForkedGameVersionOptions = {
  gamesRootPath: string;
  sourceVersionId: string;
  idFactory?: () => string;
  now?: () => Date;
};

function randomIndex(maxExclusive: number): number {
  return Math.floor(Math.random() * maxExclusive);
}

function createWordTripletId(): string {
  const first = forkIdWords[randomIndex(forkIdWords.length)] ?? forkIdWords[0];
  const second = forkIdWords[randomIndex(forkIdWords.length)] ?? forkIdWords[0];
  const third = forkIdWords[randomIndex(forkIdWords.length)] ?? forkIdWords[0];
  return `${first}-${second}-${third}`;
}

async function createUniqueForkVersionId(gamesRootPath: string, idFactory: () => string): Promise<string> {
  for (let attempt = 0; attempt < maxForkIdAttempts; attempt += 1) {
    const candidateId = idFactory();
    if (!isSafeVersionId(candidateId)) {
      throw new Error(`Generated fork version id is invalid: ${candidateId}`);
    }

    const candidateDirectoryPath = gameDirectoryPath(gamesRootPath, candidateId);
    if (!(await pathExists(candidateDirectoryPath))) {
      return candidateId;
    }
  }

  throw new Error(`Unable to generate unique fork version id after ${maxForkIdAttempts} attempts`);
}

export async function createForkedGameVersion(options: CreateForkedGameVersionOptions): Promise<GameMetadata> {
  const {
    gamesRootPath,
    sourceVersionId,
    idFactory = createWordTripletId,
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

  const forkVersionId = await createUniqueForkVersionId(gamesRootPath, idFactory);

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
    createdTime: now().toISOString(),
    codexSessionId: null
  };

  const forkMetadataPath = path.join(forkDirectoryPath, 'metadata.json');
  await writeMetadataFile(forkMetadataPath, forkMetadata);

  return forkMetadata;
}
