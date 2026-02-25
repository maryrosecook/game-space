import {
  createRuntimeThing,
  createThingFromBlueprint,
  getBlueprintForThing,
  runBlueprintHandlers,
  runtimeThingToRawThing,
  sanitizeThingData
} from './blueprints';
import { BrowserRafScheduler, FrameScheduler } from './frameScheduler';
import { BrowserInputManager, StarterInputManager } from './input';
import { createParticleSystem, ParticleSystem } from './particles';
import { createNoopPhysicsAdapter, PhysicsAdapter } from './physics';
import { createWebGlRenderer, GameRenderer, renderGame } from './render';
import {
  Blueprint,
  CameraController,
  CollisionMap,
  DEFAULT_BACKGROUND_COLOR,
  DEFAULT_SCREEN_SIZE,
  EMPTY_TOUCH_INPUT_FRAME,
  GameContext,
  GameFile,
  ParticleSpawnRequest,
  RawGameState,
  RuntimeGameState,
  RuntimeThing,
  SpawnRequest,
} from './types';

export type LoadedGame = {
  game: GameFile;
  gameDirectory: string;
};

export type GameEngineDataSource = {
  loadGame: (gameDirectory: string) => Promise<LoadedGame>;
  loadCamera?: (gameDirectory: string) => Promise<CameraController | null>;
};

export type GameEngineDependencies = {
  dataSource: GameEngineDataSource;
  physicsAdapter?: PhysicsAdapter;
  createRenderer?: (gl: WebGLRenderingContext) => GameRenderer;
  createInputManager?: () => StarterInputManager;
  particleSystem?: ParticleSystem;
  frameScheduler?: FrameScheduler;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
};

function cloneDefaultRawGameState(): RawGameState {
  return {
    things: [],
    blueprints: [],
    camera: { x: 0, y: 0 },
    screen: { ...DEFAULT_SCREEN_SIZE },
    backgroundColor: DEFAULT_BACKGROUND_COLOR
  };
}

export class GameEngine {
  private canvas: HTMLCanvasElement | null = null;
  private gl: WebGLRenderingContext | null = null;
  private renderer: GameRenderer | null = null;
  private frameHandle: number | null = null;
  private resizeAttached = false;
  private readonly resizeListener = () => this.resizeCanvas();

  private readonly inputManager: StarterInputManager;
  private readonly physicsAdapter: PhysicsAdapter;
  private readonly particleSystem: ParticleSystem;
  private readonly requestFrame: (callback: FrameRequestCallback) => number;
  private readonly cancelFrame: (handle: number) => void;

  private gameDirectory = '';
  private ready = false;
  private cameraModule: CameraController | null = null;
  private inputFrame = EMPTY_TOUCH_INPUT_FRAME;

  private rawGameState: RawGameState = cloneDefaultRawGameState();
  private gameState: RuntimeGameState = {
    ...this.rawGameState,
    things: []
  };
  private blueprintLookup = new Map<string, Blueprint>();
  private createdThingIds = new Set<string>();

  constructor(private readonly dependencies: GameEngineDependencies) {
    this.inputManager = dependencies.createInputManager?.() ?? new BrowserInputManager();
    this.physicsAdapter = dependencies.physicsAdapter ?? createNoopPhysicsAdapter();
    this.particleSystem = dependencies.particleSystem ?? createParticleSystem();
    const frameScheduler = dependencies.frameScheduler ?? new BrowserRafScheduler();
    this.requestFrame =
      dependencies.requestFrame ??
      ((callback) => frameScheduler.requestFrame(callback));
    this.cancelFrame =
      dependencies.cancelFrame ??
      ((handle) => frameScheduler.cancelFrame(handle));
  }

  async initialize(canvas: HTMLCanvasElement, gameDirectory: string): Promise<void> {
    const isNewCanvas = this.canvas !== canvas;
    const isNewGame = this.gameDirectory !== gameDirectory;

    const gl = canvas.getContext('webgl');
    if (!gl) {
      throw new Error('WebGL is unavailable in this browser');
    }

    this.canvas = canvas;
    this.gl = gl;

    if (isNewCanvas || !this.renderer) {
      const createRenderer = this.dependencies.createRenderer ?? createWebGlRenderer;
      this.renderer = createRenderer(gl);
      this.inputManager.attach(canvas);
    }

    if (typeof window !== 'undefined' && !this.resizeAttached) {
      window.addEventListener('resize', this.resizeListener);
      this.resizeAttached = true;
    }

    this.resizeCanvas();

    if (isNewGame || !this.ready) {
      await this.loadGame(gameDirectory);
    }

    this.ready = true;
    this.startLoop();
  }

  async loadGame(gameDirectory: string): Promise<void> {
    const payload = await this.dependencies.dataSource.loadGame(gameDirectory);

    this.gameDirectory = payload.gameDirectory;
    this.createdThingIds.clear();
    this.particleSystem.reset();

    this.rawGameState = {
      things: payload.game.things.map((thing) => ({ ...thing })),
      blueprints: payload.game.blueprints.map((blueprint) => ({ ...blueprint })),
      camera: { ...payload.game.camera },
      screen: this.getCurrentScreenSize(),
      backgroundColor: payload.game.backgroundColor ?? DEFAULT_BACKGROUND_COLOR
    };

    this.cameraModule = await this.loadCamera(payload.gameDirectory);
    this.updateRuntimeState();
  }

  async loadCamera(gameDirectory: string): Promise<CameraController | null> {
    if (!this.dependencies.dataSource.loadCamera) {
      return null;
    }

    try {
      return await this.dependencies.dataSource.loadCamera(gameDirectory);
    } catch (error) {
      console.warn('Failed to load camera module', error);
      return null;
    }
  }

  startLoop(): void {
    if (this.frameHandle !== null) {
      return;
    }

    const step = () => {
      this.tick();
      this.frameHandle = this.requestFrame(step);
    };

    this.frameHandle = this.requestFrame(step);
  }

  stopLoop(): void {
    if (this.frameHandle === null) {
      return;
    }

    this.cancelFrame(this.frameHandle);
    this.frameHandle = null;
  }

  tick(): void {
    if (!this.ready || !this.renderer || !this.canvas) {
      return;
    }

    const pendingSpawns: RuntimeThing[] = [];
    const pendingRemovals = new Set<string>();
    const collidingThingIds: CollisionMap = new Map();

    const gameContext = this.createGameContext(collidingThingIds, pendingSpawns, pendingRemovals);

    this.runCreateHandlers(gameContext);
    this.physicsAdapter.step({
      gameState: this.gameState,
      blueprintLookup: this.blueprintLookup,
      game: gameContext
    });
    this.runInputHandlers(gameContext, pendingRemovals);
    this.runUpdateHandlers(gameContext, pendingRemovals);
    this.applyPendingChanges(pendingSpawns, pendingRemovals);
    this.runCreateHandlers(gameContext);
    this.updateCameraPosition();

    this.particleSystem.step(this.gameState.camera, this.gameState.screen);

    renderGame({
      renderer: this.renderer,
      gameState: this.gameState,
      blueprintLookup: this.blueprintLookup,
      particleSystem: this.particleSystem
    });

    this.rawGameState = {
      ...this.rawGameState,
      things: this.gameState.things.map((thing) => runtimeThingToRawThing(thing)),
      camera: { ...this.gameState.camera }
    };
  }

  runInputHandlers(game: GameContext, pendingRemovals: Set<string>): void {
    if (!this.canvas) {
      return;
    }

    this.inputFrame = this.inputManager.consumeFrame(this.canvas);

    for (const thing of this.gameState.things) {
      if (pendingRemovals.has(thing.id)) {
        continue;
      }

      const blueprint = getBlueprintForThing(thing, this.blueprintLookup);
      runBlueprintHandlers('input', blueprint, blueprint?.input, (handler) => {
        handler(thing, game, this.inputFrame);
      });
    }
  }

  runUpdateHandlers(game: GameContext, pendingRemovals: Set<string>): void {
    const thingsView = [...this.gameState.things];
    for (const thing of thingsView) {
      if (pendingRemovals.has(thing.id)) {
        continue;
      }

      const blueprint = getBlueprintForThing(thing, this.blueprintLookup);
      runBlueprintHandlers('update', blueprint, blueprint?.update, (handler) => {
        handler(thing, game, this.inputFrame);
      });
    }
  }

  resizeCanvas(): void {
    if (!this.canvas || !this.gl) {
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    const cssWidth = Math.max(1, Math.round(rect.width || this.canvas.clientWidth || 1));
    const cssHeight = Math.max(1, Math.round(rect.height || this.canvas.clientHeight || 1));
    const scale = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;

    const pixelWidth = Math.max(1, Math.round(cssWidth * scale));
    const pixelHeight = Math.max(1, Math.round(cssHeight * scale));

    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }

    this.gl.viewport(0, 0, pixelWidth, pixelHeight);

    const nextScreen = { width: cssWidth, height: cssHeight };
    const currentScreen = this.gameState.screen;
    if (nextScreen.width !== currentScreen.width || nextScreen.height !== currentScreen.height) {
      this.rawGameState = {
        ...this.rawGameState,
        screen: nextScreen
      };
      this.gameState = {
        ...this.gameState,
        screen: nextScreen
      };
    }

    this.renderer?.resize(nextScreen);
  }

  runCreateHandlers(game: GameContext): void {
    for (const thing of this.gameState.things) {
      if (this.createdThingIds.has(thing.id)) {
        continue;
      }

      const blueprint = getBlueprintForThing(thing, this.blueprintLookup);
      runBlueprintHandlers('create', blueprint, blueprint?.create, (handler) => {
        handler(thing, game);
      });
      this.createdThingIds.add(thing.id);
    }
  }

  updateCameraPosition(): void {
    if (!this.cameraModule) {
      return;
    }

    const nextCamera = this.cameraModule.update(this.gameState);
    const current = this.gameState.camera;
    if (nextCamera.x === current.x && nextCamera.y === current.y) {
      return;
    }

    const camera = { x: nextCamera.x, y: nextCamera.y };
    this.gameState = {
      ...this.gameState,
      camera
    };
    this.rawGameState = {
      ...this.rawGameState,
      camera
    };
  }

  updateRuntimeState(): void {
    this.blueprintLookup = new Map(
      this.rawGameState.blueprints.map((blueprint) => [blueprint.name, blueprint])
    );

    const sanitizedThings = this.rawGameState.things.map((thing) => {
      const withDefaults = {
        ...thing,
        z: thing.z,
        angle: thing.angle,
        velocityX: thing.velocityX,
        velocityY: thing.velocityY
      };
      return sanitizeThingData(withDefaults, this.blueprintLookup);
    });

    this.rawGameState = {
      ...this.rawGameState,
      things: sanitizedThings
    };

    const runtimeThings = sanitizedThings.map((thing) => createRuntimeThing(thing, this.blueprintLookup));
    this.gameState = {
      ...this.rawGameState,
      things: runtimeThings
    };

    const runtimeIds = new Set(runtimeThings.map((thing) => thing.id));
    for (const createdThingId of [...this.createdThingIds]) {
      if (!runtimeIds.has(createdThingId)) {
        this.createdThingIds.delete(createdThingId);
      }
    }
  }

  getGameState(): RuntimeGameState {
    return this.gameState;
  }

  getBlueprint(name: string): Blueprint | undefined {
    return this.blueprintLookup.get(name);
  }

  destroy(): void {
    this.stopLoop();

    if (typeof window !== 'undefined' && this.resizeAttached) {
      window.removeEventListener('resize', this.resizeListener);
      this.resizeAttached = false;
    }

    this.inputManager.detach();

    this.canvas = null;
    this.gl = null;
    this.renderer = null;
    this.gameDirectory = '';
    this.ready = false;
    this.cameraModule = null;
    this.inputFrame = EMPTY_TOUCH_INPUT_FRAME;
    this.rawGameState = cloneDefaultRawGameState();
    this.gameState = { ...this.rawGameState, things: [] };
    this.blueprintLookup.clear();
    this.createdThingIds.clear();
    this.particleSystem.reset();
  }

  private createGameContext(
    collidingThingIds: CollisionMap,
    pendingSpawns: RuntimeThing[],
    pendingRemovals: Set<string>
  ): GameContext {
    const gameStateProvider = () => this.gameState;
    const inputProvider = () => this.inputFrame;
    const spawnThing = (request: SpawnRequest) => this.spawnFromRequest(request, pendingSpawns);
    const spawnParticle = (request: ParticleSpawnRequest) => {
      this.particleSystem.spawn(request);
    };

    return {
      get gameState() {
        return gameStateProvider();
      },
      get collidingThingIds() {
        return collidingThingIds;
      },
      get input() {
        return inputProvider();
      },
      spawn(request: SpawnRequest): RuntimeThing | null {
        return spawnThing(request);
      },
      spawnParticle(request: ParticleSpawnRequest): void {
        spawnParticle(request);
      },
      destroy(target: RuntimeThing | string): void {
        const id = typeof target === 'string' ? target : target.id;
        pendingRemovals.add(id);
      }
    };
  }

  private spawnFromRequest(request: SpawnRequest, pendingSpawns: RuntimeThing[]): RuntimeThing | null {
    const blueprint = this.resolveBlueprintForSpawn(request.blueprint);
    if (!blueprint) {
      return null;
    }

    const rawThing = createThingFromBlueprint(blueprint, request.position, request.overrides);
    const runtimeThing = createRuntimeThing(rawThing, this.blueprintLookup);
    pendingSpawns.push(runtimeThing);
    return runtimeThing;
  }

  private resolveBlueprintForSpawn(blueprint: SpawnRequest['blueprint']): Blueprint | null {
    if (typeof blueprint !== 'string') {
      return blueprint;
    }
    return this.blueprintLookup.get(blueprint) ?? null;
  }

  private applyPendingChanges(pendingSpawns: RuntimeThing[], pendingRemovals: Set<string>): void {
    if (pendingSpawns.length === 0 && pendingRemovals.size === 0) {
      return;
    }

    const survivors = this.gameState.things.filter((thing) => !pendingRemovals.has(thing.id));
    const things = [...survivors, ...pendingSpawns];

    this.gameState = {
      ...this.gameState,
      things
    };

    for (const removedThingId of pendingRemovals) {
      this.createdThingIds.delete(removedThingId);
    }
  }

  private getCurrentScreenSize(): { width: number; height: number } {
    if (!this.canvas) {
      return this.rawGameState.screen;
    }

    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || this.canvas.clientWidth || 1));
    const height = Math.max(1, Math.round(rect.height || this.canvas.clientHeight || 1));
    return { width, height };
  }
}
