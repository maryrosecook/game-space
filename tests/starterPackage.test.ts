import { promises as fs } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readObjectField(parent: JsonRecord, key: string): JsonRecord {
  const value = parent[key];
  if (!isJsonRecord(value)) {
    throw new Error(`Expected "${key}" to be an object in starter package.json`);
  }

  return value;
}

function readStringField(parent: JsonRecord, key: string): string {
  const value = parent[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Expected "${key}" to be a non-empty string in starter package.json`);
  }

  return value;
}

async function readStarterPackageJson(): Promise<JsonRecord> {
  const packageJsonPath = path.join(process.cwd(), 'games/starter/package.json');
  const rawPackageJson = await fs.readFile(packageJsonPath, 'utf8');
  const parsed: unknown = JSON.parse(rawPackageJson);
  if (!isJsonRecord(parsed)) {
    throw new Error('Expected starter package.json to contain a top-level object');
  }

  return parsed;
}

async function readStarterReadme(): Promise<string> {
  const readmePath = path.join(process.cwd(), 'games/starter/README.md');
  return fs.readFile(readmePath, 'utf8');
}

describe('starter package manifest', () => {
  it('includes the documented typecheck command and TypeScript dependency', async () => {
    const packageJson = await readStarterPackageJson();
    const scripts = readObjectField(packageJson, 'scripts');
    const devDependencies = readObjectField(packageJson, 'devDependencies');

    expect(readStringField(scripts, 'typecheck')).toBe('tsc --noEmit');
    expect(readStringField(devDependencies, 'typescript')).toBe('^5.6.3');
  });
});

describe('starter README', () => {
  it('documents that dist is generated build output and should stay ignored', async () => {
    const readme = await readStarterReadme();

    expect(readme).toContain('## Build output (`dist/`)');
    expect(readme).toContain('`dist/` is generated build output.');
    expect(readme).toContain('Do not edit files in `dist/` directly; make changes in `src/` and rebuild.');
    expect(readme).toContain('Keep `dist/` gitignored.');
  });
});
