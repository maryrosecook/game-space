import {
  GameEngine,
  GameEngineDependencies,
  GameEngineDataSource,
  LoadedGame
} from './engine/engine';
import { BrowserRafScheduler } from './engine/frameScheduler';
import { BrowserInputManager } from './engine/input';
import { GameFile } from './engine/types';

let activeEngine: GameEngine | null = null;

export function startGame(canvas: HTMLCanvasElement): void {
  if (activeEngine) {
    activeEngine.destroy();
    activeEngine = null;
  }

  const engine = createStarterEngine();
  activeEngine = engine;

  void engine.initialize(canvas, 'starter').catch((error) => {
    console.error('Failed to initialize starter game engine', error);
    engine.destroy();
    if (activeEngine === engine) {
      activeEngine = null;
    }
  });

  window.addEventListener(
    'pagehide',
    () => {
      engine.destroy();
      if (activeEngine === engine) {
        activeEngine = null;
      }
    },
    { once: true }
  );
}

export type StarterEngineOptions = Pick<
  GameEngineDependencies,
  'createInputManager' | 'frameScheduler' | 'requestFrame' | 'cancelFrame'
>;

export function createStarterEngine(options: StarterEngineOptions = {}): GameEngine {
  return new GameEngine({
    dataSource: createStarterDataSource(),
    createInputManager: options.createInputManager ?? (() => new BrowserInputManager()),
    frameScheduler: options.frameScheduler ?? new BrowserRafScheduler(),
    requestFrame: options.requestFrame,
    cancelFrame: options.cancelFrame
  });
}

export function createStarterDataSource(): GameEngineDataSource {
  return {
    loadGame: async (gameDirectory): Promise<LoadedGame> => {
      return {
        gameDirectory,
        game: createStarterGameFile()
      };
    },
    loadCamera: async () => null
  };
}

function createStarterGameFile(): GameFile {
  return {
    things: [],
    blueprints: [],
    camera: { x: 0, y: 0 },
    backgroundColor: '#020617'
  };
}
