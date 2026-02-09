import path from 'node:path';

import { buildAllGames } from '../src/services/gameBuildPipeline';

async function main(): Promise<void> {
  const gamesRootPath = path.join(process.cwd(), 'games');
  await buildAllGames(gamesRootPath);
}

main().catch((error: unknown) => {
  console.error('Failed to build games', error);
  process.exit(1);
});
