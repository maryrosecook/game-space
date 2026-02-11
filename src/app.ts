import express from 'express';
import os from 'node:os';
import path from 'node:path';

import { readCodexTranscriptBySessionId } from './services/codexSessions';
import { pathExists } from './services/fsUtils';
import { buildAllGames } from './services/gameBuildPipeline';
import { createForkedGameVersion } from './services/forkGameVersion';
import {
  composeCodexPrompt,
  readBuildPromptFile,
  SpawnCodexRunner,
  type CodexRunOptions,
  type CodexRunner
} from './services/promptExecution';
import {
  gameDirectoryPath,
  hasGameDirectory,
  isSafeVersionId,
  listGameVersions,
  readMetadataFile,
  writeMetadataFile
} from './services/gameVersions';
import { renderCodexView, renderGameView, renderHomepage } from './views';

type ErrorLogger = (message: string, error: unknown) => void;

type AppOptions = {
  repoRootPath?: string;
  gamesRootPath?: string;
  buildPromptPath?: string;
  codexSessionsRootPath?: string;
  codexRunner?: CodexRunner;
  logError?: ErrorLogger;
  shouldBuildGamesOnStartup?: boolean;
  enableGameLiveReload?: boolean;
};

function defaultLogger(message: string, error: unknown): void {
  console.error(message, error);
}

export function createApp(options: AppOptions = {}): express.Express {
  const repoRootPath = options.repoRootPath ?? process.cwd();
  const gamesRootPath = options.gamesRootPath ?? path.join(repoRootPath, 'games');
  const buildPromptPath = options.buildPromptPath ?? path.join(repoRootPath, 'game-build-prompt.md');
  const codexSessionsRootPath = options.codexSessionsRootPath ?? path.join(os.homedir(), '.codex', 'sessions');
  const codexRunner = options.codexRunner ?? new SpawnCodexRunner();
  const logError = options.logError ?? defaultLogger;
  const shouldBuildGamesOnStartup = options.shouldBuildGamesOnStartup ?? false;
  const enableGameLiveReload =
    options.enableGameLiveReload ?? process.env.GAME_SPACE_DEV_LIVE_RELOAD === '1';

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

  app.get('/codex', async (_request, response, next) => {
    try {
      const versions = await listGameVersions(gamesRootPath);
      response.status(200).type('html').send(renderCodexView(versions));
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

      response
        .status(200)
        .type('html')
        .send(renderGameView(versionId, { enableLiveReload: enableGameLiveReload }));
    } catch (error: unknown) {
      next(error);
    }
  });

  app.get('/api/codex-sessions/:versionId', async (request, response, next) => {
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

      const metadataPath = path.join(gameDirectoryPath(gamesRootPath, versionId), 'metadata.json');
      const metadata = await readMetadataFile(metadataPath);
      if (!metadata) {
        response.status(404).json({ error: 'Game metadata not found' });
        return;
      }

      const codexSessionId = metadata.codexSessionId ?? null;
      if (!codexSessionId) {
        response.status(200).json({
          status: 'no-session',
          versionId
        });
        return;
      }

      const messages = await readCodexTranscriptBySessionId(codexSessionsRootPath, codexSessionId);
      if (!messages) {
        response.status(200).json({
          status: 'session-file-missing',
          versionId,
          sessionId: codexSessionId
        });
        return;
      }

      response.status(200).json({
        status: 'ok',
        versionId,
        sessionId: codexSessionId,
        messages
      });
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
      const forkMetadataPath = path.join(forkDirectoryPath, 'metadata.json');
      let lastPersistedSessionId: string | null = null;

      async function persistSessionId(sessionId: string | null): Promise<void> {
        if (!sessionId || sessionId === lastPersistedSessionId) {
          return;
        }

        const currentMetadata = await readMetadataFile(forkMetadataPath);
        if (!currentMetadata) {
          throw new Error(`Fork metadata missing while storing session id for ${forkedMetadata.id}`);
        }

        await writeMetadataFile(forkMetadataPath, {
          ...currentMetadata,
          codexSessionId: sessionId
        });

        lastPersistedSessionId = sessionId;
      }

      function persistSessionIdInBackground(sessionId: string): void {
        void persistSessionId(sessionId).catch((error: unknown) => {
          logError(`Failed to store codex session id for ${forkedMetadata.id}`, error);
        });
      }

      const runOptions: CodexRunOptions = {
        onSessionId: (sessionId: string) => {
          persistSessionIdInBackground(sessionId);
        }
      };

      void codexRunner
        .run(fullPrompt, forkDirectoryPath, runOptions)
        .then(async (runResult) => {
          try {
            await persistSessionId(runResult.sessionId);
          } catch (error: unknown) {
            logError(`Failed to store codex session id for ${forkedMetadata.id}`, error);
          }

          if (!runResult.success && runResult.failureMessage) {
            logError(`codex exec failed for ${forkedMetadata.id}`, new Error(runResult.failureMessage));
          }
        })
        .catch((error) => {
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
