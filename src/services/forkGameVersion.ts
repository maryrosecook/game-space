import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomInt } from 'node:crypto';

import { isObjectRecord, pathExists } from './fsUtils';
import { gameDirectoryPath, isSafeVersionId, readMetadataFile, writeMetadataFile } from './gameVersions';
import { createReadableRandomHexColor } from './tileColor';
import type { GameMetadata } from '../types';

const excludedDirectoryNames = new Set(['node_modules']);
const maxForkIdAttempts = 32;
const maxIdWordLength = 14;
const idSuffixLength = 10;
const idSuffixAlphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
const fallbackIdWords = ['new', 'arcade', 'game'] as const;
const stopWords = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'for',
  'from',
  'game',
  'how',
  'in',
  'is',
  'it',
  'its',
  'of',
  'on',
  'or',
  'that',
  'the',
  'this',
  'to',
  'with',
  'you',
  'your'
]);

type CreateForkedGameVersionOptions = {
  gamesRootPath: string;
  sourceVersionId: string;
  sourcePrompt?: string;
  idFactory?: () => string;
  now?: () => Date;
};

function sanitizePromptWords(prompt: string): string[] {
  return prompt
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && word.length <= maxIdWordLength)
    .filter((word) => !/^\d+$/.test(word))
    .filter((word) => !stopWords.has(word));
}

function uniqueWords(words: readonly string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const word of words) {
    if (seen.has(word)) {
      continue;
    }

    seen.add(word);
    deduped.push(word);
  }

  return deduped;
}

function buildIdWordsFromPrompt(prompt: string): [string, string, string] {
  const dedupedWords = uniqueWords(sanitizePromptWords(prompt));
  const selected = dedupedWords.slice(0, 3);
  while (selected.length < 3) {
    selected.push(fallbackIdWords[selected.length] ?? 'game');
  }

  return [selected[0] ?? fallbackIdWords[0], selected[1] ?? fallbackIdWords[1], selected[2] ?? fallbackIdWords[2]];
}

function getThreeWordsFromPrompt(prompt?: string): string {
  if (typeof prompt === 'string' && prompt.trim().length > 0) {
    const [first, second, third] = buildIdWordsFromPrompt(prompt);
    return `${first}-${second}-${third}`;
  }

  return `${fallbackIdWords[0]}-${fallbackIdWords[1]}-${fallbackIdWords[2]}`;
}

function createRandomAlphaNumericSuffix(length: number): string {
  let suffix = '';
  for (let index = 0; index < length; index += 1) {
    const randomIndex = randomInt(idSuffixAlphabet.length);
    suffix += idSuffixAlphabet[randomIndex] ?? idSuffixAlphabet[0];
  }

  return suffix;
}

function appendRandomIdSuffix(baseId: string): string {
  return `${baseId}-${createRandomAlphaNumericSuffix(idSuffixLength)}`;
}

function createWordTripletIdFromPrompt(prompt: string): string {
  const [first, second, third] = buildIdWordsFromPrompt(prompt);
  return appendRandomIdSuffix(`${first}-${second}-${third}`);
}

function createWordTripletId(): string {
  return appendRandomIdSuffix(`${fallbackIdWords[0]}-${fallbackIdWords[1]}-${fallbackIdWords[2]}`);
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
    sourcePrompt,
    idFactory = sourcePrompt ? () => createWordTripletIdFromPrompt(sourcePrompt) : createWordTripletId,
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
  const threeWords = getThreeWordsFromPrompt(sourcePrompt);

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
    threeWords,
    parentId: sourceVersionId,
    createdTime: now().toISOString(),
    tileColor: createReadableRandomHexColor(),
    favorite: false,
    codexSessionId: null,
    codexSessionStatus: 'none'
  };

  const forkMetadataPath = path.join(forkDirectoryPath, 'metadata.json');
  await writeMetadataFile(forkMetadataPath, forkMetadata);

  return forkMetadata;
}
