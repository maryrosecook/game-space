# Game Build Prompt

You are editing exactly one game version directory.

## Working directory scope (critical)

- Treat the current working directory (`pwd`) as the full project scope.
- Do not read, depend on, or modify files outside the current directory.
- Keep all edits inside this game version directory only.

## What this game runtime API expects

The host page will load and run your game with this fixed contract:

- It imports `startGame` from `/games/<version-id>/dist/game.js`.
- `startGame` must be exported and accept exactly one argument: an `HTMLCanvasElement`.
- The host provides a `<canvas id="game-canvas">` and calls `startGame(canvas)`.
- Your game must run fully client-side in the browser.
- Read `[pwd]/README.md` for details on engine behavior and extension points.
- Keep `[pwd]/README.md` section `## The Game` up to date with a terse high-level gameplay/input/visual summary whenever behavior changes.
- If a prompt includes an `[annotation_overlay_png_data_url]` image, it is a live game-canvas screenshot with yellow creator annotations.

### Engine API quick reference (terse)

- **Systems (`src/engine/engine.ts`)**
  - `GameEngine.initialize(canvas, gameVersionId)`: loads game + camera, builds runtime state, starts loop.
  - `GameEngine.destroy()`: stops loop and clears input/particles.
  - Tick order each frame: input → blueprint `input` handlers → blueprint `update` handlers → particles/physics → render.
- **Game objects (`src/engine/types.ts` + `src/engine/blueprints.ts`)**
  - `GameFile.things`: serialized object list (`x/y/z`, velocity, blueprint binding, color/shape overrides).
  - `GameFile.blueprints`: behavior + defaults (`create`, `input`, `update`, `shape`, `width/height`, `physicsType`).
  - `GameContext`: `gameState`, `spawnThing`, `removeThing`, `spawnParticle` for runtime mutation.
- **Particles (`src/engine/particles.ts`)**
  - Spawn via `game.spawnParticle({ position, velocity, color, size, lifetimeMs? })`.
  - Engine advances and expires particles every frame; renderer draws them after things.
- **Update/render loop (`src/engine/engine.ts` + `src/engine/render.ts`)**
  - Frame scheduler drives deterministic frame steps (browser RAF or headless scheduler).
  - `renderGame(...)` clears background, draws things sorted by `z`, then foreground particles.
- **Render functions (`src/engine/render.ts`)**
  - `GameRenderer.clear(color)`
  - `GameRenderer.drawRectangle(input)`
  - `GameRenderer.drawTriangle(input)`
  - `GameRenderer.drawCircle(input)`
  - Shape draw input: `{ x, y, width, height, angle, color, camera, screen }`.

## Headless validation constraints

- The headless runner always uses a fixed viewport of `360x640` at `dpr=1`.
- The headless runner always enforces `maxFrames=120` and `maxSnaps=1`.
- Validate you've achieved the prompt by running `npm run headless -- --json '<protocol-json>'`.
- Illustrative protocol JSON:

```json
{
  "steps": [
    { "run": 20 },
    { "snap": "validation_check" }
  ]
}
```

## Forbidden work

- You must not run linting commands.
- You must not write test files or test code.
- You must not run tests except the headless tests.
