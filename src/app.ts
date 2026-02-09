import express from 'express';
import path from 'node:path';

import { pathExists } from './services/fsUtils';
import { buildAllGames } from './services/gameBuildPipeline';
import { createForkedGameVersion } from './services/forkGameVersion';
import {
  composeCodexPrompt,
  readBuildPromptFile,
  SpawnCodexRunner,
  type CodexRunner
} from './services/promptExecution';
import { hasGameDirectory, isSafeVersionId, listGameVersions } from './services/gameVersions';
import { renderGameView, renderHomepage } from './views';

type ErrorLogger = (message: string, error: unknown) => void;

type AppOptions = {
  repoRootPath?: string;
  gamesRootPath?: string;
  buildPromptPath?: string;
  codexRunner?: CodexRunner;
  logError?: ErrorLogger;
  shouldBuildGamesOnStartup?: boolean;
};

function defaultLogger(message: string, error: unknown): void {
  console.error(message, error);
}

export function createApp(options: AppOptions = {}): express.Express {
  const repoRootPath = options.repoRootPath ?? process.cwd();
  const gamesRootPath = options.gamesRootPath ?? path.join(repoRootPath, 'games');
  const buildPromptPath = options.buildPromptPath ?? path.join(repoRootPath, 'game-build-prompt.md');
  const codexRunner = options.codexRunner ?? new SpawnCodexRunner();
  const logError = options.logError ?? defaultLogger;
  const shouldBuildGamesOnStartup = options.shouldBuildGamesOnStartup ?? false;

  if (shouldBuildGamesOnStartup) {
    void buildAllGames(gamesRootPath).catch((error) => {
      logError('Failed to build games on app startup', error);
    });
  }

  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/public', express.static(path.join(repoRootPath, 'src/public')));
  app.use('/games', express.static(gamesRootPath));

  app.get('/', async (_request, response, next) => {
    try {
      const versions = await listGameVersions(gamesRootPath);
      response.status(200).type('html').send(renderHomepage(versions));
    } catch (error: unknown) {
      next(error);
    }
  });

  app.get('/game/:versionId', async (request, response, next) => {
    try {
      const { versionId } = request.params;
      if (!isSafeVersionId(versionId)) {
        response.status(400).json({ error: 'Invalid version id' });
        return;
      }

      if (!(await hasGameDirectory(gamesRootPath, versionId))) {
        response.status(404).json({ error: 'Game version not found' });
        return;
      }

      const gameBundlePath = path.join(gamesRootPath, versionId, 'dist', 'game.js');
      if (!(await pathExists(gameBundlePath))) {
        response.status(503).json({ error: 'Game version is not built yet' });
        return;
      }

      response.status(200).type('html').send(renderGameView(versionId));
    } catch (error: unknown) {
      next(error);
    }
  });

  app.post('/api/games/:versionId/prompts', async (request, response, next) => {
    try {
      const { versionId } = request.params;
      if (!isSafeVersionId(versionId)) {
        response.status(400).json({ error: 'Invalid version id' });
        return;
      }

      if (!(await hasGameDirectory(gamesRootPath, versionId))) {
        response.status(404).json({ error: 'Game version not found' });
        return;
      }

      const promptInput = request.body?.prompt;
      if (typeof promptInput !== 'string' || promptInput.trim().length === 0) {
        response.status(400).json({ error: 'Prompt must be a non-empty string' });
        return;
      }

      const forkedMetadata = await createForkedGameVersion({
        gamesRootPath,
        sourceVersionId: versionId
      });

      const buildPrompt = await readBuildPromptFile(buildPromptPath);
      const fullPrompt = composeCodexPrompt(buildPrompt, promptInput);
      const forkDirectoryPath = path.join(gamesRootPath, forkedMetadata.id);

      void codexRunner.run(fullPrompt, forkDirectoryPath).catch((error) => {
        logError(`codex exec failed for ${forkedMetadata.id}`, error);
      });

      response.status(202).json({ forkId: forkedMetadata.id });
    } catch (error: unknown) {
      next(error);
    }
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, next: express.NextFunction) => {
    void next;
    logError('Unhandled error', error);
    response.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
