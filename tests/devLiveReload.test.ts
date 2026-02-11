import { promises as fs } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { reloadTokenPath, writeReloadToken } from '../src/services/devLiveReload';
import { createTempDirectory } from './testHelpers';

describe('dev live reload tokens', () => {
  it('writes a reload token file inside the version dist directory', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-live-reload-');

    const token = await writeReloadToken(tempDirectoryPath, 'v1', () => 'token-a');

    expect(token).toBe('token-a');
    expect(await fs.readFile(reloadTokenPath(tempDirectoryPath, 'v1'), 'utf8')).toBe('token-a\n');
  });

  it('overwrites the existing token on subsequent writes', async () => {
    const tempDirectoryPath = await createTempDirectory('game-space-live-reload-overwrite-');

    await writeReloadToken(tempDirectoryPath, 'v1', () => 'token-a');
    await writeReloadToken(tempDirectoryPath, 'v1', () => 'token-b');

    expect(await fs.readFile(reloadTokenPath(tempDirectoryPath, 'v1'), 'utf8')).toBe('token-b\n');
  });
});
