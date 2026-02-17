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

## Build/output contract

- Keep `package.json` scripts compatible with the existing build pipeline.
- `npm run build` in this directory must output `dist/game.js`.
- Ensure `package.json` includes a `typecheck` script: `tsc --noEmit`.
- Ensure `typescript` is present in this game directory's `devDependencies`.
- Use the existing TypeScript/WebGL/browser setup already present in this game directory.

## Game design constraints

- Prioritize simple geometric visuals (circles, rectangles, lines).
- Target phone-first play in portrait orientation (`9:16`) as the primary layout.
- Keep controls and gameplay readable on small screens.

## Versioning constraints

- Preserve compatibility with older game versions by changing only this selected version directory.
- Update this version's `metadata.json` only when lineage/version semantics require it.

## Do not bother writing tests
