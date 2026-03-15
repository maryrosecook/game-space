# Starter Game

## The Game

This starter ships with a minimal engine core that mirrors key game-framework runtime concepts (engine loop, blueprints, touch input, particles, render, and camera) without editor/GUI tooling.
The default scene now includes a hidden particle emitter and one runtime settings slider.
It renders a falling yellow/orange/red particle field over the background color so the settings pipeline has a visible default behavior.

## Scope and flexibility

It is explicitly fine to change anything in this starter to meet your game implementation goals:
- `src/main.ts`
- any file in `src/engine/*`
- supporting config, assets, and runtime wiring

Treat the current structure as a strong starting point, not a constraint.

## Build output (`dist/`)

`dist/` is generated build output.
Do not edit files in `dist/` directly; make changes in `src/` and rebuild.
Keep `dist/` gitignored.

## File map

- `src/main.ts` - Starter game bootstrap and sample game data source/camera wiring.
- `src/engine/engine.ts` - `GameEngine` lifecycle (`initialize`, `loadGame`, `loadCamera`, loop/tick phases, camera/runtime updates).
- `src/engine/input.ts` - Paired input adapters (`BrowserInputManager` and `HeadlessInputManager`) that share a touch-frame output model.
- `src/engine/frameScheduler.ts` - Paired frame scheduler adapters (`BrowserRafScheduler` and deterministic `HeadlessFrameScheduler`).
- `src/engine/blueprints.ts` - Blueprint lookup, thing creation, runtime normalization, trigger handler execution.
- `src/engine/particles.ts` - Lightweight particle storage and stepping.
- `src/engine/physics.ts` - Pluggable no-op physics adapter hooks for future collision/physics engines.
- `src/engine/render.ts` - WebGL render skeleton with shader-drawn rectangle/circle/triangle primitives.
- `src/engine/types.ts` - Shared engine runtime types.
- `src/headless/*` - Headless protocol validator, deterministic action executor, Playwright runner, and CLI entrypoint.

## Engine API quick reference

- `createStarterGameFile()` in `src/main.ts` is the default scene contract: one particle-emitter thing/blueprint, camera `{ x: 0, y: 0 }`, background color, `globals`, and `editor.sliders`.
- Runtime settings live in top-level `globals` and are surfaced through `editor.sliders`.
- Every `editor.sliders` entry includes `gameDevRequested` so explicitly requested tunables stay identifiable across future prompts.
- Add visible actors by adding things (and matching blueprints) to `createStarterGameFile()`.
- Blueprint handlers are `create(thing, game)`, `input(thing, game, input)`, `update(thing, game, input)`, and `collision(thing, otherThing, game)`.
- Runtime helpers on `game`: `spawn({ blueprint, position, overrides? })`, `spawnParticle({ position, velocity, color, size? })`, and `destroy(thingOrId)`.

## How to fork into a new game

1. Keep `src/engine/*` as the runtime base.
2. In `src/main.ts`, replace `createStarterGameFile()` blueprints/things/globals and `createStarterDataSource()` camera logic.
3. Add or modify blueprint `create`/`input`/`update` handlers for your game loop behavior.
4. If you need real collisions or physics, replace `createNoopPhysicsAdapter()` with your own adapter in `engine.ts` dependencies.
5. Keep touch controls in blueprint input handlers to stay mobile-first.

## Headless debugging scripts

- Protocol is steps-only. The runtime always uses `360x640` (`dpr=1`) with hard limits `maxFrames=120` and `maxSnaps=1`.
- Install Chromium + Linux deps for headless runs:
  - `npm run headless:install`
- Run the fixed smoke scenario (bounded frames + one PNG capture):
  - `npm run headless:smoke`
- Run a custom protocol by piping JSON directly:
  - `cat /path/to/protocol.json | npm run headless`
- Run a custom protocol from an inline JSON string:
  - `npm run headless -- --json '{"steps":[{"run":5},{"snap":"quick_check"}]}'`
- Run a custom protocol file:
  - `npm run headless:run -- --script /absolute/or/relative/path/to/protocol.json`

Smoke and custom runs write PNG captures and JSON summary output under `snapshots/<timestamp>/`.
