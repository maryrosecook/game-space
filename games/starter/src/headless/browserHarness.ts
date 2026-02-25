import { createStarterEngine } from '../main';
import { HeadlessFrameScheduler } from '../engine/frameScheduler';
import { HeadlessInputManager } from '../engine/input';
import type { SyntheticInputEvent } from '../engine/input';

type StarterHeadlessHarness = {
  bootstrap: (canvasId: string) => Promise<void>;
  runFrames: (frameCount: number) => void;
  applyInput: (event: SyntheticInputEvent) => void;
  captureSnapshot: () => { frame: number; pngDataUrl: string };
  readFrameCount: () => number;
  destroy: () => void;
};

declare global {
  interface Window {
    __starterHeadlessHarness?: StarterHeadlessHarness;
  }
}

let scheduler: HeadlessFrameScheduler | null = null;
let inputManager: HeadlessInputManager | null = null;
let engine: ReturnType<typeof createStarterEngine> | null = null;
let canvas: HTMLCanvasElement | null = null;
let webGlContext: WebGLRenderingContext | null = null;
let frameCount = 0;

window.__starterHeadlessHarness = {
  async bootstrap(canvasId: string): Promise<void> {
    destroyHarnessState();

    const target = document.getElementById(canvasId);
    if (!(target instanceof HTMLCanvasElement)) {
      throw new Error(`Could not find canvas element with id "${canvasId}"`);
    }
    canvas = target;

    const headlessWebGl = canvas.getContext('webgl', {
      preserveDrawingBuffer: true,
      alpha: false
    });
    if (!(headlessWebGl instanceof WebGLRenderingContext)) {
      throw new Error('WebGL is unavailable in this browser context');
    }
    webGlContext = headlessWebGl;

    scheduler = new HeadlessFrameScheduler();
    inputManager = new HeadlessInputManager();
    frameCount = 0;

    const requestFrame = (callback: FrameRequestCallback): number => {
      const activeScheduler = scheduler;
      if (!activeScheduler) {
        throw new Error('Headless frame scheduler is unavailable');
      }

      return activeScheduler.requestFrame((timestamp) => {
        frameCount += 1;
        callback(timestamp);
      });
    };

    const cancelFrame = (handle: number): void => {
      scheduler?.cancelFrame(handle);
    };

    engine = createStarterEngine({
      createInputManager: () => {
        if (!inputManager) {
          throw new Error('Headless input manager is unavailable');
        }
        return inputManager;
      },
      requestFrame,
      cancelFrame
    });

    await engine.initialize(canvas, 'starter');
  },
  runFrames(frameTarget: number): void {
    if (!scheduler) {
      throw new Error('Headless harness has not been bootstrapped');
    }

    scheduler.step(frameTarget);
  },
  applyInput(event: SyntheticInputEvent): void {
    if (!inputManager) {
      throw new Error('Headless harness has not been bootstrapped');
    }

    inputManager.applySyntheticEvent(event);
  },
  captureSnapshot(): { frame: number; pngDataUrl: string } {
    if (!canvas) {
      throw new Error('Headless harness has not been bootstrapped');
    }
    webGlContext?.finish();

    return {
      frame: frameCount,
      pngDataUrl: canvas.toDataURL('image/png')
    };
  },
  readFrameCount(): number {
    return frameCount;
  },
  destroy(): void {
    destroyHarnessState();
  }
};

function destroyHarnessState(): void {
  engine?.destroy();
  engine = null;
  scheduler = null;
  inputManager = null;
  canvas = null;
  webGlContext = null;
  frameCount = 0;
}
