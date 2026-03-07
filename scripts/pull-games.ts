import { pullGames } from '../src/services/pullGames';

async function main(): Promise<void> {
  const sshHostAlias = process.env.GAME_SPACE_PULL_GAMES_SSH_HOST;
  const remoteGamesPath = process.env.GAME_SPACE_PULL_GAMES_REMOTE_PATH;
  const localGamesPath = process.env.GAME_SPACE_PULL_GAMES_LOCAL_PATH;

  await pullGames({
    sshHostAlias,
    remoteGamesPath,
    localGamesPath
  });
}

main().catch((error: unknown) => {
  console.error('Failed to pull games from remote host', error);
  process.exit(1);
});
