import { spawn } from 'node:child_process';
import { type Dirent, promises as fs } from 'node:fs';
import path from 'node:path';

import { hasErrorCode, pathExists } from './fsUtils';

type SpawnOptions = {
  cwd?: string;
};

export type CommandRunner = (
  command: string,
  args: readonly string[],
  options?: SpawnOptions
) => Promise<void>;

export async function runCommand(
  command: string,
  args: readonly string[],
  options: SpawnOptions = {}
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const childProcess = spawn(command, args, {
      cwd: options.cwd,
      stdio: 'inherit'
    });

    childProcess.on('error', (error) => {
      reject(error);
    });

    childProcess.on('close', (exitCode) => {
      if (exitCode === 0) {
        resolve();
        return;
      }

      reject(new Error(`Command failed: ${command} ${args.join(' ')} (exit ${exitCode ?? 'unknown'})`));
    });
  });
}

export async function discoverGameDirectories(gamesRootPath: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(gamesRootPath, { withFileTypes: true });
  } catch (error: unknown) {
    if (hasErrorCode(error, 'ENOENT')) {
      return [];
    }

    throw error;
  }

  const gameDirectories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(gamesRootPath, entry.name));

  gameDirectories.sort((left, right) => left.localeCompare(right));
  return gameDirectories;
}

export async function ensureGameDependencies(
  gameDirectoryPath: string,
  run: CommandRunner = runCommand
): Promise<void> {
  const nodeModulesPath = path.join(gameDirectoryPath, 'node_modules');
  if (!(await pathExists(nodeModulesPath))) {
    await run('npm', ['--prefix', gameDirectoryPath, 'install']);
  }
}

export async function buildGameDirectory(
  gameDirectoryPath: string,
  run: CommandRunner = runCommand
): Promise<void> {
  await ensureGameDependencies(gameDirectoryPath, run);
  await run('npm', ['--prefix', gameDirectoryPath, 'run', 'build']);
}

async function hasPackageJson(gameDirectoryPath: string): Promise<boolean> {
  const packageJsonPath = path.join(gameDirectoryPath, 'package.json');
  return pathExists(packageJsonPath);
}

export async function buildAllGames(
  gamesRootPath: string,
  run: CommandRunner = runCommand
): Promise<string[]> {
  const gameDirectories = await discoverGameDirectories(gamesRootPath);
  const builtDirectories: string[] = [];

  for (const gameDirectoryPath of gameDirectories) {
    if (!(await hasPackageJson(gameDirectoryPath))) {
      continue;
    }

    await buildGameDirectory(gameDirectoryPath, run);
    builtDirectories.push(gameDirectoryPath);
  }

  return builtDirectories;
}

export function extractVersionIdFromSourcePath(
  sourcePath: string,
  gamesRootPath: string
): string | null {
  const relativePath = path.relative(gamesRootPath, sourcePath);
  if (relativePath.startsWith('..')) {
    return null;
  }

  const segments = relativePath.split(path.sep);
  const versionId = segments[0] ?? null;
  if (!versionId) {
    return null;
  }

  const sourceDirectorySegment = segments[1] ?? null;
  if (sourceDirectorySegment !== 'src') {
    return null;
  }

  return versionId;
}
