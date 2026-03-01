# Security Invariants (Phase 0 Baseline)

Snapshot date: 2026-02-28

Purpose:
- Define the security behavior that must be preserved during the Next.js port.
- Serve as the Phase 0 baseline for parity checks and regression tests.

Scope:
- Runtime behavior in the current Express app.
- Invariants backed by code and tests, not aspirational behavior.

## 1) Admin authorization semantics

Invariant:
- Unauthorized access to admin-protected routes must return `404 Not found` (not `401`/`403`).

Current enforcement:
- `requireAdminOr404` middleware returns `404` when not authenticated as admin.
- `/auth/logout` and `/auth/provider` also perform explicit admin checks and return `404`.

References:
- `src/services/adminAuth.ts` (`requireAdminOr404`, `isAdminAuthenticated`)
- `src/app.ts` (`/auth/logout`, `/auth/provider`, admin API wiring)
- `tests/app.integration.test.ts` (unauthenticated `404` assertions across admin routes)

## 2) CSRF semantics

Invariant:
- Admin mutations require valid CSRF.
- Valid CSRF means both:
1. Same-origin pass:
   - Request must provide `Origin` or `Referer`.
   - If `Origin` is present, its host must match request `Host`.
   - Otherwise `Referer` host must match request `Host`.
2. Double-submit token match (cookie token equals request token via timing-safe compare).

Request token sources:
- `X-CSRF-Token` header.
- Form field `csrfToken`.

Route class behavior:
- Auth form mutations (`POST /auth/login`, `/auth/logout`, `/auth/provider`) call CSRF validation directly and render HTML `403` error state on failure.
- JSON admin `POST`/`DELETE` APIs (including `POST /api/transcribe`) use `requireValidCsrf` and return JSON `403` on failure.

References:
- `src/services/csrf.ts`
- `src/app.ts` (auth mutation handlers and admin mutation API handlers)
- `tests/adminAuth.test.ts` (CSRF helper behavior)
- `tests/app.integration.test.ts` (route-level CSRF fail/pass coverage)

## 3) Session cookie properties and lifetime

Invariant:
- Admin session uses a sealed cookie with fixed TTL and strict cookie attributes.

Cookie contract:
- Name: `game_space_admin_session`
- Attributes: `Path=/`, `HttpOnly`, `Secure`, `SameSite=Strict`, `Max-Age=<fixed ttl>`
- Logout clears the same cookie with `Max-Age=0` and expired date.

Token contract:
- Payload includes subject/version/issued-at/expiry.
- Validation rejects malformed, tampered, or expired tokens.
- Session lifetime is fixed (non-sliding).

References:
- `src/services/adminAuth.ts` (`setAdminSessionCookie`, `clearAdminSessionCookie`, `createAdminSessionToken`, `readAdminSessionToken`)
- `tests/adminAuth.test.ts` (token validation behavior)
- `tests/app.integration.test.ts` (set-cookie assertions for login/logout)

## 4) Login throttling behavior

Invariant:
- Login attempts are throttled by client IP with deterministic defaults and reset on success.

Current behavior:
- Key: `request.ip` (fallback `"unknown"`).
- Default policy:
1. `maxFailures = 5`
2. `windowMs = 10 minutes`
3. `blockMs = 5 minutes`
- Missing or invalid password counts as failed attempt.
- While blocked, login returns `429`.
- Successful login clears limiter state for that key.

References:
- `src/services/adminAuth.ts` (`LoginAttemptLimiter`)
- `src/app.ts` (`POST /auth/login`)
- `tests/adminAuth.test.ts` (rate limiter behavior)
- `tests/app.integration.test.ts` (login status contract coverage)

## 5) Security route classes (must remain stable)

Admin-read:
- Admin required, unauthorized => `404`, no CSRF for `GET`.

Admin-mutation:
- Admin required, unauthorized => `404`, CSRF required.
- Includes admin `POST`/`DELETE` APIs even when they do not persist local files (for example, `POST /api/transcribe`).

Admin-execution:
- Subset of admin-mutation routes that can trigger Codex/Claude execution:
1. `POST /api/ideas/generate`
2. `POST /api/ideas/:ideaIndex/build`
3. `POST /api/games/:versionId/prompts`

Invariant:
- Admin-execution routes remain under both admin auth and CSRF protections.

Primary route matrix:
- `docs/nextjs-port-plan.md` (Route-by-route contract matrix).

## 6) Regression expectations

A security regression is any change that violates one or more invariants above, including:
- Returning non-`404` responses for unauthorized admin routes.
- Accepting admin mutations without CSRF.
- Relaxing session cookie attributes or TTL semantics.
- Altering login throttle semantics without explicit security design approval.
