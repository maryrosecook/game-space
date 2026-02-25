import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, Page } from '@playwright/test';
import { build } from 'esbuild';

import type { SyntheticInputEvent } from '../engine/input';
import {
  executeStarterHeadlessProtocol,
  StarterHeadlessDriverCapture,
  StarterHeadlessScriptDriver
} from './executor';
import {
  MAX_RUN_SECONDS,
  STARTER_HEADLESS_LIMITS,
  STARTER_HEADLESS_VIEWPORT,
  parseStarterHeadlessProtocol
} from './protocol';

type HarnessWindow = Window & {
  __starterHeadlessHarness?: {
    bootstrap: (canvasId: string) => Promise<void>;
    runFrames: (frameCount: number) => void;
    applyInput: (event: SyntheticInputEvent) => void;
    captureSnapshot: () => StarterHeadlessDriverCapture;
    readFrameCount: () => number;
    destroy: () => void;
  };
};

export type StarterHeadlessCapture = {
  label: string;
  frame: number;
  path: string;
};

export type StarterHeadlessRunResult = {
  ok: boolean;
  frameCount: number;
  captures: readonly StarterHeadlessCapture[];
  diagnostics: readonly string[];
  outputDirectory: string | null;
};

export type RunStarterHeadlessOptions = {
  outputRootDirectory?: string;
  nowMs?: () => number;
  gameVersionId?: string;
};

const SWIFTSHADER_CHROMIUM_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-webgl',
  '--ignore-gpu-blocklist',
  '--enable-unsafe-swiftshader'
];

const HARNESS_WINDOW_GLOBAL = '__starterHeadlessHarness';
const CANVAS_ID = 'game-canvas';

export async function runStarterHeadless(
  protocolInput: unknown,
  options: RunStarterHeadlessOptions = {}
): Promise<StarterHeadlessRunResult> {
  let outputDirectory: string | null = null;

  try {
    const protocol = parseStarterHeadlessProtocol(protocolInput);
    const starterRootPath = resolveStarterRootPath();
    outputDirectory = await createSnapshotRunDirectory(starterRootPath, options.outputRootDirectory);
    const harnessSource = await bundleHeadlessHarnessSource(starterRootPath);

    const browser = await chromium.launch({
      headless: true,
      args: SWIFTSHADER_CHROMIUM_ARGS
    });

    try {
      const context = await browser.newContext({
        viewport: {
          width: STARTER_HEADLESS_VIEWPORT.width,
          height: STARTER_HEADLESS_VIEWPORT.height
        },
        deviceScaleFactor: STARTER_HEADLESS_VIEWPORT.dpr
      });

      const page = await context.newPage();
      await page.setContent(buildCanvasDocumentHtml());
      await page.addScriptTag({
        type: 'module',
        content: harnessSource
      });
      await page.waitForFunction((globalName) => {
        return typeof (window as HarnessWindow)[globalName] !== 'undefined';
      }, HARNESS_WINDOW_GLOBAL);

      await page.evaluate(
        async (params: { globalName: string; canvasId: string }) => {
          const harness = (window as HarnessWindow)[params.globalName];
          if (!harness) {
            throw new Error('Headless browser harness was not initialized');
          }
          await harness.bootstrap(params.canvasId);
        },
        {
          globalName: HARNESS_WINDOW_GLOBAL,
          canvasId: CANVAS_ID
        }
      );

      const driver = createPlaywrightDriver(page);
      const execution = await executeStarterHeadlessProtocol(protocol, driver, {
        nowMs: options.nowMs,
        maxRunSeconds: MAX_RUN_SECONDS
      });
      const captures = await persistCaptures(execution.captures, outputDirectory);

      await page.evaluate((params: { globalName: string }) => {
        (window as HarnessWindow)[params.globalName]?.destroy();
      }, {
        globalName: HARNESS_WINDOW_GLOBAL
      });
      await context.close();

      return {
        ok: true,
        frameCount: execution.frameCount,
        captures,
        diagnostics: [
          `Game ${options.gameVersionId ?? path.basename(starterRootPath)}`,
          `Viewport ${STARTER_HEADLESS_VIEWPORT.width}x${STARTER_HEADLESS_VIEWPORT.height} @ dpr ${STARTER_HEADLESS_VIEWPORT.dpr}`,
          `Limits maxFrames=${STARTER_HEADLESS_LIMITS.maxFrames}, maxSnaps=${STARTER_HEADLESS_LIMITS.maxSnaps}`,
          `Executed ${protocol.steps.length} steps`
        ],
        outputDirectory
      };
    } finally {
      await browser.close();
    }
  } catch (error: unknown) {
    return {
      ok: false,
      frameCount: 0,
      captures: [],
      diagnostics: [toErrorMessage(error)],
      outputDirectory
    };
  }
}

async function bundleHeadlessHarnessSource(starterRootPath: string): Promise<string> {
  const entryPath = path.join(starterRootPath, 'src/headless/browserHarness.ts');
  const result = await build({
    entryPoints: [entryPath],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2020'],
    write: false
  });

  const outputFile = result.outputFiles[0];
  if (!outputFile) {
    throw new Error('Failed to compile starter headless browser harness');
  }
  return outputFile.text;
}

function resolveStarterRootPath(): string {
  const thisFilePath = fileURLToPath(import.meta.url);
  const thisDirectoryPath = path.dirname(thisFilePath);
  return path.resolve(thisDirectoryPath, '..', '..');
}

function buildCanvasDocumentHtml(): string {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body {
        margin: 0;
        width: 100%;
        height: 100%;
        background: #020617;
      }
      #${CANVAS_ID} {
        width: 100vw;
        height: 100vh;
        display: block;
      }
    </style>
  </head>
  <body>
    <canvas id="${CANVAS_ID}"></canvas>
  </body>
</html>`;
}

function createPlaywrightDriver(page: Page): StarterHeadlessScriptDriver {
  return {
    runFrames: async (frameCount) => {
      await page.evaluate(
        (params: { globalName: string; frameCount: number }) => {
          const harness = (window as HarnessWindow)[params.globalName];
          if (!harness) {
            throw new Error('Headless browser harness was not initialized');
          }
          harness.runFrames(params.frameCount);
        },
        {
          globalName: HARNESS_WINDOW_GLOBAL,
          frameCount
        }
      );
    },
    applyInput: async (event) => {
      await page.evaluate(
        (params: { globalName: string; event: SyntheticInputEvent }) => {
          const harness = (window as HarnessWindow)[params.globalName];
          if (!harness) {
            throw new Error('Headless browser harness was not initialized');
          }
          harness.applyInput(params.event);
        },
        {
          globalName: HARNESS_WINDOW_GLOBAL,
          event
        }
      );
    },
    captureSnapshot: async () => {
      return page.evaluate((params: { globalName: string }) => {
        const harness = (window as HarnessWindow)[params.globalName];
        if (!harness) {
          throw new Error('Headless browser harness was not initialized');
        }
        return harness.captureSnapshot();
      }, {
        globalName: HARNESS_WINDOW_GLOBAL
      });
    },
    readFrameCount: async () => {
      return page.evaluate((params: { globalName: string }) => {
        const harness = (window as HarnessWindow)[params.globalName];
        if (!harness) {
          throw new Error('Headless browser harness was not initialized');
        }
        return harness.readFrameCount();
      }, {
        globalName: HARNESS_WINDOW_GLOBAL
      });
    }
  };
}

async function createSnapshotRunDirectory(
  starterRootPath: string,
  outputRootDirectory?: string
): Promise<string> {
  const rootPath = outputRootDirectory ?? path.join(starterRootPath, 'snapshots');
  const runDirectory = path.join(rootPath, createTimestampDirectoryName());
  await fs.mkdir(runDirectory, { recursive: true });
  return runDirectory;
}

function createTimestampDirectoryName(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function persistCaptures(
  captures: readonly { label: string; frame: number; pngDataUrl: string }[],
  outputDirectory: string
): Promise<readonly StarterHeadlessCapture[]> {
  const persistedCaptures: StarterHeadlessCapture[] = [];

  for (const [index, capture] of captures.entries()) {
    const label = sanitizeLabel(capture.label);
    const fileName = `${String(index + 1).padStart(2, '0')}-${label}.png`;
    const absolutePath = path.join(outputDirectory, fileName);
    const pngBytes = decodePngDataUrl(capture.pngDataUrl);
    await fs.writeFile(absolutePath, pngBytes);
    persistedCaptures.push({
      label: capture.label,
      frame: capture.frame,
      path: absolutePath
    });
  }

  return persistedCaptures;
}

function decodePngDataUrl(dataUrl: string): Buffer {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match?.[1]) {
    throw new Error('Snapshot capture returned a non-PNG data URL');
  }
  return Buffer.from(match[1], 'base64');
}

function sanitizeLabel(label: string): string {
  const normalized = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');

  if (normalized.length > 0) {
    return normalized;
  }
  return 'snap';
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
