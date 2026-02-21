import { ParticleSpawnRequest, Vector } from './types';

export type ParticleView = {
  x: number;
  y: number;
  color: string;
  size: number;
};

export type ParticleSystem = {
  spawn: (request: ParticleSpawnRequest) => void;
  step: (camera: Vector, screen: { width: number; height: number }) => void;
  render: (draw: (particle: ParticleView) => void) => void;
  reset: () => void;
  getCount: () => number;
};

const DEFAULT_PARTICLE_CAPACITY = 256;
const DEFAULT_PARTICLE_SIZE = 6;

export function createParticleSystem(
  initialCapacity: number = DEFAULT_PARTICLE_CAPACITY
): ParticleSystem {
  let capacity = normalizeCapacity(initialCapacity);
  let count = 0;
  let positionsX = new Float32Array(capacity);
  let positionsY = new Float32Array(capacity);
  let velocitiesX = new Float32Array(capacity);
  let velocitiesY = new Float32Array(capacity);
  let sizes = new Float32Array(capacity);
  let colors = new Array<string>(capacity);

  function spawn(request: ParticleSpawnRequest): void {
    ensureCapacity(count + 1);
    const index = count;
    count += 1;

    positionsX[index] = request.position.x;
    positionsY[index] = request.position.y;
    velocitiesX[index] = request.velocity.x;
    velocitiesY[index] = request.velocity.y;
    sizes[index] = Math.max(1, request.size ?? DEFAULT_PARTICLE_SIZE);
    colors[index] = request.color;
  }

  function step(camera: Vector, screen: { width: number; height: number }): void {
    if (count === 0) {
      return;
    }

    const minX = camera.x;
    const minY = camera.y;
    const maxX = camera.x + screen.width;
    const maxY = camera.y + screen.height;

    let index = 0;
    while (index < count) {
      positionsX[index] = getNumericBufferValue(positionsX, index) + getNumericBufferValue(velocitiesX, index);
      positionsY[index] = getNumericBufferValue(positionsY, index) + getNumericBufferValue(velocitiesY, index);

      const size = getNumericBufferValue(sizes, index);
      const x = getNumericBufferValue(positionsX, index);
      const y = getNumericBufferValue(positionsY, index);

      const isOutside = x + size < minX || x >= maxX || y + size < minY || y >= maxY;
      if (isOutside) {
        removeAt(index);
        continue;
      }

      index += 1;
    }
  }

  function render(draw: (particle: ParticleView) => void): void {
    for (let index = 0; index < count; index += 1) {
      draw({
        x: getNumericBufferValue(positionsX, index),
        y: getNumericBufferValue(positionsY, index),
        color: colors[index] ?? '#ffffff',
        size: getNumericBufferValue(sizes, index)
      });
    }
  }

  function reset(): void {
    count = 0;
  }

  function getCount(): number {
    return count;
  }

  function ensureCapacity(required: number): void {
    if (required <= capacity) {
      return;
    }

    let nextCapacity = capacity;
    while (nextCapacity < required) {
      nextCapacity *= 2;
    }

    const nextPositionsX = new Float32Array(nextCapacity);
    nextPositionsX.set(positionsX);
    positionsX = nextPositionsX;

    const nextPositionsY = new Float32Array(nextCapacity);
    nextPositionsY.set(positionsY);
    positionsY = nextPositionsY;

    const nextVelocitiesX = new Float32Array(nextCapacity);
    nextVelocitiesX.set(velocitiesX);
    velocitiesX = nextVelocitiesX;

    const nextVelocitiesY = new Float32Array(nextCapacity);
    nextVelocitiesY.set(velocitiesY);
    velocitiesY = nextVelocitiesY;

    const nextSizes = new Float32Array(nextCapacity);
    nextSizes.set(sizes);
    sizes = nextSizes;

    const nextColors = new Array<string>(nextCapacity);
    for (let index = 0; index < count; index += 1) {
      nextColors[index] = colors[index] ?? '#ffffff';
    }
    colors = nextColors;

    capacity = nextCapacity;
  }

  function removeAt(index: number): void {
    const lastIndex = count - 1;
    if (index !== lastIndex) {
      positionsX[index] = getNumericBufferValue(positionsX, lastIndex);
      positionsY[index] = getNumericBufferValue(positionsY, lastIndex);
      velocitiesX[index] = getNumericBufferValue(velocitiesX, lastIndex);
      velocitiesY[index] = getNumericBufferValue(velocitiesY, lastIndex);
      sizes[index] = getNumericBufferValue(sizes, lastIndex);
      colors[index] = colors[lastIndex] ?? '#ffffff';
    }
    count = lastIndex;
  }

  return {
    spawn,
    step,
    render,
    reset,
    getCount
  };
}

function normalizeCapacity(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_PARTICLE_CAPACITY;
  }
  return Math.max(1, Math.floor(value));
}

function getNumericBufferValue(buffer: Float32Array, index: number): number {
  return buffer[index] ?? 0;
}
