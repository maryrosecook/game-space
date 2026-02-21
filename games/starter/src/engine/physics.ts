import { Blueprint, GameContext, RuntimeGameState } from './types';

export type PhysicsStepParams = {
  gameState: RuntimeGameState;
  blueprintLookup: Map<string, Blueprint>;
  game: GameContext;
};

export type PhysicsAdapter = {
  step: (params: PhysicsStepParams) => void;
  supportsPhysicsType?: (physicsType: string) => boolean;
};

// Placeholder physics adapter. It intentionally does not simulate collisions yet.
export function createNoopPhysicsAdapter(): PhysicsAdapter {
  return {
    step: ({ game }) => {
      game.collidingThingIds.clear();
    },
    supportsPhysicsType: () => true
  };
}
