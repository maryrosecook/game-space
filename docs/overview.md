# Project

Local-first game version browser and editor where every version is playable, forkable, and independently buildable.

Top three features:
- Filesystem-backed version catalog rendered as reverse-chronological responsive homepage tiles (`Infinity`), with hyphen-normalized labels and month/year timestamps; each tile opens into a playable centered portrait (`9:16`) WebGL runtime.
- Cookie-authenticated admin workflow (`/auth`) that unlocks prompt execution and Codex transcript access while keeping public gameplay (`/` and `/game/:versionId`) available without login.
- Prompt-to-fork execution flow that creates new game versions, launches Codex runs, and persists transcript session linkage for `/codex` and game-page transcript panels.

# Repo structure

- `src/` - Backend app, HTML rendering, browser assets, and service modules.
  - `app.ts` - Express app factory, route wiring, auth/CSRF enforcement, and static asset gating.
  - `server.ts` - HTTP server bootstrap and dotenv loading.
  - `views.ts` - Homepage/auth/game/codex HTML rendering.
  - `types.ts` - Shared metadata/version TypeScript types.
  - `public/` - Static browser assets.
    - `styles.css` - Homepage/game/auth styling (including responsive homepage tile wrapping), admin/public game states, and transcript layouts.
    - `game-view.js` - Admin game-page prompt submit/CSRF header, bottom-tab behavior, speech-to-text UX, and transcript polling.
    - `game-live-reload.js` - Dev-only game-page polling via `/api/dev/reload-token/:versionId`.
    - `codex-view.js` - `/codex` selector wiring and transcript loading.
    - `codex-transcript-presenter.js` - Shared transcript presenter used by `/codex` and game pages.
  - `services/` - Filesystem, auth, build, prompt, and Codex-session orchestration.
    - `fsUtils.ts` - Shared fs/object/error helpers.
    - `adminAuth.ts` - Admin password verification, iron-session sealed cookies, fixed TTL, and login rate limiter.
    - `csrf.ts` - Same-origin + double-submit CSRF token issuance/validation.
    - `gameAssetAllowlist.ts` - Runtime-safe `/games/:versionId/dist/*` allowlist and sensitive-path blocking.
    - `gameVersions.ts` - Version ID validation, metadata parsing/writing, and version listing.
    - `forkGameVersion.ts` - Fork copy + lineage metadata creation.
    - `promptExecution.ts` - Build-prompt loading, prompt composition, and `codex exec --json` runner.
    - `codexSessions.ts` - Codex session-file lookup and JSONL transcript parsing (user/assistant turns only).
    - `gameBuildPipeline.ts` - Per-game dependency install/build and source-path-to-version mapping.
    - `devLiveReload.ts` - Per-version reload-token pathing/writes used by the dev watch loop.
- `scripts/` - Local automation entrypoints.
  - `dev.ts` - Initial build, per-version reload-token seeding, backend spawn with dev live-reload flag, and debounced watch rebuild loop.
  - `build-games.ts` - One-shot build for all game directories.
- `.github/workflows/` - CI/CD workflow automation.
  - `deploy-main.yml` - Deploys `main` to the DigitalOcean server over SSH and restarts/starts `game-space` with PM2.
- `games/` - Versioned game sandboxes (one runtime/build boundary per version).
  - `v1-bounce/` - Initial bouncing-ball WebGL game implementation.
  - `d0cf7658-3371-4f01-99e2-ca90fc1899cf/` - Forked bouncing-ball variant.
  - `elm-cloud-sage/` - Fork rendering 1000 animated shimmering bowls via a point-sprite WebGL shader.
- `tests/` - Vitest unit/integration coverage for app routes and core services.
- `docs/`
  - `overview.md` - High-level architecture and operational summary.
- `.env.example` - Template for required admin auth secrets.
- `conductor.json` - Conductor workspace startup config (`npm install`, `npm run dev`).
- `package.json` - NPM scripts and dependencies.
- `game-build-prompt.md` - Prompt prelude prepended to user prompt text before Codex execution.
- `game-plan.md` - Product requirements and milestones.

# Most important code paths

- Auth flow: `GET /auth` renders `renderAuthView()` with CSRF token; `POST /auth/login` validates CSRF + password hash + rate limits, sets an iron-session sealed admin cookie, and redirects; `POST /auth/logout` validates CSRF and clears the admin cookie.
- Homepage flow: `GET /` calls `listGameVersions()` and renders `renderHomepage()` with the `Infinity` title, auth-aware top-right CTA (`Login` or `Auth`), hyphen-to-space display labels, and month/year timestamps.
- Game page flow: `GET /game/:versionId` validates game availability, renders `renderGameView()` in admin/public mode, and only injects prompt/transcript UI plus CSRF data token for authenticated admins.
- Prompt fork flow: `POST /api/games/:versionId/prompts` requires admin + CSRF, forks via `createForkedGameVersion()`, composes full prompt, launches Codex runner, and persists `codexSessionId` metadata as soon as available.
- Codex transcript flow: `/codex` and `/api/codex-sessions/:versionId` require admin; transcript API resolves metadata `codexSessionId`, reads session JSONL, and returns user/assistant turns.
- Static/runtime serving flow: `/games/*` first passes `requireRuntimeGameAssetPathMiddleware()` so only runtime-safe `dist` assets are public; sensitive or dev files (including `dist/reload-token.txt`) return `404`.
- Dev reload flow: when `GAME_SPACE_DEV_LIVE_RELOAD=1`, `scripts/dev.ts` rewrites per-version `dist/reload-token.txt`; browser polling uses `/api/dev/reload-token/:versionId` instead of direct `/games` file access.

# Data stores

- `games/` - Primary persisted store (no external database).
  - `<version-id>/`
    - `metadata.json` - `{ id: string, parentId: string | null, createdTime: ISO-8601 string, codexSessionId?: string | null }`.
    - `src/main.ts` - Version gameplay source.
    - `dist/game.js` - Built runtime bundle served to clients.
    - `dist/reload-token.txt` - Dev-only rebuild token (read through `/api/dev/reload-token/:versionId` when dev live reload is enabled).
    - `node_modules/` - Per-version installed dependencies.
- `~/.codex/sessions/` - External local Codex store used for transcript lookup.
  - `YYYY/MM/DD/rollout-...-<session-id>.jsonl` - Session event log parsed for `user` and `assistant` message text.
- `.env` (local, gitignored) - Admin auth secrets.
  - `GAME_SPACE_ADMIN_PASSWORD_HASH` - `scrypt$<saltBase64>$<hashBase64>`.
  - `GAME_SPACE_ADMIN_SESSION_SECRET` - Session sealing secret used by iron-session for admin session cookies.

# Architecture notes

- Execution isolation: each version owns its own source, dependencies, and built bundle under `games/<version-id>/`.
- Admin auth model: iron-session sealed, `HttpOnly`, `Secure`, `SameSite=Strict` session cookie with fixed 3-day TTL; unauthorized protected-route requests return `404`.
- CSRF model: same-origin enforcement plus double-submit token (cookie + hidden form field or `X-CSRF-Token` header).
- Prompt safety model: user prompt text is never shell-interpolated; `SpawnCodexRunner` passes full prompt bytes through stdin to `codex exec --json --dangerously-bypass-approvals-and-sandbox -`.
- Static serving model: Express serves shared `src/public/*`; `/games/*` is runtime-allowlisted and blocks metadata/source/config/dev artifacts.
- Dev live-reload model: token file stays on disk under each game `dist/`, but browser access is routed through `/api/dev/reload-token/:versionId` when dev mode is enabled.
- Deployment model: GitHub Actions deploys `main` to DigitalOcean over SSH using repository secrets and PM2 process management.

# Testing

- Run lint: `npm run lint`
- Run type checking: `npm run typecheck`
- Run tests: `npm run test`
- Coverage focus:
  - Auth login/logout cookies, fixed TTL, CSRF checks, and brute-force backoff behavior.
  - Protected-route gating for `/codex`, transcript API, and prompt API.
  - `/games` runtime allowlist allow/deny behavior and dev reload-token API route.
  - Prompt fork/session persistence flow and transcript parsing behavior.
  - Game page client behavior for CSRF header inclusion and admin/public UI states.
- End-to-end/manual flow:
  - Run `npm run dev`.
  - Verify logged-out behavior: `/` and `/game/:versionId` are playable, `/codex` and prompt API are unavailable.
  - Verify logged-in behavior via `/auth`: prompt controls/transcripts appear on game pages; `/codex` loads and transcript API responds.
  - Verify dev live reload by editing a game source file and observing browser refresh after rebuild token changes.
