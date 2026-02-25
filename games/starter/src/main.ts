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
  RawThing,
  TouchPoint,
  Vector
} from './engine/types';

const PLAYER_ID = 'player-orb';
const TOUCH_DEAD_ZONE = 0.25;
const PLAYER_IMPULSE = 0.34;
const PLAYER_MAX_SPEED = 10;
const PLAYER_COLOR = '#191970';
const FIRE_COLOR_PALETTE = ['#ff2d00', '#ff4a00', '#ff6a00', '#ff8d00', '#ffb300', '#ffd24a'];

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
  const blueprints = createStarterBlueprints();

  const things: RawThing[] = [
    {
      id: PLAYER_ID,
      blueprintName: 'player-orb',
      x: 180,
      y: 120,
      z: 1,
      angle: 0,
      velocityX: 2.8,
      velocityY: 2.2
    }
  ];

  return {
    things,
    blueprints,
    camera: { x: 0, y: 0 },
    backgroundColor: '#020617'
  };
}

function createStarterBlueprints(): Blueprint[] {
  let rainState = 20260221;

  function nextRainRandom(): number {
    rainState = (rainState * 1664525 + 1013904223) >>> 0;
    return rainState / 0x100000000;
  }

  const playerOrb: Blueprint = {
    name: 'player-orb',
    width: 72,
    height: 72,
    color: PLAYER_COLOR,
    shape: 'circle',
    physicsType: 'dynamic',
    create: (thing, game) => {
      game.spawnParticle({
        position: centerOfThing(thing),
        velocity: { x: 0, y: -1.4 },
        color: '#22d3ee',
        size: 5
      });
    },
    input: (thing, game, input) => {
      const impulse = getTouchImpulse(input.touches);
      thing.velocityX = clampVelocity(thing.velocityX + impulse.x * PLAYER_IMPULSE);
      thing.velocityY = clampVelocity(thing.velocityY + impulse.y * PLAYER_IMPULSE);
    },
    update: (thing, game) => {
      spawnFireRain(game, nextRainRandom);

      thing.x += thing.velocityX;
      thing.y += thing.velocityY;

      bounceWithinViewport(thing, game.gameState.camera, game.gameState.screen);
    }
  };

  return [playerOrb];
}

function getTouchImpulse(touches: readonly TouchPoint[]): Vector {
  const left = hasTouchInZone(touches, (touch) => touch.normalizedX < -TOUCH_DEAD_ZONE);
  const right = hasTouchInZone(touches, (touch) => touch.normalizedX > TOUCH_DEAD_ZONE);
  const up = hasTouchInZone(touches, (touch) => touch.normalizedY < -TOUCH_DEAD_ZONE);
  const down = hasTouchInZone(touches, (touch) => touch.normalizedY > TOUCH_DEAD_ZONE);

  return {
    x: (right ? 1 : 0) - (left ? 1 : 0),
    y: (down ? 1 : 0) - (up ? 1 : 0)
  };
}

function hasTouchInZone(
  touches: readonly TouchPoint[],
  predicate: (touch: TouchPoint) => boolean
): boolean {
  for (const touch of touches) {
    if (predicate(touch)) {
      return true;
    }
  }
  return false;
}

function bounceWithinViewport(
  thing: RawThing,
  camera: Vector,
  screen: { width: number; height: number }
): void {
  const minX = camera.x;
  const maxX = camera.x + screen.width - (thing.width ?? 0);
  const minY = camera.y;
  const maxY = camera.y + screen.height - (thing.height ?? 0);

  if (thing.x < minX) {
    thing.x = minX;
    thing.velocityX = Math.abs(thing.velocityX);
  }
  if (thing.x > maxX) {
    thing.x = maxX;
    thing.velocityX = -Math.abs(thing.velocityX);
  }
  if (thing.y < minY) {
    thing.y = minY;
    thing.velocityY = Math.abs(thing.velocityY);
  }
  if (thing.y > maxY) {
    thing.y = maxY;
    thing.velocityY = -Math.abs(thing.velocityY);
  }
}

function spawnFireRain(
  game: Pick<GameContext, 'gameState' | 'spawnParticle'>,
  nextRandom: () => number
): void {
  const { camera, screen } = game.gameState;
  const spawnCount = nextRandom() > 0.68 ? 2 : 1;

  for (let index = 0; index < spawnCount; index += 1) {
    const spawnX = camera.x + nextRandom() * screen.width;
    const spawnY = camera.y - 3 - nextRandom() * 1.5;
    const driftX = (nextRandom() - 0.5) * 0.45;
    const fallVelocityY = 1.5 + nextRandom() * 2.1;
    const paletteIndex = Math.min(
      FIRE_COLOR_PALETTE.length - 1,
      Math.floor(nextRandom() * FIRE_COLOR_PALETTE.length)
    );
    const fireColor = FIRE_COLOR_PALETTE[paletteIndex] ?? FIRE_COLOR_PALETTE[0];

    game.spawnParticle({
      position: { x: spawnX, y: spawnY },
      velocity: { x: driftX, y: fallVelocityY },
      color: fireColor,
      size: 3
    });
  }
}

function centerOfThing(thing: { x: number; y: number; width: number; height: number }): Vector {
  return {
    x: thing.x + thing.width / 2,
    y: thing.y + thing.height / 2
  };
}

function clampVelocity(value: number): number {
  return Math.max(-PLAYER_MAX_SPEED, Math.min(PLAYER_MAX_SPEED, value));
}
