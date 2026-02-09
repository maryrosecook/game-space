# Project

Local-first game version browser and editor where every version is playable, forkable, and independently buildable.

Top three features:
- Filesystem-backed version catalog rendered as reverse-chronological homepage tiles.
- Per-version playable WebGL runtime with isolated dependency/build boundaries.
- Fork-first fire-and-forget prompt pipeline that executes `codex exec` in the new version directory.

# Repo structure

- `src/` - Backend app, HTML rendering, browser assets, and service modules.
  - `app.ts` - Express app factory and route wiring.
  - `server.ts` - HTTP server bootstrap.
  - `views.ts` - Homepage and game-page HTML rendering.
  - `types.ts` - Shared metadata/version TypeScript types.
  - `public/` - Static browser assets.
    - `styles.css` - Homepage/game-page styling and prompt-panel transitions.
    - `game-view.js` - Prompt-panel UI behavior and prompt POST submission.
  - `services/` - Filesystem, build, and prompt orchestration.
    - `fsUtils.ts` - Shared fs/object/error helpers.
    - `gameVersions.ts` - Version ID validation, metadata parsing, and version listing.
    - `forkGameVersion.ts` - Fork copy + lineage metadata creation.
    - `promptExecution.ts` - Build-prompt loading, prompt composition, and `codex` runner.
    - `gameBuildPipeline.ts` - Per-game dependency install/build and source-path-to-version mapping.
- `scripts/` - Local automation entrypoints.
  - `dev.ts` - Initial build, backend spawn, and debounced watch rebuild loop.
  - `build-games.ts` - One-shot build for all game directories.
- `games/` - Versioned game sandboxes (one runtime/build boundary per version).
  - `v1-bounce/` - Initial bouncing-ball WebGL game implementation.
- `docs/` - Project documentation.
  - `overview.md` - High-level architecture and operational summary.
- `factory/` - Factory recipe context and generated spec artifacts.
  - `spec-game-plan-v1.md` - Execution spec produced from `game-plan.md`.
- `tests/` - Vitest unit/integration coverage for app routes and core services.
- `game-plan.md` - Product requirements and milestones.
- `game-build-prompt.md` - Prompt prelude prepended to user prompt text before Codex execution.

# Most important code paths

- Homepage request flow: `src/app.ts` handles `GET /`, calls `listGameVersions()` (`src/services/gameVersions.ts`), and renders the three-column tile grid via `renderHomepage()` (`src/views.ts`).
- Game page flow: `src/app.ts` handles `GET /game/:versionId`, validates ID and existence, checks `dist/game.js`, then renders `renderGameView()` (`src/views.ts`), which boots `/games/<id>/dist/game.js`.
- Prompt fork flow: `src/public/game-view.js` submits `POST /api/games/:versionId/prompts`; `src/app.ts` validates input, forks via `createForkedGameVersion()`, composes prompt from `game-build-prompt.md` + user text, and fire-and-forget executes `codex exec -` via `SpawnCodexRunner`.
- Build/watch flow: `scripts/dev.ts` runs startup `buildAllGames()`, starts backend, watches `games/**/src/**`, extracts version IDs with `extractVersionIdFromSourcePath()`, and debounces per-version rebuilds with `buildGameDirectory()`.

# Data stores

- `games/` - Primary persisted store (no external database).
  - `<version-id>/`
    - `metadata.json` - `{ id: string, parentId: string | null, createdTime: ISO-8601 string }`.
    - `package.json` - Per-version dependency/build configuration.
    - `src/main.ts` - Version gameplay source.
    - `dist/game.js` - Built gameplay bundle served to clients.
    - `node_modules/` - Per-version installed dependencies.

# Architecture notes

- Execution isolation: each version owns its own source, dependencies, and built bundle under `games/<version-id>/`.
- Prompt safety model: user prompt text is never shell-interpolated; `SpawnCodexRunner` passes full prompt bytes through stdin to `codex exec -`.
- Fork semantics: forks copy source version files recursively while excluding `node_modules`, then overwrite `metadata.json` with new `{ id, parentId, createdTime }`.
- Serving model: Express serves `src/public/*` as shared assets and `games/*` as per-version runtime bundles.

# Testing

- Run lint: `npm run lint`
- Run type checking: `npm run typecheck`
- Run tests: `npm run test`
- Test coverage focus: route rendering/order, version metadata parsing/sorting, fork lineage/copy behavior, prompt composition, and build pipeline command sequencing.
- End-to-end/manual flow: run `npm run dev`, open `/`, verify reverse-chronological 3-column tiles, open `/game/v1-bounce`, verify bouncing circle + prompt panel open/close + prompt POST request to `/api/games/:versionId/prompts`.
