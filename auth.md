# Prompt + Transcript Cookie Auth Plan (Single Deployment)

## Objective

Protect prompt-generation and transcript-reading routes using server-validated admin session cookies, while keeping gameplay routes public.

## Requirements

- Keep a single deployment.
- Keep public access to gameplay routes (`/`, `/game/:versionId`).
- Add a simple auth screen with login/logout state.
- Add a `Login` button in the top-right of the homepage that links to the auth screen.
- Require admin auth for:
  - `POST /api/games/:versionId/prompts`
  - `GET /codex`
  - `GET /api/codex-sessions/:versionId`
- Lock down static `/games` serving so only runtime-safe built assets are public.
- Use cookie-based session auth only (no edge/private-network gating in this phase).
- Load secrets via the `dotenv` library from a local `.env` file.
- Store auth secrets in `.env` (never commit).
- Use a fixed session TTL of exactly 3 days.
- Add CSRF protections for all state-changing authenticated endpoints.
- Do not store auth secrets in `localStorage`.

## Non-goals

- Edge/proxy route gating.
- Private admin network path (VPN/SSH/identity edge) requirements.
- Multi-user accounts or role management.
- OAuth/OIDC integration.
- Re-architecting game build or Codex execution internals.

## Architecture / Approach

### 1) Add server-side admin login/logout with secure session cookies

- Load `dotenv` at server startup so auth config is available from `.env`.
- Add an auth page route (for example `GET /auth`) that renders:
  - login form when logged out
  - logout action when logged in
- Add login and logout handlers (for example `POST /auth/login`, `POST /auth/logout`) to validate password and manage session cookie lifecycle.
- On successful login, issue admin session cookie with:
  - `HttpOnly`
  - `Secure`
  - `SameSite=Strict`
- Set cookie lifetime to exactly 3 days (`259200` seconds / `259200000` ms).
- Logout clears the cookie and returns to auth screen.

### 2) Enforce cookie auth on protected routes

- Add auth middleware to check admin session validity.
- Apply middleware to:
  - `POST /api/games/:versionId/prompts`
  - `GET /codex`
  - `GET /api/codex-sessions/:versionId`
- Return `404` on auth failure to reduce route discoverability.
- Keep existing route validation logic and behavior for authenticated requests.

### 3) Lock down static game asset serving

- Restrict public `GET /games/*` exposure to runtime-safe build output only (for example, `dist/game.js` and required runtime `dist/*` assets).
- Explicitly deny access to sensitive/non-runtime files under each game directory, including:
  - `metadata.json`
  - `src/**`
  - `package.json`
  - `node_modules/**`
  - dev-only build artifacts such as `dist/reload-token.txt`
- Keep gameplay rendering functional with the allowlisted runtime assets.

### 4) Add client auth state + UI gating

- Add top-right homepage `Login` button linking to `/auth` (or equivalent auth route).
- Render prompt composer only when admin session is active.
- Render transcript entry points/panel only when admin session is active.
- Keep logged-out gameplay usable and stable when prompt/transcript controls are hidden.
- login/logout be pure HTML form posts (`/auth/login`, `/auth/logout`)
- signed-cookie sessions for admin auth

### 5) Add CSRF and baseline auth abuse protections

- Apply CSRF checks to state-changing auth endpoints (at minimum: login, logout, prompt submission).
- Enforce `Origin`/`Referer` allow checks and/or synchronizer/double-submit CSRF token pattern.
- Add login attempt rate limiting/backoff.
- Use fixed 3-day session TTL.
- Require strong admin secret configuration via environment variables.
- Keep auth/session logging for failed/successful admin events (without logging secrets).

## Data / Config Changes

- Add `dotenv` dependency and bootstrap loading early in server startup.
- New `.env` keys:
  - `GAME_SPACE_ADMIN_PASSWORD_HASH`.
  - `GAME_SPACE_ADMIN_SESSION_SECRET`.
- Keep `.env` in `.gitignore`.
- No database migration required.
- Session TTL is a fixed constant (3 days), not a runtime knob in this plan.

## Credential Storage Clarification

- The plaintext admin password is not stored by the app.
- You choose a password out-of-band and store only its hash in `GAME_SPACE_ADMIN_PASSWORD_HASH` inside `.env`.
- `GAME_SPACE_ADMIN_SESSION_SECRET` is separate from the password hash and is used only to sign/verify session cookies.
- `.env` is local-only and gitignored; never expose these values in client code, localStorage, logs, or repository files.

## Testing Strategy

- Integration tests (server):
  - Login succeeds with valid credentials and sets cookie attributes.
  - Login fails with invalid credentials.
  - Logout invalidates session.
  - Session cookie lifetime is exactly 3 days.
  - CSRF failures are rejected on protected state-changing endpoints.
  - Protected prompt route returns `404` without session.
  - Protected transcript routes return `404` without session.
  - Protected routes succeed with valid session.
  - Static serving denies non-runtime game files and allows required runtime `dist` assets.
- Client behavior tests:
  - Homepage shows a top-right `Login` button linking to the auth screen.
  - Non-admin view does not render prompt/transcript controls.
  - Admin view renders prompt/transcript controls.
  - Non-admin gameplay remains functional.
- Manual validation:
  - Public browser can play games.
  - Public browser cannot access `/codex` or transcript API.
  - Authenticated admin can prompt and view transcripts.

## Rollout / Validation

- Phase 1: implement login/logout/session endpoints and middleware.
- Phase 2: implement static `/games` allowlist and deny rules.
- Phase 3: implement UI gating based on session status.
- Phase 4: implement CSRF protections on state-changing endpoints.
- Phase 5: run lint, typecheck, and tests.
- Phase 6: deploy and verify admin/non-admin flows end to end.
- Phase 7: rotate admin secret and document operational procedure.

## Risks and Mitigations

- Risk: no edge/network-level protection in this phase.
  - Mitigation: strict app-layer auth, short TTL sessions, rate limiting, strong secrets.
- Risk: brute-force login attempts.
  - Mitigation: rate limiting and lockout/backoff policy.
- Risk: cookie theft/session hijack.
  - Mitigation: `HttpOnly`, `Secure`, `SameSite=Strict`, short TTL, HTTPS only.
- Risk: CSRF against authenticated admin browser.
  - Mitigation: explicit CSRF checks (Origin/Referer and token strategy) on state-changing endpoints.
- Risk: data leakage via over-broad static `/games` serving.
  - Mitigation: strict static asset allowlist for runtime files and explicit deny rules for source/config/dev artifacts.
- Risk: XSS enabling unauthorized actions.
  - Mitigation: avoid `localStorage` auth, apply CSP and output/input hardening.
