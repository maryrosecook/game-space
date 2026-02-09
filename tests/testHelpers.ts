import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { GameMetadata } from '../src/types';

export async function createTempDirectory(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

type CreateGameFixtureOptions = {
  gamesRootPath: string;
  metadata: GameMetadata;
  includeBundle?: boolean;
};

export async function createGameFixture(options: CreateGameFixtureOptions): Promise<string> {
  const { gamesRootPath, metadata, includeBundle = true } = options;
  const gameDirectoryPath = path.join(gamesRootPath, metadata.id);

  await fs.mkdir(path.join(gameDirectoryPath, 'src'), { recursive: true });
  await fs.writeFile(path.join(gameDirectoryPath, 'src/main.ts'), 'export const value = 1;\n', 'utf8');
  await writeJsonFile(path.join(gameDirectoryPath, 'metadata.json'), metadata);
  await writeJsonFile(path.join(gameDirectoryPath, 'package.json'), {
    name: `game-${metadata.id}`,
    private: true,
    scripts: {
      build: 'echo build'
    }
  });

  if (includeBundle) {
    await fs.mkdir(path.join(gameDirectoryPath, 'dist'), { recursive: true });
    await fs.writeFile(
      path.join(gameDirectoryPath, 'dist/game.js'),
      'export function startGame() {}\n',
      'utf8'
    );
  }

  return gameDirectoryPath;
}
