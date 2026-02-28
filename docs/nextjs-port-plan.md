# Next.js Port Plan (Phased, Security-Preserving)

## Goals and constraints
- Port frontend to **TypeScript + React** first, then adopt **Next.js** in a later phase.
- Preserve login behavior and all backend security guarantees for admin-only and CSRF-protected routes.
- Keep game storage exactly where and how it is now (`games/<versionId>/...`, metadata/build artifacts unchanged).
- Keep idea storage exactly where and how it is now (`ideas.json` at repo root, same schema and semantics).
- Maintain current user flows during migration (home, game view, auth, codex, ideas).

## Current-state inventory (must be preserved)
- Server/runtime
  - Express app and route wiring in `src/app.ts`; server bootstrap in `src/server.ts`.
- Security
  - Session auth, password verification, rate limiting, admin guard in `src/services/adminAuth.ts`.
  - CSRF issuance/validation middleware and helpers in `src/services/csrf.ts`.
  - Runtime game asset allowlist middleware in `src/services/gameAssetAllowlist.ts`.
- Data layout
  - Games and versions under `games/` with metadata and dist outputs managed by `src/services/gameVersions.ts` and related services.
  - Ideas file access via `src/services/ideas.ts`, defaulting to root `ideas.json`.
- UI rendering
  - Server-rendered HTML from `src/views.ts` + browser scripts in `src/public/*.js`.

## Audited behavior inventory to retain (full app surface)
- Public pages/routes
  - `GET /` home list (admin sees all versions; non-admin sees favorites only).
  - `GET /game/:versionId` game player page with admin-only tool panels.
  - Static assets: `/public/*`, `/games/*` (with runtime allowlist middleware semantics).
- Auth/session routes
  - `GET /auth`, `POST /auth/login`, `POST /auth/logout`, `POST /auth/provider`.
  - Login protections: CSRF required, invalid-password throttling, admin cookie issuance/clearing.
- Admin pages/routes
  - `GET /codex`, `GET /ideas`.
- Admin JSON APIs (must keep auth/CSRF gates as-is)
  - Ideas: `GET /api/ideas`, `POST /api/ideas/generate`, `POST /api/ideas/:ideaIndex/build`, `DELETE /api/ideas/:ideaIndex`.
  - Sessions/transcription: `GET /api/codex-sessions/:versionId`, `POST /api/transcribe`.
  - Game mutations: `POST /api/games/:versionId/favorite`, `POST /api/games/:versionId/tile-snapshot`, `DELETE /api/games/:versionId`, `POST /api/games/:versionId/prompts`.
  - Dev-only route when enabled: `GET /api/dev/reload-token/:versionId`.
- Input-validation and response semantics
  - `versionId` safety checks, directory existence checks, metadata existence checks.
  - PNG data URL validation (prefix, base64 format, byte limits, round-trip check).
  - Distinct status behavior (`400/401/403/404/409/429/502/503`) and JSON error message contracts.
- Background/async behaviors
  - Prompt submit forks a version, persists session id/status transitions, and conditionally captures tile snapshot.
  - Idea generation cancellation semantics (new request aborts previous).
  - Optional startup game build and optional live reload token behavior.

## Migration strategy overview
1. **Phase 0: Lock behavior with tests + route contract map** (no framework change).
2. **Phase 1: React + TypeScript UI inside current Express app** (backend unchanged).
3. **Phase 2: Introduce Next.js alongside Express (strangler pattern)**.
4. **Phase 3: Move API/auth logic to Next server runtime** (preserve invariants).
5. **Phase 4: Cut over, harden, and decommission Express rendering path**.

---

## Phase 0 — Baseline and safety net
- Deliverables
  - Route-by-route contract matrix:
    - path, method, auth requirement, CSRF requirement, response status matrix, payload shape, side effects.
  - Security invariant document:
    - “non-admin gets 404 on admin routes”,
    - “state-changing admin routes require valid CSRF”,
    - session cookie properties,
    - login attempt throttling behavior.
  - Snapshot of filesystem invariants:
    - exact `games/` and `ideas.json` path usage and format contracts.
  - Behavior matrix generated from code + tests covering all routes above (including status code differences by auth state).
- Test additions (before refactor)
  - Expand E2E coverage for:
    - login/logout flow,
    - admin/non-admin route access controls,
    - CSRF failure/success cases,
    - ideas create/build/delete,
    - game view/load and protected API calls.
  - Add contract tests for status/body parity on key endpoints.
  - Add parity fixtures for:
    - cookie attributes and TTL behavior,
    - CSRF cookie/header/form acceptance rules,
    - admin guard 404-vs-401 semantics,
    - fork metadata/session-state transitions.
- Exit criteria
  - New tests fail on intentional security regression.
  - CI baseline stable.

## Phase 1 — Frontend to React + TypeScript (still Express)
- Architecture
  - Introduce React entrypoints per page (home, auth, game, codex, ideas).
  - Keep Express routes and existing backend services untouched.
  - Replace server HTML builders in `src/views.ts` incrementally with React SSR output (or embedded app shell + hydrated islands).
- Implementation steps
  - Add TS/React build pipeline (Vite or existing tooling extension), emitting assets consumed by Express.
  - Move `src/public/*.js` behavior into typed React modules/hooks.
  - Create shared typed API client definitions for existing JSON endpoints.
  - Preserve route URLs and response contracts exactly.
- Security handling
  - CSRF token propagation remains server-issued; React forms/actions must submit token exactly as today.
  - No auth logic migration yet; Express `adminAuth` + `csrf` services remain source of truth.
- Exit criteria
  - UX parity on migrated pages.
  - Existing auth/CSRF/access-control tests unchanged and green.

## Phase 2 — Introduce Next.js in parallel (no critical cutover yet)
- Architecture
  - Add Next app in repo (e.g., `next-app/` initially) with TypeScript strict mode.
  - Run Next and Express together behind a single dev/prod entrypoint (proxy/rewrites).
  - Route ownership split:
    - Next owns selected read-only pages first,
    - Express remains owner for sensitive auth + mutation APIs initially.
- Implementation steps
  - Rehost React UI in Next App Router pages while preserving URL structure.
  - Implement compatibility layer for static game assets (`/games/*`) using existing allowlist semantics.
  - Keep data services in shared server-only package/module to avoid duplication.
- Exit criteria
  - Same URLs render via Next where migrated.
  - No change in security-sensitive endpoint behavior.

## Phase 3 — Backend port to Next server setup (security-first)
- API migration order
  1. Non-sensitive read endpoints.
  2. Auth/session endpoints.
  3. Admin mutation endpoints (`ideas`, `provider`, build/fork operations).
- Security parity requirements (must be explicit in code review checklist)
  - Session cookie attributes match or tighten current settings (HttpOnly, Secure in prod, SameSite, Path, max-age semantics).
  - Password verification and login throttling algorithm/threshold preserved.
  - Admin guard preserves “404 for unauthenticated/unauthorized” behavior where currently used.
  - CSRF issuance + validation semantics preserved for every mutating admin route.
  - Input validation parity for all route params and bodies (`versionId`, indices, base64 payloads, etc.).
  - Filesystem access constraints preserved (`isSafeVersionId`, allowlist behavior, path normalization).
  - Preserve rate-limit keying behavior for login attempts (IP-based fallback behavior included).
  - Preserve anti-leak behavior on privileged routes (no auth detail disclosure where 404 is expected).
- Data/path parity requirements
  - Continue reading/writing root `ideas.json` with same schema.
  - Continue reading/writing under existing `games/` hierarchy with unchanged metadata structure.
  - No path migration, no schema migration.
- Operational concerns
  - Ensure long-running/background tasks (prompt execution, snapshot capture, idea generation cancellation) remain reliable in Next runtime choice (prefer Node runtime routes, not Edge).
  - Preserve startup/game-build behavior currently controlled in server app options.
  - Keep Node runtime for all file-system and child-process routes (`spawn`, metadata IO, game builds).
- Exit criteria
  - Endpoint contract tests pass against Next handlers.
  - Security regression suite green.

## Phase 4 — Cutover and cleanup
- Switch primary server entrypoint to Next.
- Keep temporary compatibility proxy for any unmigrated paths, then remove.
- Remove obsolete Express view-rendering and static client scripts after parity confirmed.
- Final hardening
  - Threat-model review focused on auth, CSRF, path traversal, and file write boundaries.
  - Load/perf smoke tests on login and admin workflows.

---

## Cross-phase guardrails
- Feature flags
  - Gate each migrated surface with runtime flags for instant rollback.
- Compatibility harness
  - Dual-run checker (old vs new endpoint) in non-prod to diff status codes and payload shape.
- Observability
  - Structured audit logs for auth attempts, CSRF failures, admin mutations.
  - Alerting thresholds for auth failures and 5xx on critical routes.
- Rollback plan
  - One-command switch back to Express-owned path handling until parity restored.

## Suggested work breakdown (minimal-risk order)
1. Baseline tests/contracts/security invariants.
2. React+TS UI migration under Express.
3. Next app scaffold + partial page ownership.
4. Auth/session migration with exhaustive tests.
5. Admin mutation APIs migration.
6. Final cutover + cleanup.

## Definition of done
- Same URL map and user workflows.
- Same or stricter security guarantees on all protected routes.
- Same `games/` and `ideas.json` storage paths + structures.
- Green unit/integration/E2E suites with added security and contract coverage.
- Route-contract diff report shows parity (or intentional, documented tightening only).
