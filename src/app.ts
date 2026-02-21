import express from "express";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  clearAdminSessionCookie,
  isAdminAuthenticated,
  LoginAttemptLimiter,
  readAdminAuthConfigFromEnv,
  requireAdminOr404,
  setAdminSessionCookie,
  verifyAdminPassword,
} from "./services/adminAuth";
import { readCodexTranscriptBySessionId } from "./services/codexSessions";
import {
  ensureCsrfToken,
  isCsrfRequestValid,
  issueCsrfToken,
  requireValidCsrfMiddleware,
} from "./services/csrf";
import { reloadTokenPath } from "./services/devLiveReload";
import { getCodexTurnInfo } from "./services/codexTurnInfo";
import { pathExists } from "./services/fsUtils";
import { buildAllGames } from "./services/gameBuildPipeline";
import { requireRuntimeGameAssetPathMiddleware } from "./services/gameAssetAllowlist";
import { createForkedGameVersion } from "./services/forkGameVersion";
import { generateIdeaPrompt } from "./services/ideaGeneration";
import { readIdeasFile, writeIdeasFile } from "./services/ideas";
import {
  composeCodexPrompt,
  readBuildPromptFile,
  SpawnCodegenRunner,
  type CodexRunOptions,
  type CodexRunner,
} from "./services/promptExecution";
import {
  isCodegenProvider,
  RuntimeCodegenConfigStore,
  type CodegenConfig,
} from "./services/codegenConfig";
import {
  gameDirectoryPath,
  hasGameDirectory,
  isSafeVersionId,
  listGameVersions,
  readMetadataFile,
  resolveCodexSessionStatus,
  writeMetadataFile,
} from "./services/gameVersions";
import {
  renderAuthView,
  renderCodexView,
  renderGameView,
  renderHomepage,
  renderIdeasView,
} from "./views";
import {
  DEFAULT_TRANSCRIPTION_MODEL,
  OpenAiRealtimeTranscriptionSessionFactory,
  type OpenAiRealtimeTranscriptionSessionCreator,
} from "./services/openaiTranscription";
import type { CodexSessionStatus } from "./types";

type ErrorLogger = (message: string, error: unknown) => void;

type AppOptions = {
  repoRootPath?: string;
  gamesRootPath?: string;
  buildPromptPath?: string;
  ideationPromptPath?: string;
  ideasPath?: string;
  codexSessionsRootPath?: string;
  claudeSessionsRootPath?: string;
  codexRunner?: CodexRunner;
  codegenConfigStore?: RuntimeCodegenConfigStore;
  logError?: ErrorLogger;
  shouldBuildGamesOnStartup?: boolean;
  enableGameLiveReload?: boolean;
  openAiRealtimeTranscriptionSessionCreator?: OpenAiRealtimeTranscriptionSessionCreator;
};

const TRANSCRIPTION_MODEL_UNAVAILABLE_PATTERN =
  /model_not_found|does not have access to model/i;
const IDEAS_STARTER_VERSION_ID = "starter";

function defaultLogger(message: string, error: unknown): void {
  console.error(message, error);
}

function requestRateLimitKey(request: express.Request): string {
  if (typeof request.ip === "string" && request.ip.length > 0) {
    return request.ip;
  }

  return "unknown";
}

function renderAuthPage(
  request: express.Request,
  response: express.Response,
  isAdmin: boolean,
  statusCode: number,
  codegenConfig: CodegenConfig,
  errorMessage: string | null = null,
): void {
  const csrfToken = ensureCsrfToken(request, response);
  response.status(statusCode).type("html").send(
    renderAuthView({
      isAdmin,
      csrfToken,
      codegenProvider: codegenConfig.provider,
      claudeModel: codegenConfig.claudeModel,
      claudeThinking: codegenConfig.claudeThinking,
      errorMessage,
    }),
  );
}

type PromptSubmitResult = {
  forkId: string;
};

async function submitPromptForVersion(options: {
  gamesRootPath: string;
  buildPromptPath: string;
  versionId: string;
  promptInput: string;
  codexRunner: CodexRunner;
  logError: ErrorLogger;
}): Promise<PromptSubmitResult> {
  const { gamesRootPath, buildPromptPath, versionId, promptInput, codexRunner, logError } = options;

  const forkedMetadata = await createForkedGameVersion({
    gamesRootPath,
    sourceVersionId: versionId,
    sourcePrompt: promptInput,
  });

  const buildPrompt = await readBuildPromptFile(buildPromptPath);
  const fullPrompt = composeCodexPrompt(buildPrompt, promptInput);
  const forkDirectoryPath = path.join(gamesRootPath, forkedMetadata.id);
  const forkMetadataPath = path.join(forkDirectoryPath, "metadata.json");
  let lastPersistedSessionId: string | null = null;
  let lastPersistedSessionStatus = resolveCodexSessionStatus(
    forkedMetadata.codexSessionId ?? null,
    forkedMetadata.codexSessionStatus,
  );

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
      codexSessionId: sessionId,
      codexSessionStatus: resolveCodexSessionStatus(sessionId, currentMetadata.codexSessionStatus),
    });

    lastPersistedSessionId = sessionId;
  }

  async function persistSessionStatus(codexSessionStatus: CodexSessionStatus): Promise<void> {
    if (codexSessionStatus === lastPersistedSessionStatus) {
      return;
    }

    const currentMetadata = await readMetadataFile(forkMetadataPath);
    if (!currentMetadata) {
      throw new Error(`Fork metadata missing while storing session status for ${forkedMetadata.id}`);
    }

    await writeMetadataFile(forkMetadataPath, {
      ...currentMetadata,
      codexSessionStatus,
    });

    lastPersistedSessionStatus = codexSessionStatus;
  }

  function persistSessionIdInBackground(sessionId: string): void {
    void persistSessionId(sessionId).catch((error: unknown) => {
      logError(`Failed to store codex session id for ${forkedMetadata.id}`, error);
    });
  }

  const runOptions: CodexRunOptions = {
    onSessionId: (sessionId: string) => {
      persistSessionIdInBackground(sessionId);
    },
  };

  await persistSessionStatus("created");

  void codexRunner
    .run(fullPrompt, forkDirectoryPath, runOptions)
    .then(async (runResult) => {
      try {
        await persistSessionId(runResult.sessionId);
      } catch (error: unknown) {
        logError(`Failed to store codex session id for ${forkedMetadata.id}`, error);
      }

      if (!runResult.success) {
        try {
          await persistSessionStatus("error");
        } catch (error: unknown) {
          logError(`Failed to store codex session status for ${forkedMetadata.id}`, error);
        }

        if (runResult.failureMessage) {
          logError(`codex exec failed for ${forkedMetadata.id}`, new Error(runResult.failureMessage));
        }
        return;
      }

      try {
        await persistSessionStatus("stopped");
      } catch (error: unknown) {
        logError(`Failed to store codex session status for ${forkedMetadata.id}`, error);
      }
    })
    .catch((error) => {
      void persistSessionStatus("error").catch((statusError: unknown) => {
        logError(`Failed to store codex session status for ${forkedMetadata.id}`, statusError);
      });
      logError(`codex exec failed for ${forkedMetadata.id}`, error);
    });

  return {
    forkId: forkedMetadata.id,
  };
}

export function createApp(options: AppOptions = {}): express.Express {
  const repoRootPath = options.repoRootPath ?? process.cwd();
  const gamesRootPath =
    options.gamesRootPath ?? path.join(repoRootPath, "games");
  const buildPromptPath =
    options.buildPromptPath ?? path.join(repoRootPath, "game-build-prompt.md");
  const codexSessionsRootPath =
    options.codexSessionsRootPath ??
    path.join(os.homedir(), ".codex", "sessions");
  const claudeSessionsRootPath =
    options.claudeSessionsRootPath ??
    path.join(os.homedir(), ".claude", "projects");
  const ideationPromptPath =
    options.ideationPromptPath ?? path.join(repoRootPath, "ideation.md");
  const ideasPath = options.ideasPath ?? path.join(repoRootPath, "ideas.json");
  const codegenConfigStore =
    options.codegenConfigStore ?? new RuntimeCodegenConfigStore();
  const codexRunner =
    options.codexRunner ??
    new SpawnCodegenRunner(() => codegenConfigStore.read());
  const logError = options.logError ?? defaultLogger;
  const shouldBuildGamesOnStartup = options.shouldBuildGamesOnStartup ?? false;
  const enableGameLiveReload =
    options.enableGameLiveReload ??
    process.env.GAME_SPACE_DEV_LIVE_RELOAD === "1";
  const openAiRealtimeTranscriptionSessionCreator =
    options.openAiRealtimeTranscriptionSessionCreator ??
    (process.env.OPENAI_API_KEY
      ? new OpenAiRealtimeTranscriptionSessionFactory()
      : null);

  const authConfig = readAdminAuthConfigFromEnv();
  const requireAdmin = requireAdminOr404(authConfig);
  const requireValidCsrf = requireValidCsrfMiddleware();
  const loginAttemptLimiter = new LoginAttemptLimiter();
  let activeIdeaGeneration: { requestId: number; abortController: AbortController } | null = null;
  let nextIdeaGenerationRequestId = 1;

  if (shouldBuildGamesOnStartup) {
    void buildAllGames(gamesRootPath).catch((error) => {
      logError("Failed to build games on app startup", error);
    });
  }

  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false }));
  app.use("/public", express.static(path.join(repoRootPath, "src/public")));
  app.use(
    "/games",
    requireRuntimeGameAssetPathMiddleware(),
    express.static(gamesRootPath),
  );

  app.get("/auth", async (request, response, next) => {
    try {
      const isAdmin = await isAdminAuthenticated(request, authConfig);
      renderAuthPage(request, response, isAdmin, 200, codegenConfigStore.read());
    } catch (error: unknown) {
      next(error);
    }
  });

  app.post("/auth/login", async (request, response, next) => {
    try {
      if (!isCsrfRequestValid(request)) {
        renderAuthPage(
          request,
          response,
          false,
          403,
          codegenConfigStore.read(),
          "Invalid CSRF token. Refresh and try again.",
        );
        return;
      }

      const limiterKey = requestRateLimitKey(request);
      const remainingBlockMs =
        loginAttemptLimiter.getBlockRemainingMs(limiterKey);
      if (remainingBlockMs > 0) {
        renderAuthPage(
          request,
          response,
          false,
          429,
          codegenConfigStore.read(),
          "Too many attempts. Wait a moment and try again.",
        );
        return;
      }

      const passwordInput = request.body?.password;
      if (typeof passwordInput !== "string" || passwordInput.length === 0) {
        loginAttemptLimiter.registerFailure(limiterKey);
        renderAuthPage(
          request,
          response,
          false,
          401,
          codegenConfigStore.read(),
          "Invalid password.",
        );
        return;
      }

      const isValidPassword = await verifyAdminPassword(
        passwordInput,
        authConfig.passwordHash,
      );
      if (!isValidPassword) {
        loginAttemptLimiter.registerFailure(limiterKey);
        renderAuthPage(
          request,
          response,
          false,
          401,
          codegenConfigStore.read(),
          "Invalid password.",
        );
        return;
      }

      loginAttemptLimiter.registerSuccess(limiterKey);
      await setAdminSessionCookie(response, authConfig.sessionSecret);
      issueCsrfToken(response);
      response.redirect(303, "/auth");
    } catch (error: unknown) {
      next(error);
    }
  });

  app.post("/auth/logout", async (request, response, next) => {
    try {
      const isAdmin = await isAdminAuthenticated(request, authConfig);
      if (!isAdmin) {
        response.status(404).type("text/plain").send("Not found");
        return;
      }

      if (!isCsrfRequestValid(request)) {
        renderAuthPage(
          request,
          response,
          true,
          403,
          codegenConfigStore.read(),
          "Invalid CSRF token. Refresh and try again.",
        );
        return;
      }

      clearAdminSessionCookie(response);
      issueCsrfToken(response);
      response.redirect(303, "/auth");
    } catch (error: unknown) {
      next(error);
    }
  });

  app.post("/auth/provider", async (request, response, next) => {
    try {
      const isAdmin = await isAdminAuthenticated(request, authConfig);
      if (!isAdmin) {
        response.status(404).type("text/plain").send("Not found");
        return;
      }

      if (!isCsrfRequestValid(request)) {
        renderAuthPage(
          request,
          response,
          true,
          403,
          codegenConfigStore.read(),
          "Invalid CSRF token. Refresh and try again.",
        );
        return;
      }

      const providerInput = request.body?.provider;
      if (!isCodegenProvider(providerInput)) {
        renderAuthPage(
          request,
          response,
          true,
          400,
          codegenConfigStore.read(),
          "Invalid codegen provider.",
        );
        return;
      }

      codegenConfigStore.setProvider(providerInput);
      response.redirect(303, "/auth");
    } catch (error: unknown) {
      next(error);
    }
  });

  app.get("/", async (request, response, next) => {
    try {
      const versions = await listGameVersions(gamesRootPath);
      const isAdmin = await isAdminAuthenticated(request, authConfig);
      const visibleVersions = isAdmin
        ? versions
        : versions.filter((version) => version.favorite === true);
      response.status(200).type("html").send(
        renderHomepage(visibleVersions, {
          isAdmin,
        }),
      );
    } catch (error: unknown) {
      next(error);
    }
  });

  app.get("/codex", requireAdmin, async (_request, response, next) => {
    try {
      const versions = await listGameVersions(gamesRootPath);
      response
        .status(200)
        .type("html")
        .send(renderCodexView(versions, codegenConfigStore.read().provider));
    } catch (error: unknown) {
      next(error);
    }
  });

  app.get("/ideas", requireAdmin, async (request, response, next) => {
    try {
      const ideas = await readIdeasFile(ideasPath);
      const csrfToken = ensureCsrfToken(request, response);
      const isIdeaGenerationActive = activeIdeaGeneration !== null;
      response
        .status(200)
        .type("html")
        .send(renderIdeasView(ideas, csrfToken, isIdeaGenerationActive));
    } catch (error: unknown) {
      next(error);
    }
  });

  app.get("/api/ideas", requireAdmin, async (_request, response, next) => {
    try {
      const ideas = await readIdeasFile(ideasPath);
      response.status(200).json({ ideas, isGenerating: activeIdeaGeneration !== null });
    } catch (error: unknown) {
      next(error);
    }
  });

  app.post(
    "/api/ideas/generate",
    requireAdmin,
    requireValidCsrf,
    async (_request, response, next) => {
      const requestId = nextIdeaGenerationRequestId;
      nextIdeaGenerationRequestId += 1;

      if (activeIdeaGeneration) {
        activeIdeaGeneration.abortController.abort();
      }

      const abortController = new AbortController();
      activeIdeaGeneration = {
        requestId,
        abortController,
      };

      try {
        const prompt = await generateIdeaPrompt(
          buildPromptPath,
          ideationPromptPath,
          repoRootPath,
          abortController.signal,
        );

        const ideas = await readIdeasFile(ideasPath);
        const nextIdeas = [{ prompt, hasBeenBuilt: false }, ...ideas];
        await writeIdeasFile(ideasPath, nextIdeas);

        response.status(201).json({ prompt, ideas: nextIdeas });
      } catch (error: unknown) {
        if (error instanceof Error && error.message === "codex ideation command aborted") {
          response.status(409).json({ error: "Idea generation replaced by newer request" });
          return;
        }

        next(error);
      } finally {
        if (activeIdeaGeneration?.requestId === requestId) {
          activeIdeaGeneration = null;
        }
      }
    },
  );

  app.post(
    "/api/ideas/:ideaIndex/build",
    requireAdmin,
    requireValidCsrf,
    async (request, response, next) => {
      try {
        const ideaIndex = Number.parseInt(request.params.ideaIndex ?? "", 10);
        if (!Number.isInteger(ideaIndex) || ideaIndex < 0) {
          response.status(400).json({ error: "Invalid idea index" });
          return;
        }

        const versionId = IDEAS_STARTER_VERSION_ID;
        if (!(await hasGameDirectory(gamesRootPath, versionId))) {
          response.status(503).json({ error: "Starter game is not available" });
          return;
        }

        const ideas = await readIdeasFile(ideasPath);
        if (ideaIndex >= ideas.length) {
          response.status(404).json({ error: "Idea not found" });
          return;
        }

        const idea = ideas[ideaIndex];
        if (!idea) {
          response.status(404).json({ error: "Idea not found" });
          return;
        }

        const submitResult = await submitPromptForVersion({
          gamesRootPath,
          buildPromptPath,
          versionId,
          promptInput: idea.prompt,
          codexRunner,
          logError,
        });

        const nextIdeas = ideas.map((entry, index) =>
          index === ideaIndex
            ? {
                ...entry,
                hasBeenBuilt: true,
              }
            : entry,
        );
        await writeIdeasFile(ideasPath, nextIdeas);

        response.status(202).json({ forkId: submitResult.forkId, ideas: nextIdeas });
      } catch (error: unknown) {
        next(error);
      }
    },
  );

  app.delete(
    "/api/ideas/:ideaIndex",
    requireAdmin,
    requireValidCsrf,
    async (request, response, next) => {
      try {
        const ideaIndex = Number.parseInt(request.params.ideaIndex ?? "", 10);
        if (!Number.isInteger(ideaIndex) || ideaIndex < 0) {
          response.status(400).json({ error: "Invalid idea index" });
          return;
        }

        const ideas = await readIdeasFile(ideasPath);
        if (ideaIndex >= ideas.length) {
          response.status(404).json({ error: "Idea not found" });
          return;
        }

        const nextIdeas = ideas.filter((_entry, index) => index !== ideaIndex);
        await writeIdeasFile(ideasPath, nextIdeas);

        response.status(200).json({ ideas: nextIdeas });
      } catch (error: unknown) {
        next(error);
      }
    },
  );

  app.get("/game/:versionId", async (request, response, next) => {
    try {
      const { versionId } = request.params;
      if (!isSafeVersionId(versionId)) {
        response.status(400).json({ error: "Invalid version id" });
        return;
      }

      if (!(await hasGameDirectory(gamesRootPath, versionId))) {
        response.status(404).json({ error: "Game version not found" });
        return;
      }

      const gameBundlePath = path.join(
        gamesRootPath,
        versionId,
        "dist",
        "game.js",
      );
      if (!(await pathExists(gameBundlePath))) {
        response.status(503).json({ error: "Game version is not built yet" });
        return;
      }

      const metadataPath = path.join(
        gameDirectoryPath(gamesRootPath, versionId),
        "metadata.json",
      );
      const metadata = await readMetadataFile(metadataPath);
      const isAdmin = await isAdminAuthenticated(request, authConfig);
      const csrfToken = isAdmin
        ? ensureCsrfToken(request, response)
        : undefined;
      response
        .status(200)
        .type("html")
        .send(
          renderGameView(versionId, {
            enableLiveReload: enableGameLiveReload,
            isAdmin,
            csrfToken,
            isFavorite: metadata?.favorite === true,
            tileColor: metadata?.tileColor,
            codegenProvider: codegenConfigStore.read().provider,
          }),
        );
    } catch (error: unknown) {
      next(error);
    }
  });

  if (enableGameLiveReload) {
    app.get(
      "/api/dev/reload-token/:versionId",
      async (request, response, next) => {
        try {
          const versionId = request.params.versionId;
          if (typeof versionId !== "string" || !isSafeVersionId(versionId)) {
            response.status(400).json({ error: "Invalid version id" });
            return;
          }

          if (!(await hasGameDirectory(gamesRootPath, versionId))) {
            response.status(404).json({ error: "Game version not found" });
            return;
          }

          const tokenPath = reloadTokenPath(gamesRootPath, versionId);
          if (!(await pathExists(tokenPath))) {
            response.status(404).json({ error: "Reload token not found" });
            return;
          }

          const token = (await fs.readFile(tokenPath, "utf8")).trim();
          if (token.length === 0) {
            response.status(404).json({ error: "Reload token not found" });
            return;
          }

          response.status(200).type("text/plain").send(token);
        } catch (error: unknown) {
          next(error);
        }
      },
    );
  }

  app.get(
    "/api/codex-sessions/:versionId",
    requireAdmin,
    async (request, response, next) => {
      try {
        const versionId = request.params.versionId;
        if (typeof versionId !== "string" || !isSafeVersionId(versionId)) {
          response.status(400).json({ error: "Invalid version id" });
          return;
        }

        if (!(await hasGameDirectory(gamesRootPath, versionId))) {
          response.status(404).json({ error: "Game version not found" });
          return;
        }

        const metadataPath = path.join(
          gameDirectoryPath(gamesRootPath, versionId),
          "metadata.json",
        );
        const metadata = await readMetadataFile(metadataPath);
        if (!metadata) {
          response.status(404).json({ error: "Game metadata not found" });
          return;
        }

        const codexSessionStatus = resolveCodexSessionStatus(
          metadata.codexSessionId ?? null,
          metadata.codexSessionStatus,
        );
        const sessionRootPaths = [
          codexSessionsRootPath,
          claudeSessionsRootPath,
        ];
        const turnInfo = await getCodexTurnInfo({
          repoRootPath,
          worktreePath: gameDirectoryPath(gamesRootPath, versionId),
          sessionsRootPath: sessionRootPaths,
          codexSessionStatus,
        });
        const codexSessionId = metadata.codexSessionId ?? null;
        if (!codexSessionId) {
          response.status(200).json({
            status: "no-session",
            versionId,
            codexSessionStatus,
            eyeState: turnInfo.eyeState,
          });
          return;
        }

        const messages = await readCodexTranscriptBySessionId(
          sessionRootPaths,
          codexSessionId,
        );
        if (!messages) {
          response.status(200).json({
            status: "session-file-missing",
            versionId,
            sessionId: codexSessionId,
            codexSessionStatus,
            eyeState: turnInfo.eyeState,
          });
          return;
        }

        response.status(200).json({
          status: "ok",
          versionId,
          sessionId: codexSessionId,
          messages,
          codexSessionStatus,
          eyeState: turnInfo.eyeState,
          latestAssistantMessage: turnInfo.latestAssistantMessage,
        });
      } catch (error: unknown) {
        next(error);
      }
    },
  );

  app.post(
    "/api/transcribe",
    requireAdmin,
    requireValidCsrf,
    async (_request, response, next) => {
      try {
        if (!openAiRealtimeTranscriptionSessionCreator) {
          response
            .status(503)
            .json({ error: "OpenAI realtime transcription is not configured" });
          return;
        }

        try {
          const session =
            await openAiRealtimeTranscriptionSessionCreator.createSession();
          response.status(200).json({
            clientSecret: session.clientSecret,
            expiresAt: session.expiresAt,
            model: session.model,
          });
          return;
        } catch (error: unknown) {
          logError(
            "OpenAI realtime transcription session request failed",
            error,
          );
          if (
            error instanceof Error &&
            TRANSCRIPTION_MODEL_UNAVAILABLE_PATTERN.test(error.message)
          ) {
            response.status(503).json({
              error: `OpenAI transcription model ${DEFAULT_TRANSCRIPTION_MODEL} is unavailable for this API key`,
            });
            return;
          }

          response
            .status(502)
            .json({
              error: "OpenAI realtime transcription session request failed",
            });
          return;
        }
      } catch (error: unknown) {
        next(error);
      }
    },
  );

  app.post(
    "/api/games/:versionId/favorite",
    requireAdmin,
    requireValidCsrf,
    async (request, response, next) => {
      try {
        const versionId = request.params.versionId;
        if (typeof versionId !== "string" || !isSafeVersionId(versionId)) {
          response.status(400).json({ error: "Invalid version id" });
          return;
        }

        if (!(await hasGameDirectory(gamesRootPath, versionId))) {
          response.status(404).json({ error: "Game version not found" });
          return;
        }

        const metadataPath = path.join(
          gameDirectoryPath(gamesRootPath, versionId),
          "metadata.json",
        );
        const metadata = await readMetadataFile(metadataPath);
        if (!metadata) {
          response.status(404).json({ error: "Game metadata not found" });
          return;
        }

        const favorite = metadata.favorite !== true;
        await writeMetadataFile(metadataPath, {
          ...metadata,
          favorite,
        });

        response.status(200).json({
          status: "ok",
          versionId,
          favorite,
        });
      } catch (error: unknown) {
        next(error);
      }
    },
  );

  app.delete(
    "/api/games/:versionId",
    requireAdmin,
    requireValidCsrf,
    async (request, response, next) => {
      try {
        const versionId = request.params.versionId;
        if (typeof versionId !== "string" || !isSafeVersionId(versionId)) {
          response.status(400).json({ error: "Invalid version id" });
          return;
        }

        const directoryPath = gameDirectoryPath(gamesRootPath, versionId);
        if (!(await hasGameDirectory(gamesRootPath, versionId))) {
          response.status(404).json({ error: "Game version not found" });
          return;
        }

        await fs.rm(directoryPath, { recursive: true, force: false });
        response.status(200).json({ status: "ok", versionId });
      } catch (error: unknown) {
        next(error);
      }
    },
  );

  app.post(
    "/api/games/:versionId/prompts",
    requireAdmin,
    requireValidCsrf,
    async (request, response, next) => {
      try {
        const versionId = request.params.versionId;
        if (typeof versionId !== "string" || !isSafeVersionId(versionId)) {
          response.status(400).json({ error: "Invalid version id" });
          return;
        }

        if (!(await hasGameDirectory(gamesRootPath, versionId))) {
          response.status(404).json({ error: "Game version not found" });
          return;
        }

        const promptInput = request.body?.prompt;
        if (
          typeof promptInput !== "string" ||
          promptInput.trim().length === 0
        ) {
          response
            .status(400)
            .json({ error: "Prompt must be a non-empty string" });
          return;
        }

        const submitResult = await submitPromptForVersion({
          gamesRootPath,
          buildPromptPath,
          versionId,
          promptInput,
          codexRunner,
          logError,
        });

        response.status(202).json({ forkId: submitResult.forkId });
      } catch (error: unknown) {
        next(error);
      }
    },
  );

  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      next: express.NextFunction,
    ) => {
      void next;
      logError("Unhandled error", error);
      response.status(500).json({ error: "Internal server error" });
    },
  );

  return app;
}
