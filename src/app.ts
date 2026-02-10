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

type PromptRunState = 'running' | 'succeeded' | 'failed';

type PromptRunStatus = {
  forkId: string;
  state: PromptRunState;
  startedTime: string;
  completedTime: string | null;
  error: string | null;
};

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

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return String(error);
}

function buildPromptStatusUrl(versionId: string): string {
  return `/api/games/${encodeURIComponent(versionId)}/prompt-status`;
}

export function createApp(options: AppOptions = {}): express.Express {
  const repoRootPath = options.repoRootPath ?? process.cwd();
  const gamesRootPath = options.gamesRootPath ?? path.join(repoRootPath, 'games');
  const buildPromptPath = options.buildPromptPath ?? path.join(repoRootPath, 'game-build-prompt.md');
  const codexRunner = options.codexRunner ?? new SpawnCodexRunner();
  const logError = options.logError ?? defaultLogger;
  const shouldBuildGamesOnStartup = options.shouldBuildGamesOnStartup ?? false;
  const promptRunStatusByForkId = new Map<string, PromptRunStatus>();

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
      const forkId = forkedMetadata.id;
      const forkDirectoryPath = path.join(gamesRootPath, forkId);
      const initialStatus: PromptRunStatus = {
        forkId,
        state: 'running',
        startedTime: new Date().toISOString(),
        completedTime: null,
        error: null
      };
      promptRunStatusByForkId.set(forkId, initialStatus);

      void codexRunner
        .run(fullPrompt, forkDirectoryPath)
        .then(() => {
          const currentStatus = promptRunStatusByForkId.get(forkId);
          if (!currentStatus) {
            return;
          }

          promptRunStatusByForkId.set(forkId, {
            ...currentStatus,
            state: 'succeeded',
            completedTime: new Date().toISOString(),
            error: null
          });
        })
        .catch((error: unknown) => {
          const currentStatus = promptRunStatusByForkId.get(forkId);
          if (currentStatus) {
            promptRunStatusByForkId.set(forkId, {
              ...currentStatus,
              state: 'failed',
              completedTime: new Date().toISOString(),
              error: getErrorMessage(error)
            });
          }

          logError(`codex exec failed for ${forkId}`, error);
        });

      response.status(202).json({
        forkId,
        statusUrl: buildPromptStatusUrl(forkId)
      });
    } catch (error: unknown) {
      next(error);
    }
  });

  app.get('/api/games/:versionId/prompt-status', (request, response) => {
    const { versionId } = request.params;
    if (!isSafeVersionId(versionId)) {
      response.status(400).json({ error: 'Invalid version id' });
      return;
    }

    const status = promptRunStatusByForkId.get(versionId);
    if (!status) {
      response.status(404).json({ error: 'Prompt status not found' });
      return;
    }

    response.status(200).json(status);
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, next: express.NextFunction) => {
    void next;
    logError('Unhandled error', error);
    response.status(500).json({ error: 'Internal server error' });
  });

  return app;
}
