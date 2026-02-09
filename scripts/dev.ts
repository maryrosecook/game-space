import { spawn } from 'node:child_process';
import path from 'node:path';

import chokidar from 'chokidar';

import {
  buildAllGames,
  buildGameDirectory,
  extractVersionIdFromSourcePath
} from '../src/services/gameBuildPipeline';

const gamesRootPath = path.join(process.cwd(), 'games');

function normalizePathSeparators(filePath: string): string {
  return filePath.replaceAll('\\', '/');
}

function shouldIgnoreWatchPath(watchedPath: string): boolean {
  const normalizedPath = normalizePathSeparators(watchedPath);
  return (
    normalizedPath.includes('/node_modules/') ||
    normalizedPath.includes('/dist/') ||
    normalizedPath.endsWith('/metadata.json') ||
    normalizedPath.endsWith('/package.json')
  );
}

async function main(): Promise<void> {
  await buildAllGames(gamesRootPath);

  const backendProcess = spawn('tsx', ['src/server.ts'], {
    stdio: 'inherit',
    env: process.env
  });

  const pendingBuildTimers = new Map<string, NodeJS.Timeout>();
  const activeBuilds = new Set<string>();

  async function runBuild(versionId: string): Promise<void> {
    if (activeBuilds.has(versionId)) {
      return;
    }

    activeBuilds.add(versionId);
    const gameDirectoryPath = path.join(gamesRootPath, versionId);
    try {
      await buildGameDirectory(gameDirectoryPath);
      console.log(`Rebuilt ${versionId}`);
    } catch (error: unknown) {
      console.error(`Failed to rebuild ${versionId}`, error);
    } finally {
      activeBuilds.delete(versionId);
    }
  }

  function scheduleBuild(versionId: string): void {
    const existingTimer = pendingBuildTimers.get(versionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      pendingBuildTimers.delete(versionId);
      void runBuild(versionId);
    }, 120);

    pendingBuildTimers.set(versionId, timer);
  }

  const sourceWatcher = chokidar.watch(gamesRootPath, {
    ignoreInitial: true,
    ignored: shouldIgnoreWatchPath,
    persistent: true
  });

  sourceWatcher.on('all', (eventName, changedPath) => {
    if (!['add', 'change', 'unlink'].includes(eventName)) {
      return;
    }

    const extension = path.extname(changedPath);
    if (!['.ts', '.tsx', '.js', '.jsx'].includes(extension)) {
      return;
    }

    const versionId = extractVersionIdFromSourcePath(changedPath, gamesRootPath);
    if (!versionId) {
      return;
    }

    scheduleBuild(versionId);
  });

  async function shutdown(exitCode: number): Promise<void> {
    for (const timer of pendingBuildTimers.values()) {
      clearTimeout(timer);
    }
    pendingBuildTimers.clear();

    await sourceWatcher.close();

    if (!backendProcess.killed) {
      backendProcess.kill('SIGTERM');
    }

    process.exit(exitCode);
  }

  process.on('SIGINT', () => {
    void shutdown(0);
  });

  process.on('SIGTERM', () => {
    void shutdown(0);
  });

  backendProcess.on('exit', (exitCode) => {
    if (exitCode === 0 || exitCode === null) {
      void shutdown(0);
      return;
    }

    void shutdown(exitCode);
  });
}

main().catch((error: unknown) => {
  console.error('Failed to start dev workflow', error);
  process.exit(1);
});
