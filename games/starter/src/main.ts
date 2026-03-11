import {
  GameEngine,
  GameEngineDependencies,
  GameEngineDataSource,
  LoadedGame
} from './engine/engine';
import { BrowserRafScheduler } from './engine/frameScheduler';
import { BrowserInputManager } from './engine/input';
import {
  Blueprint,
  GameContext,
  GameFile,
  RuntimeThing
} from './engine/types';
import {
  mergeGameGlobals,
  normalizeSliderValue,
  parseGameEditorSliders,
  resolveRuntimeSliders,
  type GameControlState,
  type GameEditorSlider,
  type GameGlobalValue,
  type GameRuntimeHandle,
  type GameRuntimeHost
} from '../../../src/gameRuntimeControls';

const STARTER_BACKGROUND_COLOR = '#020617';
const STARTER_PARTICLE_COLORS = ['#FACC15', '#F97316', '#EF4444'] as const;
const STARTER_PARTICLE_AMOUNT_KEY = 'particleAmount';
const STARTER_PARTICLE_DEFAULT_AMOUNT = 4;
const STARTER_PARTICLE_EMISSION_RATE = 0.35;
const STARTER_PARTICLE_BLUEPRINT_NAME = 'starter-particle-emitter';
const STARTER_PARTICLE_AMOUNT_SLIDER: GameEditorSlider = {
  id: 'particleAmount',
  label: 'Amount of particles',
  min: 1,
  max: 10,
  step: 1,
  globalKey: STARTER_PARTICLE_AMOUNT_KEY
};

let activeEngine: GameEngine | null = null;

export function startGame(
  canvas: HTMLCanvasElement,
  host?: GameRuntimeHost
): GameRuntimeHandle {
  const versionId = host?.versionId ?? 'starter';
  const runtimeState = createStarterRuntimeState(versionId, host);
  if (activeEngine) {
    activeEngine.destroy();
    activeEngine = null;
  }

  const engine = createStarterEngine({}, host);
  activeEngine = engine;

  const teardown = (): void => {
    if (activeEngine !== engine) {
      return;
    }

    engine.destroy();
    activeEngine = null;
  };

  void engine.initialize(canvas, versionId).catch((error) => {
    console.error('Failed to initialize starter game engine', error);
    teardown();
  });

  return {
    teardown,
    getSliders() {
      return readStarterRuntimeSliders(runtimeState.gameFile);
    },
    setGlobalValue(globalKey: string, value: GameGlobalValue): boolean {
      const didApply = setStarterRuntimeGlobalValue(runtimeState.gameFile, globalKey, value);
      if (!didApply) {
        return false;
      }

      engine.setGlobalValue(globalKey, value);
      return true;
    },
    serializeControlState() {
      return serializeStarterControlState(runtimeState.gameFile);
    }
  };
}

export type StarterEngineOptions = Pick<
  GameEngineDependencies,
  'createInputManager' | 'frameScheduler' | 'requestFrame' | 'cancelFrame' | 'particleSystem'
>;

export function createStarterEngine(
  options: StarterEngineOptions = {},
  host?: GameRuntimeHost
): GameEngine {
  return new GameEngine({
    dataSource: createStarterDataSource(host),
    createInputManager: options.createInputManager ?? (() => new BrowserInputManager()),
    frameScheduler: options.frameScheduler ?? new BrowserRafScheduler(),
    particleSystem: options.particleSystem,
    requestFrame: options.requestFrame,
    cancelFrame: options.cancelFrame
  });
}

export function createStarterDataSource(host?: GameRuntimeHost): GameEngineDataSource {
  return {
    loadGame: async (gameDirectory): Promise<LoadedGame> => {
      const controlState =
        typeof host?.loadControlState === 'function'
          ? await host.loadControlState()
          : null;

      return {
        gameDirectory,
        game: applyControlStateToGameFile(createStarterGameFile(), controlState)
      };
    },
    loadCamera: () => Promise.resolve(null)
  };
}

export function readStarterParticleAmount(game: GameContext): number {
  const particleAmount = game.gameState.globals[STARTER_PARTICLE_AMOUNT_KEY];
  if (typeof particleAmount !== 'number' || !Number.isFinite(particleAmount)) {
    return STARTER_PARTICLE_DEFAULT_AMOUNT;
  }

  return particleAmount;
}

export function emitStarterParticles(
  emitterThing: RuntimeThing,
  game: GameContext,
  randomValue: () => number = Math.random
): number {
  const nextEmission =
    readStarterParticleAmount(game) * STARTER_PARTICLE_EMISSION_RATE +
    readEmitterCarry(emitterThing);
  const particleCount = Math.floor(nextEmission);
  emitterThing.data = {
    emissionCarry: nextEmission - particleCount
  };

  for (let index = 0; index < particleCount; index += 1) {
    game.spawnParticle({
      position: {
        x: game.gameState.camera.x + randomValue() * game.gameState.screen.width,
        y: game.gameState.camera.y - 6 - randomValue() * 18
      },
      velocity: {
        x: (randomValue() - 0.5) * 0.5,
        y: 1.2 + randomValue() * 3.2
      },
      color: readStarterParticleColor(randomValue),
      size: 4 + randomValue() * 5
    });
  }

  return particleCount;
}

export function createStarterParticleEmitterBlueprint(
  randomValue: () => number = Math.random
): Blueprint {
  return {
    name: STARTER_PARTICLE_BLUEPRINT_NAME,
    width: 1,
    height: 1,
    color: STARTER_BACKGROUND_COLOR,
    shape: 'rectangle',
    update(thing, game) {
      emitStarterParticles(thing, game, randomValue);
    }
  };
}

export function createStarterGameFile(): GameFile {
  return {
    things: [
      {
        id: 'starter-particle-emitter',
        x: 0,
        y: 0,
        z: 0,
        angle: 0,
        width: 1,
        height: 1,
        velocityX: 0,
        velocityY: 0,
        blueprintName: STARTER_PARTICLE_BLUEPRINT_NAME,
        data: { emissionCarry: 0 }
      }
    ],
    blueprints: [createStarterParticleEmitterBlueprint()],
    camera: { x: 0, y: 0 },
    backgroundColor: STARTER_BACKGROUND_COLOR,
    globals: {
      [STARTER_PARTICLE_AMOUNT_KEY]: STARTER_PARTICLE_DEFAULT_AMOUNT
    },
    editor: {
      sliders: [STARTER_PARTICLE_AMOUNT_SLIDER]
    }
  };
}

function applyControlStateToGameFile(
  gameFile: GameFile,
  controlState: GameControlState | null
): GameFile {
  return {
    ...gameFile,
    globals: mergeGameGlobals(gameFile.globals, controlState)
  };
}

function createStarterRuntimeState(versionId: string, host?: GameRuntimeHost): { gameFile: GameFile } {
  const runtimeState = {
    gameFile: createStarterGameFile()
  };

  void createStarterDataSource(host)
    .loadGame(versionId)
    .then((loadedGame) => {
      runtimeState.gameFile = loadedGame.game;
    })
    .catch(() => undefined);

  return runtimeState;
}

function readStarterRuntimeSliders(gameFile: GameFile) {
  const editorSliders = parseGameEditorSliders(gameFile.editor?.sliders) ?? [];
  return resolveRuntimeSliders(gameFile.globals, editorSliders);
}

function serializeStarterControlState(gameFile: GameFile): GameControlState {
  if (!gameFile.globals || Object.keys(gameFile.globals).length === 0) {
    return {};
  }

  return {
    globals: {
      ...gameFile.globals
    }
  };
}

function setStarterRuntimeGlobalValue(
  gameFile: GameFile,
  globalKey: string,
  value: GameGlobalValue
): boolean {
  const globals = gameFile.globals ?? {};
  if (!(globalKey in globals)) {
    return false;
  }

  const editorSliders = parseGameEditorSliders(gameFile.editor?.sliders) ?? [];
  let nextValue = value;
  for (const slider of editorSliders) {
    if (slider.globalKey !== globalKey) {
      continue;
    }

    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return false;
    }

    nextValue = normalizeSliderValue(slider, value);
  }

  gameFile.globals = {
    ...globals,
    [globalKey]: nextValue
  };
  return true;
}

function readEmitterCarry(emitterThing: RuntimeThing): number {
  const emissionData =
    emitterThing.data && typeof emitterThing.data === 'object'
      ? emitterThing.data
      : null;
  const emissionCarry =
    emissionData && 'emissionCarry' in emissionData
      ? emissionData.emissionCarry
      : undefined;
  if (typeof emissionCarry !== 'number' || !Number.isFinite(emissionCarry)) {
    return 0;
  }

  return emissionCarry;
}

function readStarterParticleColor(randomValue: () => number): string {
  const colorIndex = Math.min(
    STARTER_PARTICLE_COLORS.length - 1,
    Math.floor(randomValue() * STARTER_PARTICLE_COLORS.length)
  );
  return STARTER_PARTICLE_COLORS[colorIndex] ?? STARTER_PARTICLE_COLORS[0];
}
