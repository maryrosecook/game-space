export type FrameInfo = {
  width: number;
  height: number;
  viewportScale: number;
};

export type GameLoopConfig = {
  fixedStepSeconds: number;
  maxFrameDeltaSeconds: number;
  maxFixedStepsPerFrame: number;
};

export type GameInitContext<TScene extends string> = {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  scenes: SceneMachine<TScene>;
  assets: AssetStore;
  random: RandomSource;
};

export type GameUpdateContext<TScene extends string, TAction extends string> = {
  deltaSeconds: number;
  elapsedSeconds: number;
  stepIndex: number;
  frame: FrameInfo;
  scene: TScene;
  setScene: (scene: TScene) => void;
  input: ActionInputState<TAction>;
};

export type GameRenderContext<TScene extends string> = {
  elapsedSeconds: number;
  frame: FrameInfo;
  scene: TScene;
};

export type GameResizeContext = {
  frame: FrameInfo;
};

export type GameHooks<TState, TScene extends string, TAction extends string> = {
  loop: GameLoopConfig;
  init: (context: GameInitContext<TScene>) => TState;
  update: (state: TState, context: GameUpdateContext<TScene, TAction>) => TState;
  render: (state: TState, context: GameRenderContext<TScene>) => void;
  onResize?: (state: TState, context: GameResizeContext) => void;
  dispose?: (state: TState) => void;
};

export type PointerTouchEventTarget = {
  addEventListener: (
    type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
    listener: (event: PointerEvent) => void,
    options?: boolean | AddEventListenerOptions
  ) => void;
  removeEventListener: (
    type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
    listener: (event: PointerEvent) => void,
    options?: boolean | EventListenerOptions
  ) => void;
};

export type TouchPoint = {
  id: number;
  x: number;
  y: number;
  normalizedX: number;
  normalizedY: number;
};

export type TouchSnapshot = {
  touches: readonly TouchPoint[];
  tapCount: number;
};

export type TouchStateTracker = {
  snapshot: () => TouchSnapshot;
  dispose: () => void;
};

export type ActionInputState<TAction extends string> = {
  isDown: (action: TAction) => boolean;
  wasPressed: (action: TAction) => boolean;
};

export type InputMapper<TAction extends string> = {
  map: (snapshot: TouchSnapshot) => ActionInputState<TAction>;
};

export type TouchBinding = {
  down?: (touches: readonly TouchPoint[]) => boolean;
  pressed?: (tapCount: number, touches: readonly TouchPoint[]) => boolean;
};

export type SceneMachine<TScene extends string> = {
  getCurrentScene: () => TScene;
  setScene: (nextScene: TScene) => void;
  isScene: (scene: TScene) => boolean;
};

export type RandomSource = {
  next: () => number;
  nextRange: (min: number, max: number) => number;
  nextSign: () => -1 | 1;
};

export type CircleState = {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
  radius: number;
};

export type CircleBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export type AxisBounceResult = {
  position: number;
  velocity: number;
};

export type CircleRadii = {
  radiusX: number;
  radiusY: number;
};

export type AssetLoaders = {
  textLoader: (url: string) => Promise<string>;
};

export type AssetStore = {
  loadText: (url: string) => Promise<string>;
  loadJson: <TData>(url: string) => Promise<TData>;
  preloadText: (urls: readonly string[]) => Promise<void>;
};

export type FixedStepTicker = {
  stepSeconds: number;
  maxStepsPerFrame: number;
  accumulatorSeconds: number;
  elapsedSeconds: number;
};

export type LoopUpdateContext = {
  deltaSeconds: number;
  elapsedSeconds: number;
  stepIndex: number;
  frame: FrameInfo;
};

export type LoopRenderContext = {
  elapsedSeconds: number;
  frame: FrameInfo;
};

export type LoopCallbacks = {
  beginFrame: (frame: FrameInfo) => void;
  update: (context: LoopUpdateContext) => void;
  render: (context: LoopRenderContext) => void;
  onResize?: (frame: FrameInfo) => void;
};

export type CanvasViewportTarget = {
  width: number;
  height: number;
  clientWidth: number;
  clientHeight: number;
};

export type LoopTickContext = {
  previousTimestamp: number | null;
  fixedStepTicker: FixedStepTicker;
  animationFrameId: number | null;
  isStopped: boolean;
  canvas: CanvasViewportTarget;
  config: GameLoopConfig;
  callbacks: LoopCallbacks;
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (requestId: number) => void;
};

export type AnimationLoopController = {
  stop: () => void;
  tickContext: LoopTickContext;
};

type ResizedFrame = {
  frame: FrameInfo;
  didResize: boolean;
};

async function defaultTextLoader(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load text asset: ${url}`);
  }
  return response.text();
}

export function clampDeltaSeconds(deltaSeconds: number, maxDeltaSeconds: number): number {
  return Math.min(Math.max(deltaSeconds, 0), maxDeltaSeconds);
}

export function createFixedStepTicker(stepSeconds: number, maxStepsPerFrame: number): FixedStepTicker {
  return {
    stepSeconds,
    maxStepsPerFrame,
    accumulatorSeconds: 0,
    elapsedSeconds: 0
  };
}

export function consumeFixedSteps(
  ticker: FixedStepTicker,
  deltaSeconds: number,
  onStep: (stepSeconds: number, elapsedSeconds: number, stepIndex: number) => void
): number {
  ticker.accumulatorSeconds += deltaSeconds;
  let steps = 0;
  const epsilon = 1e-9;

  while (ticker.accumulatorSeconds + epsilon >= ticker.stepSeconds && steps < ticker.maxStepsPerFrame) {
    ticker.accumulatorSeconds -= ticker.stepSeconds;
    ticker.elapsedSeconds += ticker.stepSeconds;
    onStep(ticker.stepSeconds, ticker.elapsedSeconds, steps);
    steps += 1;
  }

  if (steps === ticker.maxStepsPerFrame && ticker.accumulatorSeconds > ticker.stepSeconds) {
    ticker.accumulatorSeconds = 0;
  }

  return steps;
}

export function resizeCanvasToViewport(canvas: CanvasViewportTarget): ResizedFrame {
  const width = Math.max(1, Math.floor(canvas.clientWidth));
  const height = Math.max(1, Math.floor(canvas.clientHeight));
  const didResize = canvas.width !== width || canvas.height !== height;

  if (didResize) {
    canvas.width = width;
    canvas.height = height;
  }

  return {
    frame: {
      width,
      height,
      viewportScale: height / Math.max(width, 1)
    },
    didResize
  };
}

export function tickAnimationLoop(timestamp: number, context: LoopTickContext): void {
  if (context.isStopped) {
    return;
  }

  const previousTimestamp = context.previousTimestamp ?? timestamp;
  const rawDeltaSeconds = (timestamp - previousTimestamp) / 1000;
  const deltaSeconds = clampDeltaSeconds(rawDeltaSeconds, context.config.maxFrameDeltaSeconds);
  context.previousTimestamp = timestamp;

  const resizedFrame = resizeCanvasToViewport(context.canvas);
  if (resizedFrame.didResize && context.callbacks.onResize) {
    context.callbacks.onResize(resizedFrame.frame);
  }

  context.callbacks.beginFrame(resizedFrame.frame);
  consumeFixedSteps(context.fixedStepTicker, deltaSeconds, (stepSeconds, elapsedSeconds, stepIndex) => {
    context.callbacks.update({
      deltaSeconds: stepSeconds,
      elapsedSeconds,
      stepIndex,
      frame: resizedFrame.frame
    });
  });

  context.callbacks.render({
    elapsedSeconds: context.fixedStepTicker.elapsedSeconds,
    frame: resizedFrame.frame
  });

  context.animationFrameId = context.requestFrame((nextTimestamp) => {
    tickAnimationLoop(nextTimestamp, context);
  });
}

export function createAnimationLoop(
  canvas: CanvasViewportTarget,
  config: GameLoopConfig,
  callbacks: LoopCallbacks
): AnimationLoopController {
  const tickContext: LoopTickContext = {
    previousTimestamp: null,
    fixedStepTicker: createFixedStepTicker(config.fixedStepSeconds, config.maxFixedStepsPerFrame),
    animationFrameId: null,
    isStopped: false,
    canvas,
    config,
    callbacks,
    requestFrame: (callback) => window.requestAnimationFrame(callback),
    cancelFrame: (requestId) => window.cancelAnimationFrame(requestId)
  };

  tickContext.animationFrameId = tickContext.requestFrame((timestamp) => {
    tickAnimationLoop(timestamp, tickContext);
  });

  return {
    tickContext,
    stop: () => {
      tickContext.isStopped = true;
      if (tickContext.animationFrameId !== null) {
        tickContext.cancelFrame(tickContext.animationFrameId);
      }
    }
  };
}

type PointerTouchState = {
  id: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
};

function toCanvasTouchPoint(canvas: HTMLCanvasElement, pointerState: PointerTouchState): TouchPoint {
  const boundingRect = canvas.getBoundingClientRect();
  const width = Math.max(1, boundingRect.width);
  const height = Math.max(1, boundingRect.height);
  const normalizedX = ((pointerState.x - boundingRect.left) / width) * 2 - 1;
  const normalizedY = ((pointerState.y - boundingRect.top) / height) * 2 - 1;

  return {
    id: pointerState.id,
    x: pointerState.x,
    y: pointerState.y,
    normalizedX: Math.max(-1, Math.min(1, normalizedX)),
    normalizedY: Math.max(-1, Math.min(1, normalizedY))
  };
}

export function createTouchStateTracker(
  target: PointerTouchEventTarget,
  canvas: HTMLCanvasElement
): TouchStateTracker {
  const activeTouches = new Map<number, PointerTouchState>();
  let tapCount = 0;
  const tapDistanceThresholdPixels = 16;

  function handlePointerDown(event: PointerEvent): void {
    if (event.pointerType !== 'touch') {
      return;
    }

    activeTouches.set(event.pointerId, {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY
    });
    event.preventDefault();
  }

  function handlePointerMove(event: PointerEvent): void {
    if (event.pointerType !== 'touch') {
      return;
    }

    const pointerState = activeTouches.get(event.pointerId);
    if (!pointerState) {
      return;
    }

    pointerState.x = event.clientX;
    pointerState.y = event.clientY;
    event.preventDefault();
  }

  function handlePointerUpOrCancel(event: PointerEvent): void {
    if (event.pointerType !== 'touch') {
      return;
    }

    const pointerState = activeTouches.get(event.pointerId);
    if (pointerState) {
      const deltaX = event.clientX - pointerState.startX;
      const deltaY = event.clientY - pointerState.startY;
      const travelDistance = Math.hypot(deltaX, deltaY);
      if (travelDistance <= tapDistanceThresholdPixels && event.type === 'pointerup') {
        tapCount += 1;
      }
    }

    activeTouches.delete(event.pointerId);
    event.preventDefault();
  }

  target.addEventListener('pointerdown', handlePointerDown);
  target.addEventListener('pointermove', handlePointerMove);
  target.addEventListener('pointerup', handlePointerUpOrCancel);
  target.addEventListener('pointercancel', handlePointerUpOrCancel);

  return {
    snapshot: () => {
      const touches = Array.from(activeTouches.values()).map((pointerState) => toCanvasTouchPoint(canvas, pointerState));
      touches.sort((left, right) => left.id - right.id);
      const snapshot: TouchSnapshot = {
        touches,
        tapCount
      };
      tapCount = 0;
      return snapshot;
    },
    dispose: () => {
      target.removeEventListener('pointerdown', handlePointerDown);
      target.removeEventListener('pointermove', handlePointerMove);
      target.removeEventListener('pointerup', handlePointerUpOrCancel);
      target.removeEventListener('pointercancel', handlePointerUpOrCancel);
    }
  };
}

export function createTouchInputMapper<TAction extends string>(
  bindings: Record<TAction, TouchBinding>
): InputMapper<TAction> {
  return {
    map: (snapshot: TouchSnapshot) => {
      return {
        isDown: (action: TAction) => {
          const binding = bindings[action];
          if (!binding.down) {
            return false;
          }
          return binding.down(snapshot.touches);
        },
        wasPressed: (action: TAction) => {
          const binding = bindings[action];
          if (!binding.pressed) {
            return false;
          }
          return binding.pressed(snapshot.tapCount, snapshot.touches);
        }
      };
    }
  };
}

export function createSceneMachine<TScene extends string>(initialScene: TScene): SceneMachine<TScene> {
  let currentScene = initialScene;

  return {
    getCurrentScene: () => currentScene,
    setScene: (nextScene: TScene) => {
      currentScene = nextScene;
    },
    isScene: (scene: TScene) => currentScene === scene
  };
}

export function createRandom(seed = Date.now()): RandomSource {
  let state = seed >>> 0;

  function next(): number {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  }

  function nextRange(min: number, max: number): number {
    return min + (max - min) * next();
  }

  function nextSign(): -1 | 1 {
    return next() < 0.5 ? -1 : 1;
  }

  return {
    next,
    nextRange,
    nextSign
  };
}

export function advanceAxisInBounds(
  position: number,
  velocity: number,
  radius: number,
  deltaSeconds: number,
  min: number,
  max: number
): AxisBounceResult {
  let nextPosition = position + velocity * deltaSeconds;
  let nextVelocity = velocity;

  if (nextPosition >= max - radius) {
    nextPosition = max - radius;
    nextVelocity *= -1;
  }
  if (nextPosition <= min + radius) {
    nextPosition = min + radius;
    nextVelocity *= -1;
  }

  return {
    position: nextPosition,
    velocity: nextVelocity
  };
}

export function advanceCircleInBounds(
  circle: CircleState,
  deltaSeconds: number,
  bounds: CircleBounds,
  radii: CircleRadii = { radiusX: circle.radius, radiusY: circle.radius }
): CircleState {
  const nextX = advanceAxisInBounds(
    circle.x,
    circle.velocityX,
    radii.radiusX,
    deltaSeconds,
    bounds.minX,
    bounds.maxX
  );
  const nextY = advanceAxisInBounds(
    circle.y,
    circle.velocityY,
    radii.radiusY,
    deltaSeconds,
    bounds.minY,
    bounds.maxY
  );

  return {
    ...circle,
    x: nextX.position,
    y: nextY.position,
    velocityX: nextX.velocity,
    velocityY: nextY.velocity
  };
}

export function createAssetStore(loaders: Partial<AssetLoaders> = {}): AssetStore {
  const textLoader = loaders.textLoader ?? defaultTextLoader;

  const textCache = new Map<string, Promise<string>>();

  function loadText(url: string): Promise<string> {
    const cached = textCache.get(url);
    if (cached) {
      return cached;
    }

    const pending = textLoader(url);
    textCache.set(url, pending);
    return pending;
  }

  async function loadJson<TData>(url: string): Promise<TData> {
    const text = await loadText(url);
    return JSON.parse(text) as TData;
  }

  async function preloadText(urls: readonly string[]): Promise<void> {
    await Promise.all(urls.map((url) => loadText(url)));
  }

  return {
    loadText,
    loadJson,
    preloadText
  };
}
