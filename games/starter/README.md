# Starter Game

This starter is split into a tiny runtime shell and a replaceable game module so new games can swap logic without rewriting the loop.
It is mobile-first and uses touch-only input.

## File map

- `src/main.ts` - Runtime orchestration (GL bootstrap, touch input/text assets/random setup, loop wiring, lifecycle cleanup).
- `src/runtime.ts` - Shared starter helpers: loop/time, touch input mapping, scene switching, random, collision, and text asset loading.
- `src/starterGame.ts` - Sample game module (config + WebGL setup + update/render logic).

## How to fork into a new game

1. Keep `src/main.ts` and `src/runtime.ts` as your runtime base.
2. Copy `src/starterGame.ts` to a new game module and replace:
   - shader sources
   - state shape
   - update/render logic
3. Update the exported config in your game module with your touch bindings and constants.
4. Switch `main.ts` to import your new module instead of `createStarterGame`.
5. Add new scenes with `createSceneMachine` (`menu`, `playing`, `pause`, `gameOver`) as needed.

## Starter touch controls

- Tap anywhere: toggle pause/play.
- Touch and hold left/right side: nudge horizontal velocity.
- Touch and hold top/bottom side: nudge vertical velocity.
