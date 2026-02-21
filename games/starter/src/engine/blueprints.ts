import {
  Blueprint,
  DEFAULT_PHYSICS_TYPE,
  DEFAULT_THING_Z,
  RawThing,
  RuntimeThing,
  TriggerHandler,
  TriggerName,
  Vector
} from './types';

const FALLBACK_THING_SIZE = 32;

export function getBlueprintForThing(
  thing: RawThing,
  blueprintLookup: Map<string, Blueprint>
): Blueprint | undefined {
  return blueprintLookup.get(thing.blueprintName);
}

export function createThingFromBlueprint<TData = unknown>(
  blueprint: Blueprint<TData>,
  point: Vector,
  thing: Partial<RawThing<TData>> = {}
): RawThing<TData> {
  const width = getPositiveDimension(thing.width, blueprint.width);
  const height = getPositiveDimension(thing.height, blueprint.height);

  return {
    id: thing.id ?? createThingId(),
    x: thing.x ?? point.x - width / 2,
    y: thing.y ?? point.y - height / 2,
    z: thing.z ?? DEFAULT_THING_Z,
    angle: thing.angle ?? 0,
    width,
    height,
    velocityX: thing.velocityX ?? 0,
    velocityY: thing.velocityY ?? 0,
    blueprintName: thing.blueprintName ?? blueprint.name,
    physicsType: thing.physicsType ?? blueprint.physicsType ?? DEFAULT_PHYSICS_TYPE,
    data: thing.data
  };
}

export function sanitizeThingData(
  thing: RawThing,
  blueprintLookup: Map<string, Blueprint>
): RawThing {
  const blueprint = getBlueprintForThing(thing, blueprintLookup);

  const width = getPositiveDimension(thing.width, blueprint?.width);
  const height = getPositiveDimension(thing.height, blueprint?.height);
  const physicsType = thing.physicsType ?? blueprint?.physicsType ?? DEFAULT_PHYSICS_TYPE;

  if (thing.width === width && thing.height === height && thing.physicsType === physicsType) {
    return thing;
  }

  return {
    ...thing,
    width,
    height,
    physicsType
  };
}

export function createRuntimeThing(
  thing: RawThing,
  blueprintLookup: Map<string, Blueprint>
): RuntimeThing {
  const blueprint = getBlueprintForThing(thing, blueprintLookup);
  const width = getPositiveDimension(thing.width, blueprint?.width);
  const height = getPositiveDimension(thing.height, blueprint?.height);

  return {
    ...thing,
    z: thing.z,
    angle: thing.angle,
    width,
    height,
    velocityX: thing.velocityX,
    velocityY: thing.velocityY,
    color: blueprint?.color ?? '#9ca3af',
    shape: blueprint?.shape ?? 'rectangle',
    physicsType: thing.physicsType ?? blueprint?.physicsType ?? DEFAULT_PHYSICS_TYPE
  };
}

export function runtimeThingToRawThing(thing: RuntimeThing): RawThing {
  return {
    id: thing.id,
    x: thing.x,
    y: thing.y,
    z: thing.z,
    angle: thing.angle,
    width: thing.width,
    height: thing.height,
    velocityX: thing.velocityX,
    velocityY: thing.velocityY,
    blueprintName: thing.blueprintName,
    physicsType: thing.physicsType,
    data: thing.data
  };
}

export function runBlueprintHandlers<T extends TriggerName>(
  trigger: T,
  blueprint: Blueprint | undefined,
  blueprintHandler: TriggerHandler<T> | undefined,
  invoke: (handler: TriggerHandler<T>) => void
): boolean {
  if (!blueprintHandler) {
    return false;
  }

  try {
    invoke(blueprintHandler);
    return true;
  } catch (error) {
    console.warn(
      `Error running ${trigger} handler for blueprint "${blueprint?.name ?? 'unknown'}"`,
      error
    );
    return false;
  }
}

function getPositiveDimension(candidate: number | undefined, fallback: number | undefined): number {
  if (isPositiveFinite(candidate)) {
    return candidate;
  }
  if (isPositiveFinite(fallback)) {
    return fallback;
  }
  return FALLBACK_THING_SIZE;
}

function isPositiveFinite(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

let nextThingId = 0;

function createThingId(): string {
  nextThingId += 1;
  return `thing-${nextThingId}`;
}
