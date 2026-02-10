# Project

Local-first game version browser and editor where every version is playable, forkable, and independently buildable.

Top three features:
- Filesystem-backed version catalog rendered as reverse-chronological homepage tiles, with each version opening into a playable centered portrait (`9:16`) WebGL runtime.
- Fork-first fire-and-forget prompt pipeline that executes `codex exec` in a new version directory named with a human-readable three-word ID, then stores the emitted Codex session ID in version metadata as soon as it becomes available.
- Shared Codex transcript UI used on both `/codex` and desktop game pages (`/game/:versionId`) so each game can show a full-height right-side transcript panel with live polling and auto-scroll-to-latest updates.

# Repo structure

- `src/` - Backend app, HTML rendering, browser assets, and service modules.
  - `app.ts` - Express app factory and route wiring.
  - `server.ts` - HTTP server bootstrap.
  - `views.ts` - Homepage, game-page, and `/codex` page HTML rendering.
  - `types.ts` - Shared metadata/version TypeScript types.
  - `public/` - Static browser assets.
    - `styles.css` - Homepage/game-page styling, desktop split-panel game layout, prompt-panel transitions, and transcript layouts.
    - `game-view.js` - Prompt-panel UX, game-page transcript polling, and transcript auto-scroll behavior.
    - `codex-view.js` - `/codex` selector wiring and transcript loading.
    - `codex-transcript-presenter.js` - Shared transcript presenter used by `/codex` and game pages.
  - `services/` - Filesystem, build, prompt, and Codex-session orchestration.
    - `fsUtils.ts` - Shared fs/object/error helpers.
    - `gameVersions.ts` - Version ID validation, metadata parsing/writing, and version listing.
    - `forkGameVersion.ts` - Fork copy + lineage metadata creation.
    - `promptExecution.ts` - Build-prompt loading, prompt composition, and `codex exec --json` runner with backward-compatible session ID capture (`thread.started.thread_id` and legacy `session_meta.payload.id`).
    - `codexSessions.ts` - Codex session-file lookup and JSONL transcript parsing (user/assistant turns only).
    - `gameBuildPipeline.ts` - Per-game dependency install/build and source-path-to-version mapping.
- `scripts/` - Local automation entrypoints.
  - `dev.ts` - Initial build, backend spawn, and debounced watch rebuild loop.
  - `build-games.ts` - One-shot build for all game directories.
- `games/` - Versioned game sandboxes (one runtime/build boundary per version).
  - `v1-bounce/` - Initial bouncing-ball WebGL game implementation.
  - `pebble-iris-dawn/` - Bouncing-ball WebGL variant with a black ball fragment color.
  - `stone-copper-glade/` - Bouncing-ball WebGL variant with a slightly darker green ball fragment color.
  - `acorn-copper-linen/` - Bouncing-ball WebGL variant that renders ten simultaneous balls.
  - `cloud-sage-harbor/` - Bouncing-ball WebGL variant that renders one hundred balls with an animated synthwave pink-blue oil-slick shimmer shader.
- `docs/` - Project documentation.
  - `overview.md` - High-level architecture and operational summary.
- `tests/` - Vitest unit/integration coverage for app routes and core services.
- `game-plan.md` - Product requirements and milestones.
- `game-build-prompt.md` - Prompt prelude prepended to user prompt text before Codex execution.

# Most important code paths

- Homepage request flow: `src/app.ts` handles `GET /`, calls `listGameVersions()` (`src/services/gameVersions.ts`), and renders the three-column tile grid via `renderHomepage()` (`src/views.ts`).
- Game page flow: `src/app.ts` handles `GET /game/:versionId`, validates ID and existence, checks `dist/game.js`, then renders `renderGameView()` (`src/views.ts`) as a desktop split view (left game stage + right transcript panel); `src/public/game-view.js` keeps the prompt controls, polls `GET /api/codex-sessions/:versionId`, renders transcript cards through `createCodexTranscriptPresenter()` (`src/public/codex-transcript-presenter.js`), and auto-scrolls when transcript content changes.
- Prompt fork flow: `src/public/game-view.js` submits `POST /api/games/:versionId/prompts`; `src/app.ts` validates input, forks via `createForkedGameVersion()`, composes prompt from `game-build-prompt.md` + user text, and fire-and-forget executes `codex exec --json --dangerously-bypass-approvals-and-sandbox -` via `SpawnCodexRunner`; emitted session IDs are persisted immediately through a runner callback (with completion-time fallback) so `codexSessionId` is available before long-running executions finish.
- Codex transcript flow: `src/app.ts` serves `GET /codex` via `renderCodexView()` and `src/public/codex-view.js`; selecting a game requests `GET /api/codex-sessions/:versionId`, which reads metadata/session ID (`src/services/gameVersions.ts`), locates JSONL (`src/services/codexSessions.ts`), returns parsed user/assistant messages, and renders them with the shared presenter module used by game pages.
- Build/watch flow: `scripts/dev.ts` runs startup `buildAllGames()`, starts backend, watches `games/**/src/**`, extracts version IDs with `extractVersionIdFromSourcePath()`, and debounces per-version rebuilds with `buildGameDirectory()`.

# Data stores

- `games/` - Primary persisted store (no external database).
  - `<version-id>/`
    - `metadata.json` - `{ id: string, parentId: string | null, createdTime: ISO-8601 string, codexSessionId?: string | null }`.
    - `package.json` - Per-version dependency/build configuration.
    - `src/main.ts` - Version gameplay source.
    - `dist/game.js` - Built gameplay bundle served to clients.
    - `node_modules/` - Per-version installed dependencies.
- `~/.codex/sessions/` - External local Codex store used for transcript lookup.
  - `YYYY/MM/DD/rollout-...-<session-id>.jsonl` - Session event log parsed for `user` and `assistant` message text.

# Architecture notes

- Execution isolation: each version owns its own source, dependencies, and built bundle under `games/<version-id>/`.
- Prompt safety model: user prompt text is never shell-interpolated; `SpawnCodexRunner` passes full prompt bytes through stdin to `codex exec --json --dangerously-bypass-approvals-and-sandbox -`.
- Render surface model: desktop game pages use a full-height split layout with a fixed-aspect (`9:16`) game stage on the left and a full-height Codex transcript panel on the right; under `980px`, the transcript panel is hidden and the game returns to full-viewport portrait centering.
- Fork semantics: forks copy source version files recursively while excluding `node_modules`, then overwrite `metadata.json` with new `{ id, parentId, createdTime, codexSessionId: null }`; default IDs are random dictionary-backed three-word slugs.
- Codex session linkage: version metadata stores the session ID (`codexSessionId`) so `/codex` can resolve the matching JSONL without guessing by timestamp; session IDs are saved as soon as the runner observes them, not only at process exit.
- Serving model: Express serves `src/public/*` as shared assets and `games/*` as per-version runtime bundles.

# Testing

- Run lint: `npm run lint`
- Run type checking: `npm run typecheck`
- Run tests: `npm run test`
- Test coverage focus: route rendering/order, `/codex` page/API behavior and missing-state handling, shared transcript presenter usage paths, desktop game split-layout markup/CSS hooks, Codex JSONL parsing/lookup, version metadata parsing (including `codexSessionId`), fork lineage/copy behavior (including ID collision retry/validation), prompt composition, and build pipeline command sequencing.
- End-to-end/manual flow: run `npm run dev`, open `/`, verify reverse-chronological 3-column tiles; open `/game/v1-bounce` (or `/game/pebble-iris-dawn`, `/game/stone-copper-glade`, `/game/acorn-copper-linen`, or `/game/cloud-sage-harbor`) on desktop and verify left game + right full-height transcript panel with auto-scroll-on-new-messages plus prompt panel POST to `/api/games/:versionId/prompts` (the `pebble-iris-dawn` ball should render black, `stone-copper-glade` should render a darker green ball, `acorn-copper-linen` should render ten balls simultaneously, and `cloud-sage-harbor` should render one hundred shimmering pink/blue oil-slick balls); open `/codex`, choose a version, and verify user/assistant transcript rendering or the correct missing-session state.
