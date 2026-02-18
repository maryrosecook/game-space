# Project

Local-first game version browser and editor where every version is playable, forkable, and independently buildable.

Top three features:
- Filesystem-backed version catalog rendered as responsive homepage tiles (`Fountain`), with hyphen-normalized labels and favorite highlighting; logged-out users see only favorites while direct non-favorite game URLs still load.
- Cookie-authenticated admin workflow (`/auth`) that unlocks prompt execution and Codex transcript access while keeping public gameplay (`/` and `/game/:versionId`) available without login.
- Admin game controls on `/game/:versionId` include prompt editing, transcript toggle, and an icon-only star toggle (no tab chrome) that persists favorite state to each game's `metadata.json`; the back link and controls share bottom alignment.

# Repo structure

- `src/` - Backend app, HTML rendering, browser assets, and service modules.
  - `app.ts` - Express app factory, route wiring, auth/CSRF enforcement, runtime-state API shaping, and static asset gating.
  - `server.ts` - HTTP server bootstrap and dotenv loading.
  - `views.ts` - Homepage/auth/game/codex HTML rendering.
  - `types.ts` - Shared metadata/version TypeScript types.
  - `public/` - Static browser assets.
    - `styles.css` - Homepage/game/auth styling, favorite tile/button states, admin/public game states, transcript layouts, and Edit-tab generating spinner animation.
    - `game-view.js` - Admin game-page prompt submit, favorite toggle API calls, realtime voice transcription (session mint + WebRTC stream + transcript events), bottom-tab behavior, transcript polling, and generating-state class toggling from server `eyeState`.
    - `game-live-reload.js` - Dev-only game-page polling via `/api/dev/reload-token/:versionId`.
    - `codex-view.js` - `/codex` selector wiring and transcript loading.
    - `codex-transcript-presenter.js` - Shared transcript presenter used by `/codex` and game pages.
  - `services/` - Filesystem, auth, build, prompt, and Codex-session orchestration.
    - `fsUtils.ts` - Shared fs/object/error helpers.
    - `adminAuth.ts` - Admin password verification, iron-session sealed cookies, fixed TTL, and login rate limiter.
    - `csrf.ts` - Same-origin + double-submit CSRF token issuance/validation.
    - `gameAssetAllowlist.ts` - Runtime-safe `/games/:versionId/dist/*` allowlist and sensitive-path blocking.
    - `gameVersions.ts` - Version ID validation, metadata parsing/writing (including `favorite`), lifecycle status normalization, and version listing.
    - `forkGameVersion.ts` - Fork copy + lineage metadata creation.
    - `tileColor.ts` - Shared readable tile-color generator used for fork metadata and backfills.
    - `promptExecution.ts` - Build-prompt loading, prompt composition, and `codex exec --json` runner.
    - `codexSessions.ts` - Codex session-file lookup plus JSONL parsing for user/assistant transcript turns and task lifecycle events.
    - `codexTurnInfo.ts` - Per-worktree runtime-state tracker that scans latest matching session JSONL by `session_meta.payload.cwd`, reads append-only bytes, and derives `eyeState` from task lifecycle events (with message-balance fallback for logs without task markers).
    - `openaiTranscription.ts` - OpenAI Realtime transcription session factory (`/v1/realtime/transcription_sessions`) that returns ephemeral client secrets for browser WebRTC transcription.
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
  - `v1-bounce/` - Initial bouncing-ball WebGL game implementation.
  - `d0cf7658-3371-4f01-99e2-ca90fc1899cf/` - Forked bouncing-ball variant.
- `tests/` - Vitest unit/integration coverage for app routes and core services, plus Playwright E2E specs under `tests/e2e/`.
- `playwright.config.ts` - Default E2E runner config (video off unless explicitly enabled).
- `docs/`
  - `overview.md` - High-level architecture and operational summary.
- `.env.example` - Template for required admin auth secrets.
- `conductor.json` - Conductor workspace startup config (`npm install`, `npm run dev`).
- `package.json` - NPM scripts and dependencies.
- `game-build-prompt.md` - Prompt prelude prepended to user prompt text before Codex execution.
- `game-plan.md` - Product requirements and milestones.

# Most important code paths

- Auth flow: `GET /auth` renders `renderAuthView()` with CSRF token; `POST /auth/login` validates CSRF + password hash + rate limits, sets an iron-session sealed admin cookie, and redirects; `POST /auth/logout` validates CSRF and clears the admin cookie.
- Homepage flow: `GET /` calls `listGameVersions()` and renders `renderHomepage()` with auth-aware top-right CTA (`Login` or `Auth`); logged-out mode filters to favorited versions and favorited tiles render with a yellow border.
- Game page flow: `GET /game/:versionId` validates availability, renders `renderGameView()` in admin/public mode, and only injects prompt/transcript UI plus CSRF/favorite data attributes for authenticated admins.
- Favorite toggle flow: `POST /api/games/:versionId/favorite` requires admin + CSRF, flips the `favorite` boolean in `metadata.json`, and returns the new state for `src/public/game-view.js` to reflect in the star button.
- Prompt fork flow: `POST /api/games/:versionId/prompts` requires admin + CSRF, forks via `createForkedGameVersion()`, sets lifecycle state to `created`, composes full prompt, launches Codex runner, persists `codexSessionId` as soon as observed, and transitions lifecycle to `stopped` or `error` when the run settles.
- Realtime voice transcription flow: `POST /api/transcribe` (admin + CSRF) mints an OpenAI Realtime transcription session and returns a short-lived `clientSecret`; `src/public/game-view.js` then exchanges SDP with `https://api.openai.com/v1/realtime?intent=transcription`, streams mic audio over WebRTC, and applies `conversation.item.input_audio_transcription.completed` text to the prompt input.
- Codex transcript/runtime flow: `/codex` and `/api/codex-sessions/:versionId` require admin; transcript API resolves metadata, derives runtime `eyeState` via `getCodexTurnInfo()` (JSONL task lifecycle detection), and returns user/assistant turns plus lifecycle/runtime state fields.
- Static/runtime serving flow: `/games/*` first passes `requireRuntimeGameAssetPathMiddleware()` so only runtime-safe `dist` assets are public; sensitive or dev files (including `dist/reload-token.txt`) return `404`.
- Dev reload flow: when `GAME_SPACE_DEV_LIVE_RELOAD=1`, `scripts/dev.ts` rewrites per-version `dist/reload-token.txt`; browser polling uses `/api/dev/reload-token/:versionId` instead of direct `/games` file access.

# Data stores

- `games/` - Primary persisted store (no external database).
  - `<version-id>/`
    - `metadata.json` - `{ id: string, parentId: string | null, createdTime: ISO-8601 string, tileColor?: "#RRGGBB", favorite?: boolean, codexSessionId?: string | null, codexSessionStatus?: "none" | "created" | "stopped" | "error" }`.
    - `src/main.ts` - Version gameplay source.
    - `dist/game.js` - Built runtime bundle served to clients.
    - `dist/reload-token.txt` - Dev-only rebuild token (read through `/api/dev/reload-token/:versionId` when dev live reload is enabled).
    - `node_modules/` - Per-version installed dependencies.
- `~/.codex/sessions/` - External local Codex store used for transcript/runtime-state lookup.
  - `YYYY/MM/DD/rollout-...-<session-id>.jsonl` - Session event log parsed for `session_meta` cwd matching, task lifecycle events, and user/assistant message turns.
- `.env` (local, gitignored) - Admin auth secrets.
  - `GAME_SPACE_ADMIN_PASSWORD_HASH` - `scrypt$<saltBase64>$<hashBase64>`.
  - `GAME_SPACE_ADMIN_SESSION_SECRET` - Session sealing secret used by iron-session for admin session cookies.
  - `OPENAI_API_KEY` - Server-side key used only to mint ephemeral Realtime transcription sessions.

# Architecture notes

- Execution isolation: each version owns its own source, dependencies, and built bundle under `games/<version-id>/`.
- Admin auth model: iron-session sealed, `HttpOnly`, `Secure`, `SameSite=Strict` session cookie with fixed 3-day TTL; unauthorized protected-route requests return `404`.
- CSRF model: same-origin enforcement plus double-submit token (cookie + hidden form field or `X-CSRF-Token` header).
- Realtime voice transcription model: browser never receives `OPENAI_API_KEY`; server mints short-lived client secrets via OpenAI Realtime transcription sessions using `gpt-4o-transcribe`, and the client streams mic audio directly to OpenAI over WebRTC.
- Prompt safety model: user prompt text is never shell-interpolated; `SpawnCodexRunner` passes full prompt bytes through stdin to `codex exec --json --dangerously-bypass-approvals-and-sandbox -`.
- Runtime-state derivation model: `codexTurnInfo.ts` keeps an in-memory tracker per worktree (`sessionPath`, append offset, partial-line buffer, task lifecycle counters, user/assistant counters, latest assistant metadata), scans for the newest matching JSONL by `session_meta.payload.cwd`, and sets `eyeState` to `generating` while `task_started` count exceeds terminal task events (`task_complete` and related terminal markers); otherwise `idle`. For legacy logs without task markers, it falls back to user/assistant message balance. When no tracker is active, lifecycle state maps fallback runtime state.
- Favorites model: each game version can be marked favorite in `metadata.json`; the homepage filters to favorites for logged-out users, while authenticated admins can toggle favorite state from the game-page star control.
- Tile-color model: `tileColor.ts` generates random `#RRGGBB` colors that satisfy a minimum 4.5:1 contrast ratio with white text (fallback `#1D3557`), and forks/seeded versions persist this value in `metadata.json`.
- Static serving model: Express serves shared `src/public/*`; `/games/*` is runtime-allowlisted and blocks metadata/source/config/dev artifacts.
- Dev live-reload model: token file stays on disk under each game `dist/`, but browser access is routed through `/api/dev/reload-token/:versionId` in dev mode.
- Deployment model: GitHub Actions deploys `main` to DigitalOcean over SSH using repository secrets and PM2 process management.
- PR video model: Playwright videos are opt-in per PR update; selectors come from PR metadata/template block (or `.github/video-tests.txt`), and workflow comments are edited in place.

# Testing

- Run lint: `npm run lint`
- Run type checking: `npm run typecheck`
- Run tests: `npm run test`
- Coverage focus:
  - Auth login/logout cookies, fixed TTL, CSRF checks, and brute-force backoff behavior.
  - Protected-route gating for `/codex`, transcript API, prompt API, and favorite toggle API.
  - Homepage branding/filter behavior (`Fountain` header/title, logged-out favorites-only view, and favorite tile styling).
  - Runtime-state derivation from Codex JSONL task lifecycle events and lifecycle-status fallback mapping.
  - `/games` runtime allowlist allow/deny behavior and dev reload-token API route.
  - Prompt fork/session lifecycle persistence flow and transcript parsing behavior.
  - Realtime transcription session creation route behavior (`200`, `502`, `503`) and game-page client WebRTC transcription wiring.
  - Game page client behavior for CSRF header inclusion, admin/public UI states, favorite-star toggling, and Edit-tab generating spinner class toggling.
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
  - While a Codex run is active for a game worktree, verify the `Edit` tab shows a spinner on the right and clears when generation completes.
  - Verify dev live reload by editing a game source file and observing browser refresh after rebuild token changes.
