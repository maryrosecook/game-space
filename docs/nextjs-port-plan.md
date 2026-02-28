# Next.js Port Plan (Phased, Security-Preserving)

## Goals and constraints
- Port frontend to **TypeScript + React** first, then adopt **Next.js** in a later phase.
- Preserve login behavior and all backend security guarantees for admin-only and CSRF-protected routes.
- Keep game storage exactly where and how it is now (`games/<versionId>/...`, metadata/build artifacts unchanged).
- Keep idea storage exactly where and how it is now (`ideas.json` at repo root, same schema and semantics).
- Maintain current user flows during migration (home, game view, auth, codex, ideas).
- Do this without feature flags.

## Phase-shaping decisions
- Phase 1 routing decision: **do not introduce React Router**.
  - Express continues to own URL routing in Phase 1.
  - Each existing page route (`/`, `/auth`, `/game/:versionId`, `/codex`, `/ideas`) gets a React entrypoint/hydration surface.
  - Rationale: preserves URL/HTTP semantics and avoids adding a second router before Next takes over routing.
- Parallel servers decision: **viable, with strict guardrails**.
  - Keep one browser-visible origin/port; do not expose separate user-facing ports for Express vs Next.
  - Run Express as the front door during transition and proxy only explicitly-owned Next page paths.
  - Keep auth and mutation APIs on Express until their migration phase is complete.
  - This is manageable if route ownership is explicit and contract tests run on each moved route.

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

## Route-by-route contract matrix (must be preserved)

### Contract columns
- `Auth / 404`: required auth behavior; for admin-only routes this means preserving current **404-on-unauthorized** behavior.
- `CSRF`: whether request must pass current CSRF validation.
- `Exec`: whether route can trigger backend codegen execution (Codex/Claude).
- `Mutates`: whether route persists/deletes server-side state.
- `Status contract`: key statuses that must remain semantically equivalent.

| Route | Auth / 404 | CSRF | Exec | Mutates | Status contract |
| --- | --- | --- | --- | --- | --- |
| `GET /` | Public | No | No | No | `200` |
| `GET /game/:versionId` | Public | No | No | No | `200`, `400`, `404`, `503` |
| `GET /auth` | Public | No | No | No | `200` |
| `POST /auth/login` | Public | Yes | No | Session + CSRF cookie issuance | `303`, `401`, `403`, `429` |
| `POST /auth/logout` | Admin-only (`404` when not admin) | Yes | No | Session clear + CSRF cookie issuance | `303`, `403`, `404` |
| `POST /auth/provider` | Admin-only (`404` when not admin) | Yes | No | In-memory provider selection | `303`, `400`, `403`, `404` |
| `GET /codex` | Admin-only (`404` when not admin) | No | No | No | `200`, `404` |
| `GET /ideas` | Admin-only (`404` when not admin) | No | No | No | `200`, `404` |
| `GET /api/ideas` | Admin-only (`404` when not admin) | No | No | No | `200`, `404` |
| `POST /api/ideas/generate` | Admin-only (`404` when not admin) | Yes | Yes (idea generation command) | Writes `ideas.json`; aborts prior generation | `201`, `409`, `404` |
| `POST /api/ideas/:ideaIndex/build` | Admin-only (`404` when not admin) | Yes | Yes (Codex/Claude run via `submitPromptForVersion`) | Writes `ideas.json`; forks game version | `202`, `400`, `404`, `503` |
| `DELETE /api/ideas/:ideaIndex` | Admin-only (`404` when not admin) | Yes | No | Writes `ideas.json` | `200`, `400`, `404` |
| `GET /api/codex-sessions/:versionId` | Admin-only (`404` when not admin) | No | No | No | `200`, `400`, `404` |
| `POST /api/transcribe` | Admin-only (`404` when not admin) | Yes | No | No persistent write | `200`, `404`, `502`, `503` |
| `POST /api/games/:versionId/favorite` | Admin-only (`404` when not admin) | Yes | No | Writes `games/<id>/metadata.json` | `200`, `400`, `404` |
| `POST /api/games/:versionId/tile-snapshot` | Admin-only (`404` when not admin) | Yes | No | Writes `games/<id>/snapshots/tile.png` | `200`, `400`, `404` |
| `DELETE /api/games/:versionId` | Admin-only (`404` when not admin) | Yes | No | Deletes `games/<id>/` | `200`, `400`, `404` |
| `POST /api/games/:versionId/prompts` | Admin-only (`404` when not admin) | Yes | Yes (Codex/Claude run via `submitPromptForVersion`) | Forks game + metadata/session state updates | `202`, `400`, `404` |
| `GET /api/dev/reload-token/:versionId` (dev-only) | Public | No | No | No | `200`, `400`, `404` |
| `GET /public/*` | Public | No | No | No | Static file behavior parity |
| `GET /games/*` | Public + runtime allowlist constraints | No | No | No | Allowlist + denylist semantics including protected-path `404`s |

### Security class clarifications
- `Admin-read` routes: admin required, unauthorized must remain `404`, CSRF not required for `GET`.
- `Admin-mutation` routes: admin required, unauthorized must remain `404`, and CSRF required.
- `Admin-execution` routes (explicit subset that can trigger Codex/Claude backend work):
  - `POST /api/ideas/generate`
  - `POST /api/ideas/:ideaIndex/build`
  - `POST /api/games/:versionId/prompts`
- Requirement: all `Admin-execution` routes stay under full admin + CSRF controls even if wording elsewhere says only “state-changing”.

## Migration strategy overview
1. **Phase 0: Lock behavior with tests + this contract matrix** (no framework change).
2. **Phase 1: React + TypeScript UI inside current Express app** (backend unchanged, no React Router).
3. **Phase 2: Introduce Next.js behind one front door (Express + Next strangler routing)**.
4. **Phase 3: Move API/auth logic to Next server runtime** (preserve invariants).
5. **Phase 4: Cut over, harden, and decommission Express rendering path**.

---

## Phase 0 — Baseline and safety net
- Deliverables
  - Keep this route contract matrix as the source of truth and validate it against code/tests.
  - Security invariant doc covering:
    - “non-admin gets 404 on admin routes”,
    - CSRF requirements by route class,
    - session cookie properties,
    - login attempt throttling behavior.
  - Filesystem invariant snapshot:
    - exact `games/` and `ideas.json` path usage and format contracts.
- Test additions (before refactor)
  - Expand E2E coverage for:
    - login/logout flow,
    - admin/non-admin route access controls,
    - CSRF failure/success cases,
    - ideas create/build/delete,
    - game view/load and protected API calls.
  - Add missing E2E path for “admin submits a build prompt and backend starts a Codex/Claude-driven game change” (currently not present in `tests/e2e/*`).
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
  - Replace server HTML builders in `src/views.ts` incrementally with React-rendered shells plus hydration.
  - Route handling remains server-driven by Express; no client-side router introduced.
- Implementation steps
  - Add TS/React build pipeline emitting assets consumed by Express.
  - Move `src/public/*.js` behavior into typed React modules/hooks.
  - Create shared typed API client definitions for existing JSON endpoints.
  - Preserve route URLs and response contracts exactly.
- Security handling
  - CSRF token propagation remains server-issued; React forms/actions submit token exactly as today.
  - No auth logic migration yet; Express `adminAuth` + `csrf` services remain source of truth.
- Exit criteria
  - UX parity on migrated pages.
  - Existing auth/CSRF/access-control tests unchanged and green.

## Phase 2 — Introduce Next.js in parallel (single public origin)
- Architecture
  - Add Next app in repo with TypeScript strict mode.
  - Keep a single public origin/port; Express proxies selected page routes to Next.
  - Route ownership split:
    - Next owns selected read-only pages first,
    - Express remains owner for auth + mutation APIs initially.
- Implementation steps
  - Rehost React UI in Next App Router pages while preserving URL structure.
  - Implement compatibility layer for static game assets (`/games/*`) using existing allowlist semantics.
  - Keep data services in shared server-only modules to avoid duplication.
- Exit criteria
  - Same URLs render via Next where migrated.
  - No change in security-sensitive endpoint behavior.

## Phase 3 — Backend port to Next server setup (security-first)
- API migration order
  1. Non-sensitive read endpoints.
  2. Auth/session endpoints.
  3. Admin mutation + execution endpoints (`ideas`, provider selection, build/fork operations).
- Security parity requirements (explicit code-review checklist)
  - Session cookie attributes match or tighten current settings (HttpOnly, Secure in prod, SameSite, Path, max-age semantics).
  - Password verification and login throttling algorithm/threshold preserved.
  - Admin guard preserves `404` behavior for unauthorized users where currently used.
  - CSRF issuance + validation semantics preserved for every admin-mutation/admin-execution route.
  - Input validation parity for all route params and bodies (`versionId`, indices, base64 payloads, etc.).
  - Filesystem access constraints preserved (`isSafeVersionId`, allowlist behavior, path normalization).
  - Preserve rate-limit keying behavior for login attempts (IP-based fallback behavior included).
  - Preserve anti-leak behavior on privileged routes (no auth detail disclosure where `404` is expected).
- Data/path parity requirements
  - Continue reading/writing root `ideas.json` with same schema.
  - Continue reading/writing under existing `games/` hierarchy with unchanged metadata structure.
  - No path migration, no schema migration.
- Operational concerns
  - Ensure long-running/background tasks (prompt execution, snapshot capture, idea generation cancellation) remain reliable in Next Node runtime.
  - Preserve startup/game-build behavior currently controlled in server app options.
  - Keep Node runtime for all file-system and child-process routes.
- Exit criteria
  - Endpoint contract tests pass against Next handlers.
  - Security regression suite green.

## Phase 4 — Cutover and cleanup
- Switch primary server entrypoint to Next.
- Keep temporary compatibility proxy for any unmigrated paths, then remove.
- Remove obsolete Express view-rendering and static client scripts after parity is confirmed.
- Final hardening
  - Threat-model review focused on auth, CSRF, path traversal, and file write boundaries.
  - Load/perf smoke tests on login and admin workflows.

---

## Cross-phase guardrails
- Compatibility harness
  - Dual-run checker (old vs new endpoint) in non-prod to diff status codes and payload shape.
- Observability
  - Structured audit logs for auth attempts, CSRF failures, admin mutations, and execution route starts/failures.
  - Alerting thresholds for auth failures and 5xx on critical routes.
- Rollback plan
  - One-command switch back to Express-owned path handling until parity is restored.

## Definition of done
- Same URL map and user workflows.
- Same or stricter security guarantees on all protected routes.
- Same `games/` and `ideas.json` storage paths + structures.
- Green unit/integration/E2E suites with added security and contract coverage.
- Route-contract diff report shows parity (or intentional, documented tightening only).
