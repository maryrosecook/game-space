export const STARTER_HEADLESS_VIEWPORT_WIDTH = 360;
export const STARTER_HEADLESS_VIEWPORT_HEIGHT = 640;
export const STARTER_HEADLESS_VIEWPORT_DPR = 1;

export const MAX_TOTAL_FRAMES = 120;
export const MAX_SNAPSHOTS = 1;
export const MAX_STEPS = 64;
export const MAX_INPUT_EVENTS = 128;
export const MAX_RUN_SECONDS = 20;

export type HeadlessInputSpace = 'norm01' | 'pixels';
export type HeadlessInputAction = 'down' | 'move' | 'up' | 'cancel';
export type HeadlessInputEmit = 'touch' | 'mouse' | 'both';

export type StarterHeadlessViewport = {
  width: number;
  height: number;
  dpr: number;
};

export type StarterHeadlessLimits = {
  maxFrames: number;
  maxSnaps: number;
};

export const STARTER_HEADLESS_VIEWPORT: StarterHeadlessViewport = {
  width: STARTER_HEADLESS_VIEWPORT_WIDTH,
  height: STARTER_HEADLESS_VIEWPORT_HEIGHT,
  dpr: STARTER_HEADLESS_VIEWPORT_DPR
};

export const STARTER_HEADLESS_LIMITS: StarterHeadlessLimits = {
  maxFrames: MAX_TOTAL_FRAMES,
  maxSnaps: MAX_SNAPSHOTS
};

export type StarterHeadlessInputStep = {
  action: HeadlessInputAction;
  pointerId: number;
  x: number;
  y: number;
  space: HeadlessInputSpace;
  emit: HeadlessInputEmit;
};

export type StarterHeadlessStep =
  | {
      run: number;
    }
  | {
      input: StarterHeadlessInputStep;
    }
  | {
      snap: string;
    };

export type StarterHeadlessProtocol = {
  steps: readonly StarterHeadlessStep[];
};

type JsonRecord = Record<string, unknown>;

type ParserState = {
  totalFrames: number;
  snapCount: number;
  inputCount: number;
};

export function parseStarterHeadlessProtocol(value: unknown): StarterHeadlessProtocol {
  const root = expectRecord(value, 'Protocol must be a JSON object');
  assertOnlySupportedTopLevelFields(root);
  const steps = parseSteps(root.steps, STARTER_HEADLESS_VIEWPORT, STARTER_HEADLESS_LIMITS);

  return {
    steps
  };
}

export function createStarterHeadlessSmokeProtocol(): StarterHeadlessProtocol {
  return parseStarterHeadlessProtocol({
    steps: [
      { run: 5 },
      {
        input: {
          action: 'down',
          pointerId: 1,
          x: 0.52,
          y: 0.63,
          space: 'norm01',
          emit: 'both'
        }
      },
      { run: 15 },
      {
        input: {
          action: 'up',
          pointerId: 1,
          x: 0.52,
          y: 0.63,
          space: 'norm01',
          emit: 'both'
        }
      },
      { run: 80 },
      { snap: 'smoke' }
    ]
  });
}

function assertOnlySupportedTopLevelFields(root: JsonRecord): void {
  for (const fieldName of Object.keys(root)) {
    if (fieldName === 'steps') {
      continue;
    }

    throw new Error(`Unsupported top-level field "${fieldName}". Protocol only supports "steps".`);
  }
}

function parseSteps(
  value: unknown,
  viewport: StarterHeadlessViewport,
  limits: StarterHeadlessLimits
): readonly StarterHeadlessStep[] {
  if (!Array.isArray(value)) {
    throw new Error('steps must be an array');
  }
  if (value.length === 0) {
    throw new Error('steps must contain at least one action');
  }
  if (value.length > MAX_STEPS) {
    throw new Error(`steps cannot exceed ${MAX_STEPS}`);
  }

  const parserState: ParserState = {
    totalFrames: 0,
    snapCount: 0,
    inputCount: 0
  };

  return value.map((stepValue, stepIndex) => {
    return parseStep(stepValue, stepIndex, parserState, viewport, limits);
  });
}

function parseStep(
  value: unknown,
  index: number,
  state: ParserState,
  viewport: StarterHeadlessViewport,
  limits: StarterHeadlessLimits
): StarterHeadlessStep {
  const step = expectRecord(value, `steps[${index}] must be an object`);
  const hasRun = Object.hasOwn(step, 'run');
  const hasInput = Object.hasOwn(step, 'input');
  const hasSnap = Object.hasOwn(step, 'snap');
  const activeKeyCount = Number(hasRun) + Number(hasInput) + Number(hasSnap);
  if (activeKeyCount !== 1) {
    throw new Error(`steps[${index}] must include exactly one of run, input, or snap`);
  }

  if (hasRun) {
    const run = expectPositiveInteger(step.run, `steps[${index}].run`);
    state.totalFrames += run;
    if (state.totalFrames > limits.maxFrames) {
      throw new Error(
        `steps[${index}] exceeds frame limit ${limits.maxFrames} (total requested: ${state.totalFrames})`
      );
    }
    return { run };
  }

  if (hasInput) {
    state.inputCount += 1;
    if (state.inputCount > MAX_INPUT_EVENTS) {
      throw new Error(`input steps cannot exceed ${MAX_INPUT_EVENTS}`);
    }

    return {
      input: parseInputStep(step.input, index, viewport)
    };
  }

  const snap = expectNonEmptyLabel(step.snap, `steps[${index}].snap`);
  state.snapCount += 1;
  if (state.snapCount > limits.maxSnaps) {
    throw new Error(
      `steps[${index}] exceeds snapshot limit ${limits.maxSnaps} (requested: ${state.snapCount})`
    );
  }

  return { snap };
}

function parseInputStep(
  value: unknown,
  stepIndex: number,
  viewport: StarterHeadlessViewport
): StarterHeadlessInputStep {
  const input = expectRecord(value, `steps[${stepIndex}].input must be an object`);
  const action = expectInputAction(input.action, `steps[${stepIndex}].input.action`);
  const pointerId = expectInteger(input.pointerId, `steps[${stepIndex}].input.pointerId`);
  const x = expectFiniteNumber(input.x, `steps[${stepIndex}].input.x`);
  const y = expectFiniteNumber(input.y, `steps[${stepIndex}].input.y`);
  const space = expectInputSpace(input.space ?? 'norm01', `steps[${stepIndex}].input.space`);
  const emit = expectInputEmit(input.emit ?? 'both', `steps[${stepIndex}].input.emit`);

  if (space === 'norm01') {
    expectBoundedNumber(x, `steps[${stepIndex}].input.x`, 0, 1);
    expectBoundedNumber(y, `steps[${stepIndex}].input.y`, 0, 1);
  } else {
    expectBoundedNumber(x, `steps[${stepIndex}].input.x`, 0, viewport.width);
    expectBoundedNumber(y, `steps[${stepIndex}].input.y`, 0, viewport.height);
  }

  return {
    action,
    pointerId,
    x,
    y,
    space,
    emit
  };
}

function expectRecord(value: unknown, message: string): JsonRecord {
  if (!isJsonRecord(value)) {
    throw new Error(message);
  }
  return value;
}

function expectInteger(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${fieldName} must be an integer`);
  }
  return value;
}

function expectPositiveInteger(value: unknown, fieldName: string): number {
  const parsed = expectInteger(value, fieldName);
  if (parsed <= 0) {
    throw new Error(`${fieldName} must be greater than 0`);
  }
  return parsed;
}

function expectFiniteNumber(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${fieldName} must be a finite number`);
  }
  return value;
}

function expectBoundedNumber(
  value: unknown,
  fieldName: string,
  min: number,
  max: number
): number {
  const parsed = expectFiniteNumber(value, fieldName);
  if (parsed < min || parsed > max) {
    throw new Error(`${fieldName} must be between ${min} and ${max}`);
  }
  return parsed;
}

function expectInputAction(value: unknown, fieldName: string): HeadlessInputAction {
  if (value === 'down' || value === 'move' || value === 'up' || value === 'cancel') {
    return value;
  }
  throw new Error(`${fieldName} must be one of: down, move, up, cancel`);
}

function expectInputSpace(value: unknown, fieldName: string): HeadlessInputSpace {
  if (value === 'norm01' || value === 'pixels') {
    return value;
  }
  throw new Error(`${fieldName} must be one of: norm01, pixels`);
}

function expectInputEmit(value: unknown, fieldName: string): HeadlessInputEmit {
  if (value === 'touch' || value === 'mouse' || value === 'both') {
    return value;
  }
  throw new Error(`${fieldName} must be one of: touch, mouse, both`);
}

function expectNonEmptyLabel(value: unknown, fieldName: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return trimmed;
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
