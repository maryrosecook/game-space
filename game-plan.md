# Game Plan

## Goal

Build a local web app for curating and evolving browser-game versions: the
homepage lists versions, users open one to play, and async Codex workers
produce new versions.

## UX

### Homepage (Game Picker)

- Render a grid of square tiles.
- Every square is a game version; show all versions in reverse chronological
  order (newest first).
- Tapping a tile opens that version.

### Game View

- Game renders in most of the screen.
- A single prompt box sits beneath the game.
- Prompting is async (submit, then review updates later).

## Runtime and Rendering

- V1 runs locally only (no local/remote sync layer).
- Game runtime is 100% client-side.
- Each game is served as a static bundle: `HTML + JS + minimal CSS`.
- Bundles are minified before serving.
- Start with WebGL rendering, even for simple circles/rectangles, so the move
  to custom shaders is easier later.
- Use npm-driven build/serve flow:
  - Root script `npm run build:games` iterates `/games/*` and runs each game's
    build via `npm run build --prefix`, outputting to
    `/public/games/<version-id>/`.
  - Root script `npm run serve:games` serves `/public/games/*` for gameplay.

## Generation and Evolution

- Product workflow is curator-first: mostly async submissions, not realtime
  interactive coding loops.
- User prompt -> backend enqueues a `change_request` job.
- Headless Codex worker edits code, runs checks, and writes commit/version
  metadata.
- LLM can also generate new versions in the background without interactive UI.
- UI surfaces job status and completed-version notifications asynchronously.

## Versioning and Isolation (V1 Default)

- Each game version lives in `/games/<version-id>/`.
- Metadata lives in each game directory (for example `metadata.json` with id,
  parent id, timestamps, framework/version).
- Each game directory has its own `package.json`.
- `node_modules` exists inside each game directory when that game is installed,
  run, or built.
- Dependencies install per game directory via npm prefix/scoped commands.
- Forking a game creates a new lineage by copying a game directory, then
  iterating independently.

## Initial Milestones

1. Build homepage game-picker grid (square tiles, all versions listed).
2. Build reverse-chron homepage feed behavior (newest version first).
3. Build game view (large playable area + single prompt box below).
4. Implement async Codex worker pipeline for prompt-driven changes.
5. Add static minified game bundling (`HTML/JS/CSS`) for client-side serving.
6. Implement per-game sandbox directories with isolated dependency/version
   control.
7. Add background LLM ideation + notifications for newly created versions.

## Success Criteria

- Users can browse all versions from the homepage and open any version to play.
- Prompt-to-new-version flow works asynchronously end to end.
- Games remain playable over time as static client-side bundles.
- Per-game dependency isolation prevents framework changes from breaking old
  games.
