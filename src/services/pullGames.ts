import path from 'node:path';

import { runCommand, type CommandRunner } from './gameBuildPipeline';

const DEFAULT_SSH_HOST_ALIAS = 'do2';
const DEFAULT_REMOTE_GAMES_PATH = '~/node-sites/game-space/games';

export type PullGamesConfig = {
  sshHostAlias?: string;
  remoteGamesPath?: string;
  localGamesPath?: string;
};

function getRequiredTrimmedValue(value: string, label: string): string {
  const trimmedValue = value.trim();
  if (trimmedValue.length === 0) {
    throw new Error(`${label} must not be empty`);
  }

  return trimmedValue;
}

function ensureTrailingForwardSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function normalizeRemoteGamesPath(remoteGamesPath: string): string {
  return ensureTrailingForwardSlash(remoteGamesPath.replace(/\/+$/u, ''));
}

function normalizeLocalGamesPath(localGamesPath: string): string {
  return ensureTrailingForwardSlash(path.resolve(localGamesPath));
}

export function buildPullGamesCommandArgs(
  sshHostAlias: string,
  remoteGamesPath: string,
  localGamesPath: string
): readonly string[] {
  const resolvedSshHostAlias = getRequiredTrimmedValue(sshHostAlias, 'SSH host alias');
  const resolvedRemoteGamesPath = normalizeRemoteGamesPath(
    getRequiredTrimmedValue(remoteGamesPath, 'Remote games path')
  );
  const resolvedLocalGamesPath = normalizeLocalGamesPath(
    getRequiredTrimmedValue(localGamesPath, 'Local games path')
  );

  const sourcePath = `${resolvedSshHostAlias}:${resolvedRemoteGamesPath}`;

  return ['--archive', '--compress', '--verbose', '--rsh', 'ssh', sourcePath, resolvedLocalGamesPath];
}

export async function pullGames(
  config: PullGamesConfig = {},
  run: CommandRunner = runCommand
): Promise<void> {
  const sshHostAlias = config.sshHostAlias ?? DEFAULT_SSH_HOST_ALIAS;
  const remoteGamesPath = config.remoteGamesPath ?? DEFAULT_REMOTE_GAMES_PATH;
  const localGamesPath = config.localGamesPath ?? path.join(process.cwd(), 'games');
  const args = buildPullGamesCommandArgs(sshHostAlias, remoteGamesPath, localGamesPath);

  await run('rsync', args);
}
