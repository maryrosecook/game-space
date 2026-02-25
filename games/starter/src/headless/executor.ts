import type { SyntheticInputEvent } from '../engine/input';
import {
  MAX_RUN_SECONDS,
  STARTER_HEADLESS_VIEWPORT,
  StarterHeadlessInputStep,
  StarterHeadlessProtocol
} from './protocol';

export type StarterHeadlessDriverCapture = {
  frame: number;
  pngDataUrl: string;
};

export type StarterHeadlessExecutionCapture = StarterHeadlessDriverCapture & {
  label: string;
};

export type StarterHeadlessExecutionResult = {
  frameCount: number;
  captures: readonly StarterHeadlessExecutionCapture[];
};

export type StarterHeadlessScriptDriver = {
  runFrames: (frameCount: number) => Promise<void>;
  applyInput: (event: SyntheticInputEvent) => Promise<void>;
  captureSnapshot: () => Promise<StarterHeadlessDriverCapture>;
  readFrameCount: () => Promise<number>;
};

export type ExecuteStarterHeadlessOptions = {
  nowMs?: () => number;
  maxRunSeconds?: number;
};

export async function executeStarterHeadlessProtocol(
  protocol: StarterHeadlessProtocol,
  driver: StarterHeadlessScriptDriver,
  options: ExecuteStarterHeadlessOptions = {}
): Promise<StarterHeadlessExecutionResult> {
  const captures: StarterHeadlessExecutionCapture[] = [];
  const nowMs = options.nowMs ?? (() => Date.now());
  const maxRuntimeMs = (options.maxRunSeconds ?? MAX_RUN_SECONDS) * 1000;
  const startedAtMs = nowMs();

  for (const [stepIndex, step] of protocol.steps.entries()) {
    enforceRuntimeLimit(nowMs, startedAtMs, maxRuntimeMs, stepIndex);

    if ('run' in step) {
      await driver.runFrames(step.run);
      continue;
    }

    if ('input' in step) {
      const inputEvent = toSyntheticInputEvent(step.input);
      await driver.applyInput(inputEvent);
      continue;
    }

    const capture = await driver.captureSnapshot();
    captures.push({
      label: step.snap,
      frame: capture.frame,
      pngDataUrl: capture.pngDataUrl
    });
  }

  enforceRuntimeLimit(nowMs, startedAtMs, maxRuntimeMs, protocol.steps.length);

  return {
    frameCount: await driver.readFrameCount(),
    captures
  };
}

function toSyntheticInputEvent(inputStep: StarterHeadlessInputStep): SyntheticInputEvent {
  const clientPosition = toClientPosition(inputStep);
  return {
    action: inputStep.action,
    pointerId: inputStep.pointerId,
    clientX: clientPosition.clientX,
    clientY: clientPosition.clientY,
    source: inputStep.emit
  };
}

function toClientPosition(inputStep: StarterHeadlessInputStep): { clientX: number; clientY: number } {
  if (inputStep.space === 'pixels') {
    return {
      clientX: inputStep.x,
      clientY: inputStep.y
    };
  }

  return {
    clientX: inputStep.x * STARTER_HEADLESS_VIEWPORT.width,
    clientY: inputStep.y * STARTER_HEADLESS_VIEWPORT.height
  };
}

function enforceRuntimeLimit(
  nowMs: () => number,
  startedAtMs: number,
  maxRuntimeMs: number,
  stepIndex: number
): void {
  const elapsedMs = nowMs() - startedAtMs;
  if (elapsedMs <= maxRuntimeMs) {
    return;
  }

  throw new Error(
    `Headless run exceeded max runtime of ${Math.floor(maxRuntimeMs / 1000)} seconds at step ${stepIndex}`
  );
}
