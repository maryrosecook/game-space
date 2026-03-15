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
- Engine API quick reference:
  - `createStarterGameFile()` in `src/main.ts` defines the initial `things`, `blueprints`, `camera`, and `backgroundColor`.
  - Blueprints can implement `create`, `input`, `update`, and `collision` handlers.
  - Handler signatures use `(thing, game, input?)` where `input` is present for `input`/`update`.
  - `game.spawn({ blueprint, position, overrides? })` creates a new thing from a blueprint.
  - `game.spawnParticle({ position, velocity, color, size? })` emits particles.
  - `game.destroy(thingOrId)` removes a thing.
- Read `[pwd]/README.md` for more details on the available game engine API.
- When you implement a prompt, add appropriate editable top-level `globals` for meaningful gameplay or visual elements.
- Expose those tunables through `editor.sliders`; never define more than 7 settings total.
- Only include settings for meaningful gameplay or visual elements, not incidental internals.
- If the game dev explicitly asks for a tunable, include it when it still fits the current game shape.
- Saved runtime settings live at `[game-dir]/control-state.json`.
- Every slider config entry must include `id`, `label`, `min`, `max`, `step`, `globalKey`, and `gameDevRequested`.
- Set `gameDevRequested: true` for settings explicitly requested by the game dev; otherwise use `false`.
- Only remove `gameDevRequested: true` settings when they clearly aren't relevant any more.
- If a prompt includes an `[annotation_overlay_png_data_url]` image, that image is a screenshot captured from the live game canvas at prompt time.
- Any yellow drawings visible on that screenshot are creator annotations highlighting what they are describing in the spoken or typed prompt.
- The headless runner always uses a fixed viewport of `360x640` at `dpr=1`.
- The headless runner always enforces `maxFrames=120` and `maxSnaps=1`.
- Validate you've achieved the prompt by running the game headless with `npm run headless -- --json '<protocol-json>'`.
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
