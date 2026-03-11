export type GameGlobalValue = string | number | boolean | null;

export type GameGlobals = Record<string, GameGlobalValue>;

export type GameControlState = {
  globals?: GameGlobals;
};

export type GameEditorSlider = {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  globalKey: string;
};

export type GameEditor = {
  sliders?: readonly GameEditorSlider[];
};

export type GameRuntimeSlider = GameEditorSlider & {
  value: number;
};

export type GameRuntimeControls = {
  getSliders: () => readonly GameRuntimeSlider[];
  setGlobalValue: (globalKey: string, value: GameGlobalValue) => boolean;
  serializeControlState: () => GameControlState;
};

export type GameRuntimeHost = {
  versionId: string;
  loadControlState?: () => Promise<GameControlState | null>;
  saveControlState?: (controlState: GameControlState) => Promise<void>;
};

export type GameRuntimeHandle = GameRuntimeControls & {
  teardown: () => void;
};

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isGameGlobalValue(value: unknown): value is GameGlobalValue {
  if (value === null) {
    return true;
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }

  return isFiniteNumber(value);
}

export function parseGameGlobals(value: unknown): GameGlobals | null {
  if (!isObjectRecord(value)) {
    return null;
  }

  const globals: GameGlobals = {};
  for (const [key, entryValue] of Object.entries(value)) {
    if (!isGameGlobalValue(entryValue)) {
      return null;
    }

    globals[key] = entryValue;
  }

  return globals;
}

export function parseGameControlState(value: unknown): GameControlState | null {
  if (!isObjectRecord(value)) {
    return null;
  }

  if (value.globals === undefined) {
    return {};
  }

  const globals = parseGameGlobals(value.globals);
  if (globals === null) {
    return null;
  }

  return { globals };
}

export function parseGameEditorSlider(value: unknown): GameEditorSlider | null {
  if (!isObjectRecord(value)) {
    return null;
  }

  if (
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.label) ||
    !isFiniteNumber(value.min) ||
    !isFiniteNumber(value.max) ||
    !isFiniteNumber(value.step) ||
    !isNonEmptyString(value.globalKey)
  ) {
    return null;
  }

  const min = value.min;
  const max = value.max;
  const step = value.step;
  if (max < min || step <= 0) {
    return null;
  }

  return {
    id: value.id.trim(),
    label: value.label.trim(),
    min,
    max,
    step,
    globalKey: value.globalKey.trim()
  };
}

export function parseGameEditorSliders(value: unknown): GameEditorSlider[] | null {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const sliders: GameEditorSlider[] = [];
  for (const entry of value) {
    const slider = parseGameEditorSlider(entry);
    if (slider === null) {
      return null;
    }

    sliders.push(slider);
  }

  return sliders;
}

export function mergeGameGlobals(
  baseGlobals: GameGlobals | undefined,
  controlState: GameControlState | null | undefined
): GameGlobals | undefined {
  const persistedGlobals = controlState?.globals;
  if (!baseGlobals && !persistedGlobals) {
    return undefined;
  }

  return {
    ...(baseGlobals ?? {}),
    ...(persistedGlobals ?? {})
  };
}

export function normalizeSliderValue(slider: GameEditorSlider, value: number): number {
  const stepCount = Math.round((value - slider.min) / slider.step);
  const steppedValue = slider.min + stepCount * slider.step;
  const clampedValue = Math.max(slider.min, Math.min(slider.max, steppedValue));
  const roundedValue = Number(clampedValue.toFixed(6));
  return Object.is(roundedValue, -0) ? 0 : roundedValue;
}

export function resolveSliderValue(
  globals: GameGlobals | undefined,
  slider: GameEditorSlider
): number | null {
  const value = globals?.[slider.globalKey];
  if (!isFiniteNumber(value)) {
    return null;
  }

  return normalizeSliderValue(slider, value);
}

export function resolveRuntimeSliders(
  globals: GameGlobals | undefined,
  sliders: readonly GameEditorSlider[] | undefined
): GameRuntimeSlider[] {
  if (!sliders || sliders.length === 0) {
    return [];
  }

  const runtimeSliders: GameRuntimeSlider[] = [];
  for (const slider of sliders) {
    const value = resolveSliderValue(globals, slider);
    if (value === null) {
      continue;
    }

    runtimeSliders.push({
      ...slider,
      value
    });
  }

  return runtimeSliders;
}

export function applySliderValuesToGlobals(
  globals: GameGlobals | undefined,
  sliders: readonly GameEditorSlider[] | undefined
): GameGlobals | undefined {
  if (!globals) {
    return undefined;
  }

  if (!sliders || sliders.length === 0) {
    return { ...globals };
  }

  const nextGlobals: GameGlobals = { ...globals };
  for (const slider of sliders) {
    const value = resolveSliderValue(nextGlobals, slider);
    if (value === null) {
      continue;
    }

    nextGlobals[slider.globalKey] = value;
  }

  return nextGlobals;
}
