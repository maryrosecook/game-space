# Project

Local-first game version browser and editor where every version is playable, forkable, and independently buildable.

Top three features:
- Filesystem-backed version catalog rendered as responsive homepage tiles (`Fountain`), with hyphen-normalized labels and favorite highlighting; logged-out users see only favorites while direct non-favorite game URLs still load.
- Cookie-authenticated admin workflow (`/auth`) that unlocks prompt execution and transcript access, including runtime switching between Codex and Claude codegen providers, while keeping public gameplay (`/` and `/game/:versionId`) available without login.
- Admin game controls on `/game/:versionId` include prompt editing with a Lucide `rocket` icon on the `Build` action, icon-only transcript/favorite/delete controls with consistent sizing, and favorite persistence to each game's `metadata.json`; Lucide SVG nodes are sourced from the installed `lucide` npm package.

# Repo structure

- `src/` - Backend app, HTML rendering, browser assets, and service modules.
  - `app.ts` - Express app factory, route wiring, auth/CSRF enforcement, runtime-state API shaping, and static asset gating.
  - `server.ts` - HTTP server bootstrap and dotenv loading.
  - `views.ts` - Homepage/auth/game/codex HTML rendering.
  - `types.ts` - Shared metadata/version TypeScript types.
  - `public/` - Static browser assets.
    - `styles.css` - Homepage/game/auth styling, favorite tile/button states, admin/public game states, provider selector controls on `/auth`, transcript layouts, and Edit-tab generating spinner animation.
    - `game-view.js` - Admin game-page Build prompt submission, favorite toggle API calls, realtime voice transcription (session mint + WebRTC stream + transcript events), recording-time annotation drawing (mouse/touch pointer strokes on an overlay canvas), PNG annotation attachment in prompt-submit payloads, bottom-tab behavior, transcript polling, transcript auto-scroll on panel open and new entries, provider-specific transcript heading labels (`Codex Transcript` or `Claude Transcript`), and Edit-tab generating-state class toggling from server `eyeState`.
    - `game-live-reload.js` - Dev-only game-page polling via `/api/dev/reload-token/:versionId`.
    - `codex-view.js` - `/codex` selector wiring and transcript loading with provider-specific heading labels and initial render auto-scroll to newest messages.
    - `codex-transcript-presenter.js` - Shared transcript presenter used by `/codex` and game pages, with configurable transcript title text.
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
- `scripts/` - Local automation entrypoints.
  - `dev.ts` - Initial build, per-version reload-token seeding, backend spawn with dev live-reload flag, and debounced watch rebuild loop.
  - `build-games.ts` - One-shot build for all game directories.
- `.github/workflows/` - CI/CD workflow automation.
  - `deploy-main.yml` - Deploys `main` to the DigitalOcean server over SSH and restarts/starts `game-space` with PM2.
  - `pr-feature-videos.yml` - PR-scoped, opt-in Playwright video workflow that records selected E2E specs and upserts one PR comment with artifact links.
- `.github/pull_request_template.md` - PR template with `video-tests` selector block for requesting feature-video runs.
- `games/` - Versioned game sandboxes (one runtime/build boundary per version).
  - `starter/` - Minimal touch-and-mouse WebGL starter powered by `src/engine/*` (`engine.ts`, `input.ts`, `blueprints.ts`, `particles.ts`, `physics.ts`, `render.ts`, `types.ts`) plus sample wiring in `src/main.ts`; intentionally omits GUI/editor features and ships local `typecheck` support via `tsc --noEmit`.
  - `v1-bounce/` - Initial bouncing-ball WebGL game implementation.
  - `d0cf7658-3371-4f01-99e2-ca90fc1899cf/` - Forked bouncing-ball variant.
- `tests/` - Vitest unit/integration coverage for app routes and core services, plus Playwright E2E specs under `tests/e2e/`.
- `playwright.config.ts` - Default E2E runner config (video off unless explicitly enabled).
- `docs/`
  - `overview.md` - High-level architecture and operational summary.
- `AGENTS.md` - Repo-specific Codex instructions, including sequential lint/typecheck validation to avoid memory overload.
- `.env.example` - Template for required admin auth secrets and codegen provider/model defaults.
- `conductor.json` - Conductor workspace startup config (`npm install`, `npm run dev`).
- `package.json` - NPM scripts and dependencies.
- `game-build-prompt.md` - Prompt prelude prepended to user prompt text before Codex execution.
- `game-plan.md` - Product requirements and milestones.

# Most important code paths

- Auth flow: `GET /auth` renders `renderAuthView()` with CSRF token and active provider/model details; `POST /auth/login` validates CSRF + password hash + rate limits, sets an iron-session sealed admin cookie, and redirects; `POST /auth/provider` lets admins switch active codegen provider (`codex` or `claude`) with CSRF validation; `POST /auth/logout` validates CSRF and clears the admin cookie.
- Homepage flow: `GET /` calls `listGameVersions()` and renders `renderHomepage()` with auth-aware top-right CTA (`Login` or `Admin`); logged-out mode filters to favorited versions and favorited tiles render with a yellow border.
- Game page flow: `GET /game/:versionId` validates availability, renders `renderGameView()` in admin/public mode, and only injects prompt/transcript UI plus CSRF/favorite data attributes for authenticated admins; opening the transcript panel scrolls to the newest visible transcript entry.
- Favorite toggle flow: `POST /api/games/:versionId/favorite` requires admin + CSRF, flips the `favorite` boolean in `metadata.json`, and returns the new state for `src/public/game-view.js` to reflect in the star button.
- Prompt fork flow: `POST /api/games/:versionId/prompts` requires admin + CSRF, forks via `createForkedGameVersion()` (prompt-derived three-word base plus random 10-character lowercase alphanumeric suffix), persists the submitted user prompt in the new fork's `metadata.json`, sets lifecycle state to `created`, composes full prompt, launches the provider-selected runner (`codex` or `claude`) behind `CodexRunner`, persists `codexSessionId` as soon as observed, and transitions lifecycle to `stopped` or `error` when the run settles.
- Realtime voice transcription flow: `POST /api/transcribe` (admin + CSRF) mints an OpenAI Realtime client secret configured for `gpt-realtime-1.5` and returns a short-lived `clientSecret` plus model; `src/public/game-view.js` then exchanges SDP with `https://api.openai.com/v1/realtime/calls`, streams mic audio over WebRTC, applies `conversation.item.input_audio_transcription.completed` text to the prompt input and full-width in-canvas overlay (top-anchored, left-aligned, auto-following newest text), enables annotation drawing while recording, and on stop submits transcription plus optional annotation PNG (`annotationPngDataUrl`) to `/api/games/:versionId/prompts`; the server validates/decodes that PNG and passes it as an attachment to the active codegen provider (Codex `--image`; Claude stream-json image content block).
- Codex transcript/runtime flow: `/codex` and `/api/codex-sessions/:versionId` require admin; transcript API resolves metadata, derives runtime `eyeState` via `getCodexTurnInfo()` (task lifecycle for Codex logs, message-balance fallback for Claude logs), reads session JSONL from both `~/.codex/sessions` and `~/.claude/projects`, and returns normalized transcript entries plus lifecycle/runtime state, which clients render anchored at the newest entry.
- Static/runtime serving flow: `/games/*` first passes `requireRuntimeGameAssetPathMiddleware()` so only runtime-safe `dist` assets are public; sensitive or dev files (including `dist/reload-token.txt`) return `404`.
- Dev reload flow: when `GAME_SPACE_DEV_LIVE_RELOAD=1`, `scripts/dev.ts` rewrites per-version `dist/reload-token.txt`; browser polling uses `/api/dev/reload-token/:versionId` instead of direct `/games` file access.

# Data stores

- `games/` - Primary persisted store (no external database).
  - `<version-id>/`
    - `metadata.json` - `{ id: string, parentId: string | null, createdTime: ISO-8601 string, threeWords?: string, prompt?: string, tileColor?: "#RRGGBB", favorite?: boolean, codexSessionId?: string | null, codexSessionStatus?: "none" | "created" | "stopped" | "error" }`.
    - `src/main.ts` - Version gameplay source.
    - `dist/game.js` - Built runtime bundle served to clients.
    - `dist/reload-token.txt` - Dev-only rebuild token (read through `/api/dev/reload-token/:versionId` when dev live reload is enabled).
    - `node_modules/` - Per-version installed dependencies.
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
- Admin auth model: iron-session sealed, `HttpOnly`, `Secure`, `SameSite=Strict` session cookie with fixed 3-day TTL; unauthorized protected-route requests return `404`.
- CSRF model: same-origin enforcement plus double-submit token (cookie + hidden form field or `X-CSRF-Token` header).
- Realtime voice transcription model: browser never receives `OPENAI_API_KEY`; server mints short-lived client secrets via OpenAI Realtime client-secrets API using `gpt-realtime-1.5` sessions with `gpt-4o-transcribe` input transcription enabled, and the client streams mic audio directly to OpenAI over WebRTC via `/v1/realtime/calls`.
- Annotation capture model: while recording, `game-view.js` activates the full-stage `#prompt-drawing-canvas` overlay and draws pointer/touch strokes using `CanvasRenderingContext2D`; when prompt submission happens from recorded speech, the client includes `toDataURL('image/png')` output as `annotationPngDataUrl` only if ink was drawn. The server accepts only PNG data URLs, decodes the image bytes, writes a temporary PNG in the fork worktree, and passes that image to both Codex (`--image`) and Claude (`--input-format stream-json` user message with base64 image content block) while also including an attached-image prompt marker.
- Codegen provider model: `RuntimeCodegenConfigStore` loads env defaults once and keeps a mutable in-memory `provider` setting that `/auth/provider` can update; `SpawnCodegenRunner` reads this setting at run-time and dispatches to either Codex or Claude CLI while preserving the `CodexRunner` API contract.
- Prompt safety model: user prompt text is never shell-interpolated; provider runners pass full prompt bytes through stdin (`codex exec --json --dangerously-bypass-approvals-and-sandbox -` with optional `--image` file arguments, or `claude --print --output-format stream-json --dangerously-skip-permissions`, switching to `--input-format stream-json` JSONL user-message input when image attachments are provided).
- Creation prompt persistence model: newly forked game versions persist the submitted creation prompt as `metadata.json.prompt`; existing metadata is not backfilled.
- Metadata persistence model: `writeMetadataFile()` normalizes metadata fields, serializes writes per `metadata.json` path, and writes through a temp-file rename to avoid partial/corrupted JSON during concurrent updates.
- Fork ID model: default fork IDs use a descriptive three-word base derived from the prompt (or `new-arcade-game` fallback) and append a random 10-character lowercase alphanumeric suffix to reduce collisions.
- Runtime-state derivation model: `codexTurnInfo.ts` keeps an in-memory tracker per worktree (`sessionPath`, append offset, partial-line buffer, task lifecycle counters, user/assistant counters, latest assistant metadata), scans for the newest matching JSONL by worktree cwd metadata (`session_meta.payload.cwd` for Codex or top-level `cwd` for Claude), and sets `eyeState` to `generating` while `task_started` count exceeds terminal task events (`task_complete` and related terminal markers); otherwise `idle`. For logs without task markers, it falls back to user/assistant message balance. When no tracker is active, lifecycle state maps fallback runtime state.
- Transcript scroll model: `createCodexTranscriptPresenter()` exposes `scrollToBottom()`; game transcript panel-open events and transcript re-renders use it (via `autoScrollToBottom`) so admins land on the newest message when opening the panel and during polling updates.
- Voice overlay layout model: `prompt-overlay` covers the full game viewport, renders transcript text top-left with reduced size, and `updatePromptOverlay()` keeps the container scrolled to `scrollHeight` while visible so newest transcript text stays in view.
- Starter game base model: `games/starter/src/engine/engine.ts` runs lifecycle/tick phases (`initialize`, `loadGame`, `loadCamera`, `startLoop`, `tick`, handler phases, resize, camera/runtime updates); `input.ts` normalizes touch pointer and desktop mouse down/move/up/cancel-equivalent events into a shared touch-frame input model; `blueprints.ts` handles blueprint lookup/thing creation/handler execution; `particles.ts` provides lightweight particle storage/stepping; `physics.ts` exposes a no-op pluggable physics hook for future collision engines; and `render.ts` provides a WebGL skeleton that draws rectangles/circles/triangles in shader space with no bitmap/image path. `games/starter/src/main.ts` wires a single night-blue bouncing ball, uses static camera bounds, and emits fire-colored rain particles just above the viewport top, rendered in the foreground over gameplay actors. `games/starter/package.json` includes `typecheck: tsc --noEmit` with local `typescript` dev tooling so starter forks can run type checks immediately.
- Favorites model: each game version can be marked favorite in `metadata.json`; the homepage filters to favorites for logged-out users, while authenticated admins can toggle favorite state from the game-page star control.
- Icon model: server-rendered controls serialize official Lucide icon nodes imported from the `lucide` npm package; ideas rerenders reuse these server-provided SVG strings from `data-idea-build-icon` / `data-idea-delete-icon` so client updates stay in sync with package-backed icons.
- Tile-color model: `tileColor.ts` generates random `#RRGGBB` colors that satisfy a minimum 4.5:1 contrast ratio with white text (fallback `#1D3557`), and forks/seeded versions persist this value in `metadata.json`.
- Static serving model: Express serves shared `src/public/*`; `/games/*` is runtime-allowlisted and blocks metadata/source/config/dev artifacts.
- Dev live-reload model: token file stays on disk under each game `dist/`, but browser access is routed through `/api/dev/reload-token/:versionId` in dev mode.
- Deployment model: GitHub Actions deploys `main` to DigitalOcean over SSH using repository secrets and PM2 process management.
- PR video model: Playwright videos are opt-in per PR update; selectors come from PR metadata/template block (or `.github/video-tests.txt`), and workflow comments are edited in place.
- Codex validation model: repo-level agent instructions require `npm run typecheck` and `npm run lint` to run sequentially (typecheck first, then lint) to reduce memory pressure.

# Testing

- Run type checking: `npm run typecheck`
- Run lint: `npm run lint`
- Run type checking and lint sequentially (never in parallel) to avoid memory overload.
- Run tests: `npm run test`
- Coverage focus:
  - Auth login/logout cookies, fixed TTL, CSRF checks, and brute-force backoff behavior.
  - Protected-route gating for `/codex`, transcript API, prompt API, and favorite toggle API.
  - Homepage branding/filter behavior (`Fountain` header/title, logged-out favorites-only view, and favorite tile styling).
  - Runtime-state derivation from Codex JSONL task lifecycle events and lifecycle-status fallback mapping.
  - Provider switching from `/auth` (`codex -> claude -> codex`) and active provider/model rendering.
  - `/games` runtime allowlist allow/deny behavior and dev reload-token API route.
  - Prompt fork/session lifecycle persistence flow and transcript parsing behavior across Codex + Claude JSONL formats.
  - Metadata persistence safety for multiline/quoted/Unicode prompt text and concurrent metadata writes.
  - Realtime transcription session creation route behavior (`200`, `502`, `503`) and game-page client WebRTC transcription wiring through `/v1/realtime/calls`.
  - Game page client behavior for CSRF header inclusion, admin/public UI states, favorite-star toggling, transcript auto-scroll wiring on panel open and polling updates, top-anchored realtime voice-overlay auto-follow behavior, and Edit-tab generating spinner class toggling for both Codex and Claude generation states.
  - `/codex` client behavior, including transcript render auto-scroll request on initial load.
  - Repo automation workflow integrity checks, including YAML parse validation for `.github/workflows/pr-feature-videos.yml`.
  - Source-level runtime assertions cover bouncing games and starter runtime behavior in `tests/gameRuntimeSource.test.ts`; the starter engine still has no dedicated engine-unit-test module.
- End-to-end automation flow:
  - Baseline E2E run (no recording): `npm run test:e2e`.
  - Video run (opt-in only): `npm run test:e2e:video` or set `PLAYWRIGHT_CAPTURE_VIDEO=1`.
  - For new user-visible features, add or update at least one Playwright E2E test covering the feature path.
  - In PRs, request feature video generation only when needed by adding target selectors inside the PR template block:
    - `<!-- video-tests:start -->`
    - `<selector per line>`
    - `<!-- video-tests:end -->`
  - On later commits to the same PR, keep that selector block current; the workflow reruns on `synchronize` and updates the existing “Feature Video Artifacts” comment instead of posting duplicates.
- End-to-end/manual flow:
  - Run `npm run dev`.
  - Verify logged-out behavior: `/` shows only favorited game tiles, direct `/game/:versionId` URLs still load, and `/codex`, prompt API, and favorite toggle API are unavailable.
  - Verify logged-in behavior via `/auth`: prompt controls/transcripts and the favorite star appear on game pages; `/codex` loads and transcript/favorite APIs respond.
  - On `/auth`, switch provider `Codex -> Claude -> Codex` and verify the selected provider and active model/thinking labels update accordingly.
  - While a Codex or Claude run is active for a game worktree, verify the `Edit` tab shows a spinner on the right and clears when generation completes.
  - Verify dev live reload by editing a game source file and observing browser refresh after rebuild token changes.
