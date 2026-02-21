# Starter Game

This starter now ships with a minimal engine core that mirrors key game-framework runtime concepts (engine loop, blueprints, touch input, particles, render, and camera) without editor/GUI tooling.
The default scene is a single night-blue bouncing ball with foreground fire-colored rain particles.
It is mobile-first and uses touch-only input.

## Scope and flexibility

It is explicitly fine to change anything in this starter to meet your game implementation goals:
- `src/main.ts`
- any file in `src/engine/*`
- supporting config, assets, and runtime wiring

Treat the current structure as a strong starting point, not a constraint.

## File map

- `src/main.ts` - Starter game bootstrap and sample game data source/camera wiring.
- `src/engine/engine.ts` - `GameEngine` lifecycle (`initialize`, `loadGame`, `loadCamera`, loop/tick phases, camera/runtime updates).
- `src/engine/input.ts` - Touch-only pointer input manager.
- `src/engine/blueprints.ts` - Blueprint lookup, thing creation, runtime normalization, trigger handler execution.
- `src/engine/particles.ts` - Lightweight particle storage and stepping.
- `src/engine/physics.ts` - Pluggable no-op physics adapter hooks for future collision/physics engines.
- `src/engine/render.ts` - WebGL render skeleton with shader-drawn rectangle/circle/triangle primitives.
- `src/engine/types.ts` - Shared engine runtime types.

## How to fork into a new game

1. Keep `src/engine/*` as the runtime base.
2. In `src/main.ts`, replace `createStarterGameFile()` blueprints/things and `createStarterDataSource()` camera logic.
3. Add or modify blueprint `create`/`input`/`update` handlers for your game loop behavior.
4. If you need real collisions or physics, replace `createNoopPhysicsAdapter()` with your own adapter in `engine.ts` dependencies.
5. Keep touch controls in blueprint input handlers to stay mobile-first.

## Starter touch controls

- Touch and hold left/right side: nudge horizontal velocity.
- Touch and hold top/bottom side: nudge vertical velocity.
