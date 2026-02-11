# Project

Local-first game version browser and editor where every version is playable, forkable, and independently buildable.

Top three features:
- Filesystem-backed version catalog rendered as reverse-chronological homepage tiles, with each version opening into a playable centered portrait (`9:16`) WebGL runtime.
- Fork-first fire-and-forget prompt pipeline that executes `codex exec` in a new version directory named with a human-readable three-word ID, then stores the emitted Codex session ID in version metadata as soon as it becomes available.
- `/codex` transcript browser that lets you select a game version and inspect user/assistant turns parsed from the linked Codex JSONL session.

# Repo structure

- `src/` - Backend app, HTML rendering, browser assets, and service modules.
  - `app.ts` - Express app factory and route wiring.
  - `server.ts` - HTTP server bootstrap.
  - `views.ts` - Homepage, game-page, and `/codex` page HTML rendering.
  - `types.ts` - Shared metadata/version TypeScript types.
  - `public/` - Static browser assets.
    - `styles.css` - Homepage/game-page styling, prompt-panel transitions, and `/codex` transcript layout styles.
    - `game-view.js` - Prompt-panel UI behavior and prompt POST submission.
    - `game-live-reload.js` - Dev-only game-page polling that reloads the browser when a rebuild token changes.
    - `codex-view.js` - `/codex` selector wiring and transcript rendering.
  - `services/` - Filesystem, build, prompt, and Codex-session orchestration.
    - `fsUtils.ts` - Shared fs/object/error helpers.
    - `gameVersions.ts` - Version ID validation, metadata parsing/writing, and version listing.
    - `forkGameVersion.ts` - Fork copy + lineage metadata creation.
    - `promptExecution.ts` - Build-prompt loading, prompt composition, and `codex exec --json` runner with backward-compatible session ID capture (`thread.started.thread_id` and legacy `session_meta.payload.id`).
    - `codexSessions.ts` - Codex session-file lookup and JSONL transcript parsing (user/assistant turns only).
    - `gameBuildPipeline.ts` - Per-game dependency install/build and source-path-to-version mapping.
    - `devLiveReload.ts` - Per-version reload-token pathing/writes used by the dev watch loop.
- `scripts/` - Local automation entrypoints.
  - `dev.ts` - Initial build, per-version reload-token seeding, backend spawn with dev live-reload flag, and debounced watch rebuild loop.
  - `build-games.ts` - One-shot build for all game directories.
- `games/` - Versioned game sandboxes (one runtime/build boundary per version).
  - `v1-bounce/` - Initial bouncing-ball WebGL game implementation.
  - `d0cf7658-3371-4f01-99e2-ca90fc1899cf/` - Forked bouncing-ball WebGL variant used as an intermediate lineage node.
  - `elm-cloud-sage/` - Latest fork rendering 1000 animated shimmering bowls via a point-sprite WebGL shader with iridescent/specular highlights.
- `docs/` - Project documentation.
  - `overview.md` - High-level architecture and operational summary.
- `tests/` - Vitest unit/integration coverage for app routes and core services.
- `game-plan.md` - Product requirements and milestones.
- `game-build-prompt.md` - Prompt prelude prepended to user prompt text before Codex execution.

# Most important code paths

- Homepage request flow: `src/app.ts` handles `GET /`, calls `listGameVersions()` (`src/services/gameVersions.ts`), and renders the three-column tile grid via `renderHomepage()` (`src/views.ts`).
- Game page flow: `src/app.ts` handles `GET /game/:versionId`, validates ID and existence, checks `dist/game.js`, then renders `renderGameView()` (`src/views.ts`) with a centered `9:16` `.game-render-area`; when `GAME_SPACE_DEV_LIVE_RELOAD=1`, the page also loads `src/public/game-live-reload.js` to watch that version’s rebuild token and refresh automatically after successful rebuilds; game code (for example `games/v1-bounce/src/main.ts` and `games/elm-cloud-sage/src/main.ts`) sizes the canvas buffer from the rendered element dimensions and applies viewport-aspect compensation in movement bounds so circles remain circular in portrait and landscape viewports.
- Prompt fork flow: `src/public/game-view.js` submits `POST /api/games/:versionId/prompts` and, on accepted responses with a valid `forkId`, immediately navigates to `/game/<forkId>`; `src/app.ts` validates input, forks via `createForkedGameVersion()`, composes prompt from `game-build-prompt.md` + user text, and fire-and-forget executes `codex exec --json --dangerously-bypass-approvals-and-sandbox -` via `SpawnCodexRunner`; emitted session IDs are persisted immediately through a runner callback (with completion-time fallback) so `codexSessionId` is available before long-running executions finish.
- Codex transcript flow: `src/app.ts` serves `GET /codex` via `renderCodexView()` and `src/public/codex-view.js`; selecting a game requests `GET /api/codex-sessions/:versionId`, which reads metadata/session ID (`src/services/gameVersions.ts`), locates JSONL (`src/services/codexSessions.ts`), and returns parsed user/assistant messages.
- Build/watch flow: `scripts/dev.ts` runs startup `buildAllGames()`, writes initial `dist/reload-token.txt` files for each version, starts backend with `GAME_SPACE_DEV_LIVE_RELOAD=1`, watches `games/**/src/**`, extracts version IDs with `extractVersionIdFromSourcePath()`, debounces per-version rebuilds with `buildGameDirectory()`, and rewrites that version’s token after each successful rebuild.

# Data stores

- `games/` - Primary persisted store (no external database).
  - `<version-id>/`
    - `metadata.json` - `{ id: string, parentId: string | null, createdTime: ISO-8601 string, codexSessionId?: string | null }`.
    - `package.json` - Per-version dependency/build configuration.
    - `src/main.ts` - Version gameplay source.
    - `dist/game.js` - Built gameplay bundle served to clients.
    - `dist/reload-token.txt` - Dev-only rebuild token polled by game pages for automatic refresh during `npm run dev`.
    - `node_modules/` - Per-version installed dependencies.
- `~/.codex/sessions/` - External local Codex store used for transcript lookup.
  - `YYYY/MM/DD/rollout-...-<session-id>.jsonl` - Session event log parsed for `user` and `assistant` message text.

# Architecture notes

- Execution isolation: each version owns its own source, dependencies, and built bundle under `games/<version-id>/`.
- Prompt safety model: user prompt text is never shell-interpolated; `SpawnCodexRunner` passes full prompt bytes through stdin to `codex exec --json --dangerously-bypass-approvals-and-sandbox -`.
- Render surface model: the game page centers a portrait (`9:16`) render area and scales it to fill whichever viewport dimension is limiting.
- Dev live-reload model: `scripts/dev.ts` rewrites per-version `dist/reload-token.txt` values after successful builds and enables game-page polling via `GAME_SPACE_DEV_LIVE_RELOAD=1`; browser reload triggers on token changes only.
- Fork semantics: forks copy source version files recursively while excluding `node_modules`, then overwrite `metadata.json` with new `{ id, parentId, createdTime, codexSessionId: null }`; default IDs are random dictionary-backed three-word slugs.
- Codex session linkage: version metadata stores the session ID (`codexSessionId`) so `/codex` can resolve the matching JSONL without guessing by timestamp; session IDs are saved as soon as the runner observes them, not only at process exit.
- Serving model: Express serves `src/public/*` as shared assets and `games/*` as per-version runtime bundles.

# Testing

- Run lint: `npm run lint`
- Run type checking: `npm run typecheck`
- Run tests: `npm run test`
- Test coverage focus: route rendering/order, `/codex` page/API behavior and missing-state handling, Codex JSONL parsing/lookup, portrait render-surface markup/CSS, version metadata parsing (including `codexSessionId`), fork lineage/copy behavior (including ID collision retry/validation), prompt composition, build pipeline command sequencing, dev reload-token writing, and game-page live-reload polling behavior.
- End-to-end/manual flow: run `npm run dev`, open `/`, verify reverse-chronological 3-column tiles; open `/game/v1-bounce` and verify the bouncing circle + prompt panel POST to `/api/games/:versionId/prompts`; open `/game/elm-cloud-sage` and verify a dense field of shimmering bowls with animated iridescence/specular highlights remains readable on a portrait viewport; open `/codex`, choose a version, and verify user/assistant transcript rendering or the correct missing-session state.
