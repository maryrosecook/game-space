import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { CodexSessionStatus } from '../types';
import { isCodegenProvider, type CodegenProvider } from './codegenConfig';
import { createForkedGameVersion } from './forkGameVersion';
import { readMetadataFile, resolveCodexSessionStatus, writeMetadataFile } from './gameVersions';
import {
  composeCodexPrompt,
  readBuildPromptFile,
  type CodexRunOptions,
  type CodexRunner,
} from './promptExecution';

export type ErrorLogger = (message: string, error: unknown) => void;

const ANNOTATION_PNG_DATA_URL_PREFIX = 'data:image/png;base64,';
const GAME_SCREENSHOT_PNG_DATA_URL_PREFIX = 'data:image/png;base64,';
const ANNOTATION_PNG_BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
const MAX_ANNOTATION_PNG_BYTES = 1024 * 1024;
const MAX_GAME_SCREENSHOT_PNG_BYTES = 3 * 1024 * 1024;

const TILE_SNAPSHOT_PROTOCOL = {
  steps: [{ run: 120 }, { snap: 'tile' }],
};

type HeadlessSnapshotResult = {
  captures?: readonly { path?: string }[];
};

export type PromptSubmitResult = {
  forkId: string;
};

function decodePngDataUrl(
  pngDataUrl: string,
  dataUrlPrefix: string,
  maxBytes: number,
): Buffer | null {
  const normalizedValue = pngDataUrl.trim();
  if (!normalizedValue.startsWith(dataUrlPrefix)) {
    return null;
  }

  const encodedPayload = normalizedValue.slice(dataUrlPrefix.length).replace(/\s+/g, '');
  if (
    encodedPayload.length === 0 ||
    encodedPayload.length % 4 !== 0 ||
    !ANNOTATION_PNG_BASE64_PATTERN.test(encodedPayload)
  ) {
    return null;
  }

  const decodedPayload = Buffer.from(encodedPayload, 'base64');
  if (decodedPayload.length === 0 || decodedPayload.length > maxBytes) {
    return null;
  }

  const normalizedEncodedPayload = encodedPayload.replace(/=+$/, '');
  const roundTripEncodedPayload = decodedPayload.toString('base64').replace(/=+$/, '');
  if (normalizedEncodedPayload !== roundTripEncodedPayload) {
    return null;
  }

  return decodedPayload;
}

export function decodeAnnotationPngDataUrl(annotationPngDataUrl: string): Buffer | null {
  return decodePngDataUrl(annotationPngDataUrl, ANNOTATION_PNG_DATA_URL_PREFIX, MAX_ANNOTATION_PNG_BYTES);
}

export function decodeGameScreenshotPngDataUrl(gameScreenshotPngDataUrl: string): Buffer | null {
  return decodePngDataUrl(
    gameScreenshotPngDataUrl,
    GAME_SCREENSHOT_PNG_DATA_URL_PREFIX,
    MAX_GAME_SCREENSHOT_PNG_BYTES,
  );
}

function composePromptWithAttachedVisualContext(
  buildPrompt: string,
  userPrompt: string,
  options: {
    hasAnnotationAttachment: boolean;
    hasGameScreenshotAttachment: boolean;
  },
): string {
  const basePrompt = composeCodexPrompt(buildPrompt, userPrompt, null);
  const instructions: string[] = [];

  if (options.hasGameScreenshotAttachment) {
    instructions.push('Use the attached game screenshot PNG as visual context for this prompt.');
  }

  if (options.hasAnnotationAttachment) {
    instructions.push('Use the attached annotation PNG as visual context for this prompt.');
  }

  if (instructions.length === 0) {
    return basePrompt;
  }

  return `${basePrompt}\n\n[visual_context_png_attached]\n${instructions.join('\n')}`;
}

function parseLastJsonObject(serializedOutput: string): unknown | null {
  const trimmed = serializedOutput.trim();
  const objectStartIndex = trimmed.lastIndexOf('\n{');
  const jsonText = objectStartIndex === -1 ? trimmed : trimmed.slice(objectStartIndex + 1);
  if (!jsonText.startsWith('{')) {
    return null;
  }

  try {
    return JSON.parse(jsonText) as unknown;
  } catch {
    return null;
  }
}

async function runHeadlessSnapshotScript(gameDirectoryPath: string, protocol: unknown): Promise<HeadlessSnapshotResult> {
  const args = ['run', 'headless', '--', '--json', JSON.stringify(protocol)];

  return new Promise<HeadlessSnapshotResult>((resolve, reject) => {
    const child = spawn('npm', args, {
      cwd: gameDirectoryPath,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('error', (error) => {
      reject(error);
    });

    child.on('close', (exitCode) => {
      if (exitCode !== 0) {
        reject(
          new Error(
            `headless snapshot failed with exit code ${exitCode ?? 'unknown'}${
              stderr.trim().length > 0 ? `: ${stderr.trim()}` : ''
            }`,
          ),
        );
        return;
      }

      const parsed = parseLastJsonObject(stdout);
      if (parsed === null) {
        reject(new Error('headless snapshot output did not contain JSON result'));
        return;
      }

      resolve(parsed as HeadlessSnapshotResult);
    });
  });
}

export async function captureTileSnapshotForGame(gameDirectoryPath: string): Promise<void> {
  const runResult = await runHeadlessSnapshotScript(gameDirectoryPath, TILE_SNAPSHOT_PROTOCOL);
  const capture = Array.isArray(runResult.captures) ? runResult.captures[0] : null;
  if (!capture || typeof capture.path !== 'string' || capture.path.length === 0) {
    throw new Error('Headless snapshot run did not produce a capture');
  }

  const snapshotsDirectoryPath = path.join(gameDirectoryPath, 'snapshots');
  const targetPath = path.join(snapshotsDirectoryPath, 'tile.png');
  await fs.mkdir(snapshotsDirectoryPath, { recursive: true });
  await fs.copyFile(capture.path, targetPath);
}

export async function submitPromptForVersion(options: {
  gamesRootPath: string;
  buildPromptPath: string;
  codegenProvider: CodegenProvider;
  versionId: string;
  promptInput: string;
  annotationPngDataUrl?: string | null;
  annotationPngBytes?: Buffer | null;
  gameScreenshotPngDataUrl?: string | null;
  gameScreenshotPngBytes?: Buffer | null;
  codexRunner: CodexRunner;
  captureTileSnapshot: (gameDirectoryPath: string) => Promise<void>;
  logError: ErrorLogger;
}): Promise<PromptSubmitResult> {
  const {
    gamesRootPath,
    buildPromptPath,
    codegenProvider,
    versionId,
    promptInput,
    annotationPngDataUrl,
    annotationPngBytes,
    gameScreenshotPngDataUrl,
    gameScreenshotPngBytes,
    codexRunner,
    captureTileSnapshot,
    logError,
  } = options;

  if (!isCodegenProvider(codegenProvider)) {
    throw new Error('Invalid codegen provider');
  }

  const forkedMetadata = await createForkedGameVersion({
    gamesRootPath,
    sourceVersionId: versionId,
    sourcePrompt: promptInput,
  });

  const buildPrompt = await readBuildPromptFile(buildPromptPath);
  const forkDirectoryPath = path.join(gamesRootPath, forkedMetadata.id);
  const shouldAttachAnnotationImage =
    annotationPngBytes instanceof Buffer && (codegenProvider === 'codex' || codegenProvider === 'claude');
  const shouldAttachGameScreenshotImage =
    gameScreenshotPngBytes instanceof Buffer && (codegenProvider === 'codex' || codegenProvider === 'claude');
  const promptForRunner =
    shouldAttachAnnotationImage || shouldAttachGameScreenshotImage
      ? composePromptWithAttachedVisualContext(buildPrompt, promptInput, {
          hasAnnotationAttachment: shouldAttachAnnotationImage,
          hasGameScreenshotAttachment: shouldAttachGameScreenshotImage,
        })
      : composeCodexPrompt(buildPrompt, promptInput, annotationPngDataUrl ?? gameScreenshotPngDataUrl ?? null);

  const imagePaths: string[] = [];
  if (shouldAttachGameScreenshotImage && gameScreenshotPngBytes) {
    const gameScreenshotImagePath = path.join(forkDirectoryPath, `.game-screenshot-${randomUUID()}.png`);
    await fs.writeFile(gameScreenshotImagePath, gameScreenshotPngBytes);
    imagePaths.push(gameScreenshotImagePath);
  }

  if (shouldAttachAnnotationImage && annotationPngBytes) {
    const annotationImagePath = path.join(forkDirectoryPath, `.annotation-overlay-${randomUUID()}.png`);
    await fs.writeFile(annotationImagePath, annotationPngBytes);
    imagePaths.push(annotationImagePath);
  }

  const forkMetadataPath = path.join(forkDirectoryPath, 'metadata.json');
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

  async function persistTileSnapshotPath(tileSnapshotPath: string): Promise<void> {
    const currentMetadata = await readMetadataFile(forkMetadataPath);
    if (!currentMetadata) {
      throw new Error(`Fork metadata missing while storing tile snapshot path for ${forkedMetadata.id}`);
    }

    if (currentMetadata.tileSnapshotPath === tileSnapshotPath) {
      return;
    }

    await writeMetadataFile(forkMetadataPath, {
      ...currentMetadata,
      tileSnapshotPath,
    });
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
    imagePaths: imagePaths.length > 0 ? imagePaths : undefined,
  };

  await persistSessionStatus('created');

  void codexRunner
    .run(promptForRunner, forkDirectoryPath, runOptions)
    .then(async (runResult) => {
      try {
        await persistSessionId(runResult.sessionId);
      } catch (error: unknown) {
        logError(`Failed to store codex session id for ${forkedMetadata.id}`, error);
      }

      if (!runResult.success) {
        try {
          await persistSessionStatus('error');
        } catch (error: unknown) {
          logError(`Failed to store codex session status for ${forkedMetadata.id}`, error);
        }

        if (runResult.failureMessage) {
          logError(`codex exec failed for ${forkedMetadata.id}`, new Error(runResult.failureMessage));
        }
        return;
      }

      try {
        await persistSessionStatus('stopped');
      } catch (error: unknown) {
        logError(`Failed to store codex session status for ${forkedMetadata.id}`, error);
      }

      if (runResult.completionDetected !== false) {
        void captureTileSnapshot(forkDirectoryPath)
          .then(async () => {
            await persistTileSnapshotPath(`/games/${encodeURIComponent(forkedMetadata.id)}/snapshots/tile.png`);
          })
          .catch((error: unknown) => {
            logError(`Failed to capture tile snapshot for ${forkedMetadata.id}`, error);
          });
      }
    })
    .catch((error) => {
      void persistSessionStatus('error').catch((statusError: unknown) => {
        logError(`Failed to store codex session status for ${forkedMetadata.id}`, statusError);
      });
      logError(`codex exec failed for ${forkedMetadata.id}`, error);
    })
    .finally(() => {
      if (imagePaths.length === 0) {
        return;
      }

      for (const imagePath of imagePaths) {
        void fs.rm(imagePath, { force: true }).catch((error: unknown) => {
          logError(`Failed to clean visual context image for ${forkedMetadata.id}`, error);
        });
      }
    });

  return {
    forkId: forkedMetadata.id,
  };
}
