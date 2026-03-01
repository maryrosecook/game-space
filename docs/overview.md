# Project

Local-first game version browser and editor where every version is playable, forkable, and independently buildable.

Top three features:
- Filesystem-backed version catalog rendered as responsive homepage tiles (`Fountain`) with a minimum three-column grid, edge-to-edge tile media, overlaid labels, hyphen-normalized names, and favorite highlighting; logged-out users see only favorites while direct non-favorite game URLs still load.
- Cookie-authenticated admin workflow (`/auth`) that unlocks prompt execution and transcript access, including runtime switching between Codex and Claude codegen providers, while keeping public gameplay (`/` and `/game/:versionId`) available without login.
- Starter now supports deterministic headless runs (Playwright + SwiftShader flags) driven by a bounded JSON action protocol (`run` / `input` / `snap`) with PNG capture output via a local CLI workflow (`npm run headless`).

# Repo structure

- `src/` - Backend runtime, browser assets, and service modules.
  - `server.ts` - Production HTTP entrypoint that boots Next and forwards all requests through `nextBridge.handleRequest`, with centralized `502 Bad gateway` fallback on Next failures.
  - `types.ts` - Shared metadata/version TypeScript types.
  - `react/` - Shared React + TypeScript UI components and typed browser API client modules used by Next routes.
    - `components/` - Route-level React UI trees used by Next SSR + client hydration.
    - `api/client.ts` - Typed fetch wrappers for game/codex/ideas browser interactions.
    - `legacy/` - Transitional browser modules moved out of static serving paths and loaded through Next client bootstrap.
      - `game-view-client.js` - Legacy admin game-page behavior module (prompt submit/favorite/delete/snapshot/transcript/voice/annotation wiring).
      - `game-live-reload-client.js` - Legacy dev-only polling module.
      - `codex-transcript-presenter.js` - Shared transcript presenter used by `game-view-client`.
  - `public/` - Static browser assets.
    - `styles.css` - Homepage/game/auth styling, including minimum three-column homepage tile layout with full-bleed media + overlaid labels, favorite tile/button states, admin/public game states, provider selector controls on `/auth`, transcript layouts, and Edit-tab generating spinner animation.
  - `services/` - Filesystem, auth, build, provider-configurable prompt execution, and session/transcript orchestration.
    - `fsUtils.ts` - Shared fs/object/error helpers.
    - `adminAuth.ts` - Admin password verification, iron-session sealed cookies, fixed TTL, and login rate limiter.
    - `csrf.ts` - Same-origin + double-submit CSRF token issuance/validation.
    - `codegenConfig.ts` - Environment-backed codegen provider/model config parsing and runtime provider store used by auth/provider switching.
    - `gameAssetAllowlist.ts` - Runtime-safe `/games/:versionId/dist/*` allowlist and sensitive-path blocking.
    - `gameVersions.ts` - Version ID validation, metadata parsing/writing (including `favorite` and optional creation `prompt`), lifecycle status normalization, and version listing.
    - `forkGameVersion.ts` - Fork copy + lineage metadata creation.
    - `tileColor.ts` - Shared readable tile-color generator used for fork metadata and backfills.
    - `promptExecution.ts` - Build-prompt loading, prompt composition, and provider-specific non-interactive runners (`codex exec --json` with optional `--image` attachment files and `claude --print --output-format stream-json`, including `--input-format stream-json` multimodal user-message payloads when image attachments are present) behind the existing `CodexRunner` interface.
    - `codexSessions.ts` - Session-file lookup plus JSONL parsing/normalization for Codex and Claude transcript entries, including user/assistant text, Codex task lifecycle events, and Claude tool call/result events.
    - `codexTurnInfo.ts` - Per-worktree runtime-state tracker that scans latest matching session JSONL by worktree cwd metadata (`session_meta.payload.cwd` or top-level `cwd`), reads append-only bytes, and derives `eyeState` from task lifecycle events (with message-balance fallback).
    - `openaiTranscription.ts` - OpenAI Realtime client-secret factory (`/v1/realtime/client_secrets`) that configures `gpt-realtime-1.5` sessions with input transcription enabled and returns ephemeral browser tokens.
    - `gameBuildPipeline.ts` - Per-game dependency install/build and source-path-to-version mapping.
    - `devLiveReload.ts` - Per-version reload-token pathing/writes used by the dev watch loop.
    - `promptSubmission.ts` - Shared prompt-submit flow (forking, visual attachment validation, session persistence, and tile-snapshot capture) used by Next API handlers.
    - `serverRuntimeState.ts` - Shared mutable runtime singletons (provider store, login limiter, idea-generation state, and codex runner) used across Next-owned page and API handlers.
    - `nextBackendHandlers.ts` - Next Node-runtime auth/API handler implementations preserving existing status/security/data contracts.
    - `nextBridge.ts` - Next server lifecycle wrapper (`prepare`/request handler/close`) used by `src/server.ts` dispatching.
- `scripts/` - Local automation entrypoints.
  - `dev.ts` - Per-version startup builds, reload-token seeding, backend spawn with dev live-reload flag, and debounced watch rebuild loop.
  - `build-games.ts` - One-shot build for all game directories.
- `next-app/` - Next.js App Router surface for Next-owned runtime routes.
  - `app/page.tsx` - Next-owned homepage route that reuses shared homepage-data mapping and admin cookie auth checks.
  - `app/auth/*/route.ts` - Next-owned auth GET/POST route handlers (`/auth`, `/auth/login`, `/auth/logout`, `/auth/provider`).
  - `app/api/**/route.ts` - Next-owned API handlers for ideas, codex sessions, game mutations, transcription, and dev reload-token reads.
  - `app/public/[...assetPath]/route.ts` + `app/games/[versionId]/[...assetPath]/route.ts` + `app/favicon.ico/route.ts` - Next Node-runtime static/fallback handlers for `/public/*`, `/games/*`, and `/favicon.ico` under the explicit Option B GET-only static contract.
  - `app/layout.tsx` - Next document shell for homepage rendering and shared stylesheet include.
  - `next.config.ts` - Next configuration enabling `externalDir` for imports from the repo root.
- `.github/workflows/` - CI/CD workflow automation.
  - `deploy-main.yml` - Deploys `main` to the DigitalOcean server over SSH and restarts/starts `game-space` with PM2.
  - `pr-feature-videos.yml` - PR-scoped, opt-in Playwright video workflow that records selected E2E specs and upserts one PR comment with artifact links.
- `.github/pull_request_template.md` - PR template with `video-tests` selector block for requesting feature-video runs.
- `games/` - Versioned game sandboxes (one runtime/build boundary per version).
  - `starter/` - Minimal touch-and-mouse WebGL starter with browser/headless adapters and local headless tooling.
    - `src/main.ts` - Starter bootstrap plus `createStarterEngine()` adapter-injection entrypoint.
    - `src/engine/frameScheduler.ts` - Browser RAF and deterministic headless frame schedulers.
    - `src/engine/input.ts` - Browser and headless input managers that emit the same touch-frame shape.
    - `src/headless/protocol.ts` - Protocol types, guard rails, and parser/validator.
    - `src/headless/executor.ts` - Sequential step executor (`run`/`input`/`snap`) with runtime limit enforcement.
    - `src/headless/runner.ts` - Playwright orchestration, harness bundling, and PNG file persistence.
    - `src/headless/cli.ts` - Starter-local CLI (`--smoke`, `--script`, `--json`, or stdin JSON via `--stdin` / piped input) for headless runs.
    - `package.json` - Starter-local scripts (`headless`, `headless:install`, `headless:smoke`, `headless:run`) and dev dependencies.
    - `snapshots/` - Timestamped output directories for headless captures (gitignored).
- `tests/` - Vitest unit/integration coverage for Next handlers and core services, plus Playwright E2E specs under `tests/e2e/`.
- `playwright.config.ts` - Default E2E runner config (video off unless explicitly enabled).
- `docs/`
  - `overview.md` - High-level architecture and operational summary.
- `AGENTS.md` - Repo-specific Codex instructions, including sequential lint/typecheck validation to avoid memory overload.
- `.env.example` - Template for required admin auth secrets and codegen provider/model defaults.
- `conductor.json` - Conductor workspace startup config (`npm install`, `npm run dev`).
- `package.json` - NPM scripts and dependencies.
- `game-build-prompt.md` - Prompt prelude prepended to user prompt text before Codex execution.

# Most important code paths

- Request dispatch flow: `src/server.ts` is the single production entrypoint and forwards every request to Next (`nextBridge.handleRequest`) with centralized `502` fallback handling.
- Auth/homepage/API flow: Next handles `/`, `/_next/*`, `/auth*`, `/api/*`, `/game/*`, `/codex`, `/ideas`, `/public/*`, `/games/*`, and `/favicon.ico`; Node-runtime handlers preserve existing CSRF, rate-limit, cookie, and admin-404 contracts.
- Game page flow: `next-app/app/game/[versionId]/page.tsx` validates version/bundle availability, renders `GameApp`, and mounts `GamePageClientBootstrap` to start `/games/:versionId/dist/game.js` plus admin/dev client behaviors through Next-managed dynamic imports.
- Favorite toggle flow: `POST /api/games/:versionId/favorite` requires admin + CSRF, flips the `favorite` boolean in `metadata.json`, and returns the new state for `src/react/legacy/game-view-client.js` to reflect in the star button.
- Manual tile snapshot flow: admin game pages expose a recorder button (`#game-tab-capture-tile`) in the Edit drawer action row (left of delete) that captures current `#game-canvas` pixels as a PNG data URL; client capture waits for animation frames and retries when the output matches a blank-canvas PNG before posting to `POST /api/games/:versionId/tile-snapshot`, which validates the payload and writes `games/<version-id>/snapshots/tile.png`.
- Prompt fork flow: `POST /api/games/:versionId/prompts` requires admin + CSRF, forks via `createForkedGameVersion()` (prompt-derived three-word base plus random 10-character lowercase alphanumeric suffix), persists the submitted user prompt in the new fork's `metadata.json`, sets lifecycle state to `created`, composes full prompt, launches the provider-selected runner (`codex` or `claude`) behind `CodexRunner`, persists `codexSessionId` as soon as observed, and transitions lifecycle to `stopped` or `error` when the run settles.
- Realtime voice transcription flow: `POST /api/transcribe` (admin + CSRF) mints an OpenAI Realtime client secret configured for `gpt-realtime-1.5` and returns a short-lived `clientSecret` plus model; `src/react/legacy/game-view-client.js` then exchanges SDP with `https://api.openai.com/v1/realtime/calls`, streams mic audio over WebRTC, applies `conversation.item.input_audio_transcription.completed` text to the prompt input and full-width in-canvas overlay (top-anchored, left-aligned, auto-following newest text), enables annotation drawing while recording, and on stop submits transcription plus optional annotation PNG (`annotationPngDataUrl`) to `/api/games/:versionId/prompts`; the server validates/decodes that PNG and passes it as an attachment to the active codegen provider (Codex `--image`; Claude stream-json image content block).
- Codex transcript/runtime flow: `/codex` and `/api/codex-sessions/:versionId` require admin; `next-app/app/codex/page.tsx` renders `CodexPageClient`, and client state logic loads transcript payloads, preserves status messaging, and auto-scrolls to newest entries.
- Ideas flow: `/ideas` requires admin; `next-app/app/ideas/page.tsx` renders `IdeasPageClient`, and client logic uses typed API wrappers for generate/build/delete while preserving CSRF/header semantics and redirect-on-build behavior.
- Static/runtime serving flow: Next route handlers serve `/public/*` and `/games/*`; `/games/*` enforcement still uses `isAllowedGamesRuntimeAssetPath()` so only runtime-safe assets are public and sensitive/dev files (including `dist/reload-token.txt`) return `404`.
- Dev reload flow: when `GAME_SPACE_DEV_LIVE_RELOAD=1`, `scripts/dev.ts` rewrites per-version `dist/reload-token.txt`; browser polling uses `/api/dev/reload-token/:versionId` instead of direct `/games` file access.
- Starter headless flow: `games/starter/src/headless/cli.ts` parses a steps-only protocol (`--smoke`, `--script`, `--json`, or stdin JSON), infers the game ID from cwd, and `parseStarterHeadlessProtocol()` enforces fixed headless constraints before launch; `runStarterHeadless()` launches Chromium with SwiftShader-friendly flags, bundles/loads `browserHarness.ts`, then `executeStarterHeadlessProtocol()` applies deterministic steps through `HeadlessFrameScheduler` and `HeadlessInputManager`, and `persistCaptures()` writes ordered PNGs under `games/starter/snapshots/<timestamp>/`.

# Data stores

- `games/` - Primary persisted store (no external database).
  - `<version-id>/`
    - `metadata.json` - `{ id: string, parentId: string | null, createdTime: ISO-8601 string, threeWords?: string, prompt?: string, tileColor?: "#RRGGBB", favorite?: boolean, codexSessionId?: string | null, codexSessionStatus?: "none" | "created" | "stopped" | "error" }`.
    - `src/main.ts` - Version gameplay source.
    - `dist/game.js` - Built runtime bundle served to clients.
    - `dist/reload-token.txt` - Dev-only rebuild token (read through `/api/dev/reload-token/:versionId` when dev live reload is enabled).
    - `node_modules/` - Per-version installed dependencies.
- `games/starter/snapshots/` - Starter headless capture output (timestamped directories, gitignored).
  - `<timestamp>/`
    - `<index>-<label>.png` - Snapshot captured at a deterministic frame.
- `~/.codex/sessions/` - External local Codex store used for transcript/runtime-state lookup.
  - `YYYY/MM/DD/rollout-...-<session-id>.jsonl` - Session event log parsed for `session_meta` cwd matching, task lifecycle events, and user/assistant message turns.
- `~/.claude/projects/` - External local Claude Code store used for transcript/runtime-state lookup when provider is Claude.
  - `<project-slug>/<session-id>.jsonl` - Session event log parsed for top-level `cwd`, and normalized user/assistant message turns.
- `.env` (local, gitignored) - Admin auth secrets.
  - `GAME_SPACE_ADMIN_PASSWORD_HASH` - `scrypt$<saltBase64>$<hashBase64>`.
  - `GAME_SPACE_ADMIN_SESSION_SECRET` - Session sealing secret used by iron-session for admin session cookies.
  - `OPENAI_API_KEY` - Server-side key used only to mint ephemeral Realtime transcription sessions.
  - `CODEGEN_PROVIDER` - Active codegen provider (`codex` or `claude`), defaults to `codex`.
  - `CODEGEN_CLAUDE_MODEL` - Claude model name used by provider-selected prompt execution, defaults to `claude-sonnet-4-6`.
  - `CODEGEN_CLAUDE_THINKING` - Claude thinking mode hint appended to provider-selected runs, defaults to `adaptive`.

# Architecture notes

- Execution isolation: each version owns its own source, dependencies, and built bundle under `games/<version-id>/`.
- Route-ownership model: Next owns runtime route handling at the public origin for pages (`/`, `/game/:versionId`, `/codex`, `/ideas`, `/auth*`), APIs (`/api/**`), and static/fallback paths (`/public/*`, `/games/*`, `/favicon.ico`); `src/server.ts` no longer has legacy compatibility dispatch branches.
- Next bridge/build ownership model: `createNextBridge()` prepares Next in-process and serves all requests; failures in request handling return `502 Bad gateway`. Build ownership is split: `npm run build:next` compiles `next-app/`, while `tsc -p tsconfig.build.json` compiles the supporting TypeScript server/runtime modules.
- Shared runtime-state model: `serverRuntimeState.ts` keeps provider selection, auth login limiter state, idea-generation cancellation state, and codex runner wiring consistent across Next-owned page and API handlers.
- Admin auth model: iron-session sealed, `HttpOnly`, `Secure`, `SameSite=Strict` session cookie with fixed 3-day TTL; unauthorized protected-route requests return `404`.
- CSRF model: same-origin enforcement plus double-submit token (cookie + hidden form field or `X-CSRF-Token` header).
- Realtime voice transcription model: browser never receives `OPENAI_API_KEY`; server mints short-lived client secrets via OpenAI Realtime client-secrets API using `gpt-realtime-1.5` sessions with `gpt-4o-transcribe` input transcription enabled, and the client streams mic audio directly to OpenAI over WebRTC via `/v1/realtime/calls`.
- Annotation capture model: while recording, `game-view-client.js` activates the full-stage `#prompt-drawing-canvas` overlay and draws pointer/touch strokes using `CanvasRenderingContext2D`; when prompt submission happens from recorded speech, the client includes `toDataURL('image/png')` output as `annotationPngDataUrl` only if ink was drawn. The server accepts only PNG data URLs, decodes the image bytes, writes a temporary PNG in the fork worktree, and passes that image to both Codex (`--image`) and Claude (`--input-format stream-json` user message with base64 image content block) while also including an attached-image prompt marker.
- Codegen provider model: `RuntimeCodegenConfigStore` loads env defaults once and keeps a mutable in-memory `provider` setting that `/auth/provider` can update; `SpawnCodegenRunner` reads this setting at run-time and dispatches to either Codex or Claude CLI while preserving the `CodexRunner` API contract.
- Prompt safety model: user prompt text is never shell-interpolated; provider runners pass full prompt bytes through stdin (`codex exec --json --dangerously-bypass-approvals-and-sandbox -` with optional `--image` file arguments, or `claude --print --output-format stream-json --dangerously-skip-permissions`, switching to `--input-format stream-json` JSONL user-message input when image attachments are provided).
- Creation prompt persistence model: newly forked game versions persist the submitted creation prompt as `metadata.json.prompt`; existing metadata is not backfilled.
- Metadata persistence model: `writeMetadataFile()` normalizes metadata fields, serializes writes per `metadata.json` path, and writes through a temp-file rename to avoid partial/corrupted JSON during concurrent updates.
- Fork ID model: default fork IDs use a descriptive three-word base derived from the prompt (or `new-arcade-game` fallback) and append a random 10-character lowercase alphanumeric suffix to reduce collisions.
- Runtime-state derivation model: `codexTurnInfo.ts` keeps an in-memory tracker per worktree (`sessionPath`, append offset, partial-line buffer, task lifecycle counters, user/assistant counters, latest assistant metadata), scans for the newest matching JSONL by worktree cwd metadata (`session_meta.payload.cwd` for Codex or top-level `cwd` for Claude), and sets `eyeState` to `generating` while `task_started` count exceeds terminal task events (`task_complete` and related terminal markers); otherwise `idle`. For logs without task markers, it falls back to user/assistant message balance. When no tracker is active, lifecycle state maps fallback runtime state.
- Transcript scroll model: `createCodexTranscriptPresenter()` exposes `scrollToBottom()`; game transcript panel-open events and transcript re-renders use it (via `autoScrollToBottom`) so admins land on the newest message when opening the panel and during polling updates.
- Voice overlay layout model: `prompt-overlay` covers the full game viewport, renders transcript text top-left with reduced size, and `updatePromptOverlay()` keeps the container scrolled to `scrollHeight` while visible so newest transcript text stays in view.
- Starter game base model: `games/starter/src/engine/engine.ts` runs lifecycle/tick phases with adapter injection points for input and frame scheduling. Browser gameplay defaults to `BrowserInputManager` + `BrowserRafScheduler`; headless runs inject `HeadlessInputManager` + `HeadlessFrameScheduler` while leaving game/blueprint logic unchanged.
- Starter headless protocol model: `protocol.ts` validates steps-only action tapes and enforces fixed runtime constraints (`viewport=360x640@dpr1`, `MAX_TOTAL_FRAMES=120`, `MAX_SNAPSHOTS=1`, `MAX_STEPS=64`, `MAX_INPUT_EVENTS=128`, and runtime ceiling) before launching Chromium.
- Starter headless orchestration model: `runner.ts` bundles `browserHarness.ts` via esbuild at runtime, boots a canvas in Playwright, executes sequential steps through `executor.ts`, captures only `snap` frames, and persists PNG outputs with stable ordered filenames. `browserHarness.ts` creates WebGL with `preserveDrawingBuffer: true` and calls `gl.finish()` before `toDataURL('image/png')` so captures contain rendered pixels rather than cleared buffers.
- Favorites model: each game version can be marked favorite in `metadata.json`; the homepage filters to favorites for logged-out users, while authenticated admins can toggle favorite state from the game-page star control.
- Manual tile snapshot model: admins trigger capture from the Edit drawer action row; `game-view-client.js` reads `#game-canvas` on animation-frame boundaries, calls `gl.finish()` when available, and retries blank-frame captures before saving to `snapshots/tile.png` through `/api/games/:versionId/tile-snapshot`. `next-app/app/game/[versionId]/page.tsx` forces `preserveDrawingBuffer` for admin game-canvas WebGL context creation so manual captures remain stable.
- Icon model: server-rendered controls serialize official Lucide icon nodes imported from the `lucide` npm package; ideas rerenders reuse these server-provided SVG strings from `data-idea-build-icon` / `data-idea-delete-icon` so client updates stay in sync with package-backed icons.
- Tile-color model: `tileColor.ts` generates random `#RRGGBB` colors that satisfy a minimum 4.5:1 contrast ratio with white text (fallback `#1D3557`), and forks/seeded versions persist this value in `metadata.json`.
- Homepage tile layout model: `.game-grid` uses `repeat(3, minmax(0, 1fr))` so sparse tile sets still render in at least three columns; `.game-tile` media is full-bleed (`.tile-image` absolute inset) and `.tile-id` is bottom-overlaid with a readability gradient.
- Static serving model: Next serves shared `src/public/*` and runtime game assets under `/games/*` with allowlist enforcement; static semantics intentionally use Option B (GET-only, no `express.static` HEAD/range/conditional parity).
- Client build model: Next App Router owns browser client bundling (`next-app/**` + shared `src/react/**` imports) and emits frontend artifacts under `.next/**`; no generated hydration bundles are tracked under `src/public/react`.
- Dev live-reload model: token file stays on disk under each game `dist/`, but browser access is routed through `/api/dev/reload-token/:versionId` in dev mode.
- Deployment model: GitHub Actions deploys `main` to DigitalOcean over SSH using repository secrets and PM2 process management.
- PR video model: Playwright videos are opt-in per PR update; workflow first enforces exactly one PR-body `video-tests` marker block and then resolves selectors from that block before editing a single status comment in place.
- Codex validation model: repo-level agent instructions require `npm run typecheck` and `npm run lint` to run sequentially (typecheck first, then lint) to reduce memory pressure.

# Testing

- Run type checking: `npm run typecheck`
- Run lint: `npm run lint`
- Run type checking and lint sequentially (never in parallel) to avoid memory overload.
- Run tests: `npm run test`
- Run targeted Phase 2 route-ownership E2E: `npm run test:e2e -- tests/e2e/phase2-next-parallel.spec.ts`
- Run targeted Phase 3 backend ownership E2E: `npm run test:e2e -- tests/e2e/phase1-react-hydration.spec.ts tests/e2e/phase2-next-parallel.spec.ts tests/e2e/phase3-next-backend.spec.ts`
- Run starter-local typecheck (includes `src/headless/*`): `npm --prefix games/starter run typecheck`
- Run starter headless custom protocol JSON directly: `cat /path/to/protocol.json | npm --prefix games/starter run headless`
- Run starter headless smoke scenario: `npm --prefix games/starter run headless:smoke`
- Coverage focus:
  - Auth login/logout cookies, fixed TTL, CSRF checks, and brute-force backoff behavior.
  - Protected-route gating for `/codex`, transcript API, prompt API, and favorite toggle API.
  - Manual tile snapshot capture route validation (`/api/games/:versionId/tile-snapshot`) and persistence to `snapshots/tile.png`.
  - Homepage branding/filter behavior (`Fountain` header/title, logged-out favorites-only view, minimum three-column tile grid, full-bleed tile media, overlaid tile labels, and favorite tile styling).
  - Runtime-state derivation from Codex JSONL task lifecycle events and lifecycle-status fallback mapping.
  - Provider switching from `/auth` (`codex -> claude -> codex`) and active provider/model rendering.
  - `/games` runtime allowlist allow/deny behavior and dev reload-token API route.
  - Prompt fork/session lifecycle persistence flow and transcript parsing behavior across Codex + Claude JSONL formats.
  - Metadata persistence safety for multiline/quoted/Unicode prompt text and concurrent metadata writes.
  - Realtime transcription session creation route behavior (`200`, `502`, `503`) and game-page client WebRTC transcription wiring through `/v1/realtime/calls`.
  - Game page client behavior for CSRF header inclusion, admin/public UI states, favorite-star toggling, transcript auto-scroll wiring on panel open and polling updates, top-anchored realtime voice-overlay auto-follow behavior, and Edit-tab generating spinner class toggling for both Codex and Claude generation states.
  - `/codex` client behavior, including transcript render auto-scroll request on initial load.
  - Repo automation workflow integrity checks, including YAML parse validation for `.github/workflows/pr-feature-videos.yml`.
  - Source-level runtime assertions cover starter runtime behavior in `tests/gameRuntimeSource.test.ts`; the starter engine still has no dedicated engine-unit-test module.
  - Starter headless coverage includes protocol validation/guard rails (`tests/starterHeadlessProtocol.test.ts`), deterministic step execution + runtime ceiling (`tests/starterHeadlessExecutor.test.ts`), and adapter behavior for deterministic scheduler and synthetic input (`tests/starterHeadlessAdapters.test.ts`).
- End-to-end automation flow:
  - Baseline E2E run (no recording): `npm run test:e2e`.
  - Video run (opt-in only): `npm run test:e2e:video` or set `PLAYWRIGHT_CAPTURE_VIDEO=1`.
  - For every change, add or update at least one Playwright E2E test unless the change is clearly not demonstrable end-to-end.
  - In PRs, request feature video generation only when needed by adding target selectors inside the PR template block:
    - `<!-- video-tests:start -->`
    - `<selector per line>`
    - `<!-- video-tests:end -->`
  - The PR video workflow now fails fast if that delimiter block is missing, duplicated, or malformed.
  - On later commits to the same PR, keep that selector block current; the workflow reruns on `synchronize` and updates the existing “Feature Video Artifacts” comment in place.
- End-to-end/manual flow:
  - Run `npm run dev`.
  - Verify logged-out behavior: `/` shows only favorited game tiles in a minimum three-column grid with edge-to-edge imagery + overlaid labels, direct `/game/:versionId` URLs still load, and `/codex`, prompt API, and favorite toggle API are unavailable.
  - Verify logged-in behavior via `/auth`: prompt controls/transcripts and the favorite star appear on game pages; `/codex` loads and transcript/favorite APIs respond.
  - On `/auth`, switch provider `Codex -> Claude -> Codex` and verify the selected provider and active model/thinking labels update accordingly.
  - While a Codex or Claude run is active for a game worktree, verify the `Edit` tab shows a spinner on the right and clears when generation completes.
  - Verify dev live reload by editing a game source file and observing browser refresh after rebuild token changes.
