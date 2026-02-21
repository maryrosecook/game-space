export type Vector = {
  x: number;
  y: number;
};

export type Shape = 'rectangle' | 'triangle' | 'circle';

// Physics types remain open-ended so a future adapter can support any schema.
export type PhysicsType = string;

export type CollisionMap = Map<string, string[]>;

export type TouchPoint = {
  id: number;
  clientX: number;
  clientY: number;
  normalizedX: number;
  normalizedY: number;
};

export type TouchInputFrame = {
  touches: readonly TouchPoint[];
  tapCount: number;
};

export const EMPTY_TOUCH_INPUT_FRAME: TouchInputFrame = {
  touches: [],
  tapCount: 0
};

export type RawThing<TData = unknown> = {
  id: string;
  x: number;
  y: number;
  z: number;
  angle: number;
  width?: number;
  height?: number;
  velocityX: number;
  velocityY: number;
  blueprintName: string;
  physicsType?: PhysicsType;
  data?: TData;
};

export type RuntimeThing<TData = unknown> = RawThing<TData> & {
  width: number;
  height: number;
  color: string;
  shape: Shape;
  physicsType: PhysicsType;
};

export type TriggerName = 'create' | 'input' | 'update' | 'collision';

export type SpawnRequest = {
  blueprint: string | Blueprint;
  position: Vector;
  overrides?: Partial<RawThing>;
};

export type ParticleSpawnRequest = {
  position: Vector;
  velocity: Vector;
  color: string;
  size?: number;
};

export type RawGameState = {
  things: RawThing[];
  blueprints: Blueprint[];
  camera: Vector;
  screen: { width: number; height: number };
  backgroundColor: string;
};

export type RuntimeGameState = Omit<RawGameState, 'things'> & {
  things: RuntimeThing[];
};

export type GameContext = {
  readonly gameState: RuntimeGameState;
  readonly collidingThingIds: CollisionMap;
  readonly input: TouchInputFrame;
  spawn: (request: SpawnRequest) => RuntimeThing | null;
  spawnParticle: (request: ParticleSpawnRequest) => void;
  destroy: (target: RuntimeThing | string) => void;
};

export type CreateHandler<TData = unknown> = (thing: RuntimeThing<TData>, game: GameContext) => void;

export type InputHandler<TData = unknown> = (
  thing: RuntimeThing<TData>,
  game: GameContext,
  input: TouchInputFrame
) => void;

export type UpdateHandler<TData = unknown> = (
  thing: RuntimeThing<TData>,
  game: GameContext,
  input: TouchInputFrame
) => void;

export type CollisionHandler<TData = unknown> = (
  thing: RuntimeThing<TData>,
  otherThing: RuntimeThing,
  game: GameContext
) => void;

export type Blueprint<TData = unknown> = {
  name: string;
  width: number;
  height: number;
  color: string;
  shape: Shape;
  physicsType?: PhysicsType;
  create?: CreateHandler<TData>;
  input?: InputHandler<TData>;
  update?: UpdateHandler<TData>;
  collision?: CollisionHandler<TData>;
};

export type TriggerHandlerMap<TData = unknown> = {
  create: CreateHandler<TData>;
  input: InputHandler<TData>;
  update: UpdateHandler<TData>;
  collision: CollisionHandler<TData>;
};

export type TriggerHandler<T extends TriggerName> = TriggerHandlerMap[T];

export type CameraController = {
  update: (game: RuntimeGameState) => Vector;
};

export type GameFile = {
  things: RawThing[];
  blueprints: Blueprint[];
  camera: Vector;
  backgroundColor?: string;
};

export const DEFAULT_SCREEN_SIZE = {
  width: 1,
  height: 1
};

export const DEFAULT_BACKGROUND_COLOR = '#0f172a';

export const DEFAULT_THING_Z = 1;

export const DEFAULT_PHYSICS_TYPE: PhysicsType = 'dynamic';
