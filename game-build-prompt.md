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
- Read `[pwd]/README.md` for more details on the available game engine API.
- The headless runner always uses a fixed viewport of `360x640` at `dpr=1`.
- The headless runner always enforces `maxFrames=120` and `maxSnaps=1`.
- Validate you've achieved the prompt by running the game headless with `npm run headless -- --json '<protocol-json>'`.
- After implementing generation completion behavior, run the e2e assertion that a just-finished generation records a tile image: `npm run test:e2e -- tests/e2e/homepage.spec.ts --grep "just finished generating"`.
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
