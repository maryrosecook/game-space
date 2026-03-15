import { describe, expect, it } from 'vitest';

import { emitStarterParticles } from '../games/starter/src/main';
import type { GameContext, RuntimeThing } from '../games/starter/src/engine/types';
import { EMPTY_TOUCH_INPUT_FRAME } from '../games/starter/src/engine/types';

function createEmitterThing(): RuntimeThing {
  return {
    id: 'starter-particle-emitter',
    x: 0,
    y: 0,
    z: 0,
    angle: 0,
    width: 1,
    height: 1,
    velocityX: 0,
    velocityY: 0,
    blueprintName: 'starter-particle-emitter',
    physicsType: 'dynamic',
    color: '#020617',
    shape: 'rectangle',
    data: { emissionCarry: 0 }
  };
}

function createGameContext(particlesSetting: number, particles: Array<Record<string, unknown>>): GameContext {
  return {
    gameState: {
      things: [],
      blueprints: [],
      camera: { x: 0, y: 0 },
      screen: { width: 360, height: 640 },
      backgroundColor: '#020617',
      globals: { particles: particlesSetting }
    },
    collidingThingIds: new Map(),
    input: EMPTY_TOUCH_INPUT_FRAME,
    spawn() {
      return null;
    },
    spawnParticle(request) {
      particles.push(request);
    },
    destroy() {}
  };
}

function createRandomSequence(values: readonly number[]): () => number {
  let index = 0;
  return () => {
    const value = values[index % values.length];
    index += 1;
    return value ?? 0;
  };
}

describe('starter particle emitter', () => {
  it('spawns particles above the viewport using only the starter palette', () => {
    const particles: Array<Record<string, unknown>> = [];
    const emitterThing = createEmitterThing();
    const game = createGameContext(10, particles);

    const emittedCount = emitStarterParticles(
      emitterThing,
      game,
      createRandomSequence([0.1, 0.2, 0.3, 0.4, 0.5, 0.6])
    );

    expect(emittedCount).toBeGreaterThan(0);
    expect(particles).toHaveLength(emittedCount);
    expect(particles).toSatisfy((entries: Array<Record<string, unknown>>) => {
      return entries.every((entry) => {
        const position = entry.position as { x: number; y: number };
        const velocity = entry.velocity as { x: number; y: number };
        return (
          position.x >= 0 &&
          position.x <= 360 &&
          position.y < 0 &&
          velocity.y > 0 &&
          ['#FACC15', '#F97316', '#EF4444'].includes(String(entry.color))
        );
      });
    });
  });

  it('emits more particles when the particles setting increases', () => {
    const lowEmitter = createEmitterThing();
    const highEmitter = createEmitterThing();
    const lowParticles: Array<Record<string, unknown>> = [];
    const highParticles: Array<Record<string, unknown>> = [];
    const lowGame = createGameContext(1, lowParticles);
    const highGame = createGameContext(10, highParticles);
    const randomValues = createRandomSequence([0.2, 0.4, 0.6, 0.8, 0.1, 0.3]);

    let lowCount = 0;
    let highCount = 0;
    for (let tick = 0; tick < 20; tick += 1) {
      lowCount += emitStarterParticles(lowEmitter, lowGame, randomValues);
      highCount += emitStarterParticles(highEmitter, highGame, randomValues);
    }

    expect(highCount).toBeGreaterThan(lowCount);
    expect(highParticles.length).toBe(highCount);
    expect(lowParticles.length).toBe(lowCount);
  });
});
