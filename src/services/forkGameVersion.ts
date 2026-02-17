import { promises as fs } from 'node:fs';
import path from 'node:path';

import { isObjectRecord, pathExists } from './fsUtils';
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

function ensureStringRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isObjectRecord(value)) {
    throw new Error(`${label} must be a JSON object`);
  }

  return value;
}

async function ensureForkPackageTypeScriptTooling(forkDirectoryPath: string): Promise<void> {
  const packageJsonPath = path.join(forkDirectoryPath, 'package.json');
  const rawPackageJson = await fs.readFile(packageJsonPath, 'utf8');

  let parsedPackageJson: unknown;
  try {
    parsedPackageJson = JSON.parse(rawPackageJson) as unknown;
  } catch {
    throw new Error(`Invalid package.json in forked game directory: ${packageJsonPath}`);
  }

  const packageJson = ensureStringRecord(parsedPackageJson, 'package.json');
  const scripts = ensureStringRecord(packageJson.scripts ?? {}, 'package.json scripts');
  const devDependencies = ensureStringRecord(
    packageJson.devDependencies ?? {},
    'package.json devDependencies'
  );

  if (!('typecheck' in scripts) || typeof scripts.typecheck !== 'string' || scripts.typecheck.trim().length === 0) {
    scripts.typecheck = 'tsc --noEmit';
  }

  if (!('typescript' in devDependencies) || typeof devDependencies.typescript !== 'string') {
    devDependencies.typescript = '^5.6.3';
  }

  packageJson.scripts = scripts;
  packageJson.devDependencies = devDependencies;

  await fs.writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
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

  await ensureForkPackageTypeScriptTooling(forkDirectoryPath);

  const forkMetadata: GameMetadata = {
    id: forkVersionId,
    parentId: sourceVersionId,
    createdTime: now().toISOString(),
    codexSessionId: null,
    codexSessionStatus: 'none'
  };

  const forkMetadataPath = path.join(forkDirectoryPath, 'metadata.json');
  await writeMetadataFile(forkMetadataPath, forkMetadata);

  return forkMetadata;
}
