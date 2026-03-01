# Next.js Port Completion Record

Updated: 2026-03-01

## Post-cutover cleanup (2026-03-01)
- Removed legacy Express-only files that were no longer used by runtime routing:
  - `src/app.ts`
  - `src/views.ts`
- Removed legacy browser clients no longer referenced by Next-owned pages:
  - `src/public/codex-view.js`
  - `src/public/ideas-view.js`
- Removed legacy tests tied only to those files:
  - `tests/app.integration.test.ts`
  - `tests/codexViewClient.test.ts`
- Removed legacy `/public/react/*` hydration bundle contract:
  - deleted `scripts/build-client.ts`
  - removed tracked files under `src/public/react/*`
  - moved game/codex/ideas hydration to Next-native client components (`next-app/app/**`)

## Scope
Record the completed Next.js cutover where Next owns runtime routes and `src/server.ts` no longer performs legacy compatibility routing.

## Key code references (start here)
- `src/server.ts`
- `src/services/nextBackendHandlers.ts`
- `src/services/gameAssetAllowlist.ts`
- `next-app/app/page.tsx`
- `next-app/app/auth/**/route.ts`
- `next-app/app/api/**/route.ts`
- `next-app/app/public/[...assetPath]/route.ts`
- `next-app/app/games/[versionId]/[...assetPath]/route.ts`
- `next-app/app/favicon.ico/route.ts`

## Completion snapshot

### Runtime ownership (final)
- `src/server.ts` forwards every request to `nextBridge.handleRequest` and retains centralized `502 Bad gateway` handling.
- Next owns pages: `/`, `/game/:versionId`, `/codex`, `/ideas`, `/auth*`.
- Next owns API routes: `/api/**`.
- Next owns static/fallback routes: `/public/*`, `/games/*`, `/favicon.ico`.
- Legacy Express route handlers that were temporarily retained at cutover time (`src/app.ts`/`src/views.ts`) were removed in the 2026-03-01 post-cutover cleanup.

## Route ownership and contract matrix (final)

| Route | Final owner | Status | Contract notes |
| --- | --- | --- | --- |
| `GET /game/:versionId` | Next page route | Complete | Admin/public rendering and hydration contracts are preserved; invalid ID, missing game, and missing bundle now consistently return Next `404` (intentional delta from prior `400`/`503` split). |
| `GET /codex` | Next page route | Complete | Admin-only route; unauthorized requests return `404`; transcript client logic ships through Next-managed bundles (`/_next/*`) with no `/public/react/*` dependency. |
| `GET /ideas` | Next page route | Complete | Admin-only route; unauthorized requests return `404`; ideas client logic ships through Next-managed bundles (`/_next/*`) with no `/public/react/*` dependency. |
| `GET /public/*` | Next route handler | Complete | Serves `src/public` files with traversal protection and extension-based content-type. |
| `GET /games/*` | Next route handler | Complete | Uses `isAllowedGamesRuntimeAssetPath()` allowlist; denylisted/sensitive paths remain `404`. |
| `GET /favicon.ico` | Next route handler | Complete | Returns `204` with empty body. |

## Static-serving parity requirements

### `/games/*` security parity (must match current behavior)
Use `isAllowedGamesRuntimeAssetPath()` as source of truth; do not duplicate logic.

Required allow behavior:
- `games/<versionId>/dist/**` only for allowlisted runtime extensions.
- `games/<versionId>/snapshots/tile.png` only.

Required deny behavior (`404`):
- Any unsafe path segment (`.`, `..`, dot-prefixed, traversal, encoded traversal, null-byte-like invalid decode cases).
- Non-runtime roots (`metadata.json`, `src/**`, `package.json`, `node_modules/**`, etc.).
- `dist/reload-token.txt` and any nested `/reload-token.txt`.
- Source maps (`*.map`).
- Any disallowed extension.

### `/public/*` parity
- Serve from `src/public` with path normalization and traversal protection.
- `404` on missing/invalid paths.
- Correct content-type by extension.

### Static semantics decision (final)
- Chosen: `Option B` (GET-only static contract).
- `/public/*` and `/games/*` intentionally export only `GET` handlers (no `HEAD` route handlers).
- No `express.static` parity for conditional/range metadata (`ETag`, `Last-Modified`, `Accept-Ranges` are not emitted).
- Covered by `tests/nextBackendHandlers.static.test.ts`.

## Intentional deltas
- `/game/:versionId` error statuses are normalized to Next `404` for invalid IDs, missing game directories, and missing bundles (instead of preserving legacy `400`/`503` splits).
- Static-serving semantics use Option B GET-only behavior; range/conditional request headers are ignored and full bytes are returned on allowed assets.
- `src/app.ts` and `src/views.ts` were retained in-repo immediately after cutover, then removed in the 2026-03-01 post-cutover cleanup.

## Resolved blockers
- `views.ts`/`react-dom/server` coupling no longer blocks Next runtime ownership; Next `page.tsx` handlers own `/game`, `/codex`, and `/ideas`.
- Body class/data requirements for legacy client scripts are explicitly set by Next pages before hydration.
- Static semantics drift is codified through Option B and static-handler tests.
- Route-owner proof now includes owner-sensitive assertions in E2E (`/_next/` script presence on cutover pages).

## Implementation checklist by workstream

### Workstream A: decouple page rendering from legacy coupling
- [x] Create page-data/page-rendering paths for Next ownership without introducing `react-dom/server` into `next-app/app/api/**` import graphs.
- [x] Keep API/auth/static handlers isolated in `src/services/nextBackendHandlers.ts`.
- [x] Isolate `src/views.ts` to legacy Express-only usage so production runtime no longer depends on it.

Concrete files/functions:
- `src/views.ts` (`renderGameView`, `renderCodexView`, `renderIdeasView`, shared serialization helpers)
- `src/services/nextBackendHandlers.ts`
- new shared modules under `src/react/` or `src/services/`

### Workstream B: implement Next page ownership for remaining pages
- [x] Add `next-app/app/game/[versionId]/page.tsx`.
- [x] Add `next-app/app/codex/page.tsx`.
- [x] Add `next-app/app/ideas/page.tsx`.
- [x] Ensure each page preserves root ids and behavior while migrating hydration to Next-managed client bundles.
- [x] Keep `/game` admin/dev behavior by loading legacy control modules through Next client bootstrap instead of `/public/*` script tags.

Concrete files/functions:
- `next-app/app/layout.tsx`
- new page files under `next-app/app/game/[versionId]/`, `next-app/app/codex/`, `next-app/app/ideas/`
- `src/react/legacy/game-view-client.js`
- `src/react/legacy/game-live-reload-client.js`

### Workstream C: activate and harden Next static routes
- [x] Finalize `/public/*` behavior in `handlePublicAssetGet`.
- [x] Finalize `/games/*` behavior in `handleGamesAssetGet` using `isAllowedGamesRuntimeAssetPath`.
- [x] Choose and codify Option B (GET-only static contract; no HEAD parity with `express.static`).
- [x] Verify `/favicon.ico` remains `204`.

Concrete files/functions:
- `src/services/nextBackendHandlers.ts` (`handlePublicAssetGet`, `handleGamesAssetGet`, static helpers)
- `next-app/app/public/[...assetPath]/route.ts`
- `next-app/app/games/[versionId]/[...assetPath]/route.ts`
- `next-app/app/favicon.ico/route.ts`

### Workstream D: remove legacy compatibility mode from entrypoint
- [x] Remove `hasRoutePrefix()` and `shouldUseLegacyExpressHandler()` from `src/server.ts`.
- [x] Remove `createApp()` runtime dispatch from `src/server.ts`.
- [x] Keep centralized `502 Bad gateway` handling for Next failures.

Concrete files/functions:
- `src/server.ts` (`main()` request dispatch middleware)

### Workstream E: cleanup and docs
- [x] Remove or isolate now-dead legacy route code that is no longer runtime-reachable.
- [x] Update `docs/overview.md` after cutover lands.
- [x] Keep this file (`docs/next-complete.md`) as completion record; mark items done in-place.

Concrete files:
- `src/app.ts`
- `src/views.ts`
- `docs/overview.md`
- `docs/next-complete.md`

## Validation coverage (completed)

### Unit tests added/updated
- Added static route-handler and path-safety parity coverage.
- Added/extended page-data coverage for Next-owned page rendering paths.

Suggested files:
- `tests/nextBackendHandlers.static.test.ts` (new)
- `tests/homepagePageData.test.ts` (extend pattern for other page data builders or add new dedicated files)

### Integration tests updated
- Updated ownership coverage that previously asserted legacy retention:
  - `tests/app.integration.test.ts` (`keeps legacy game/codex/ideas routes...`)
- Added integration checks for `/public/*` and `/games/*` status/content-type/denylist parity under Next-owned routing.

### E2E tests updated
- Updated `tests/e2e/phase1-react-hydration.spec.ts` to prove Next ownership of `/game`, `/codex`, and `/ideas` (including `/_next/` runtime asset checks).
- Extended E2E static checks for `/public/*`, `/games/*` denylist behavior, and `/favicon.ico`.
- Kept `tests/e2e/phase2-next-parallel.spec.ts` and `tests/e2e/phase3-next-backend.spec.ts` in the targeted cutover run.

### Validation command order used
```bash
npm run build:next
npm run typecheck
npm run lint
npm run test -- tests/app.integration.test.ts tests/nextBackendHandlers.static.test.ts
npm run test:e2e -- tests/e2e/phase1-react-hydration.spec.ts tests/e2e/phase2-next-parallel.spec.ts tests/e2e/phase3-next-backend.spec.ts
```

If additional targeted files are touched in follow-ups, append them to the `npm run test -- ...` and `npm run test:e2e -- ...` commands in the same run.

## Definition of done status
- [x] `src/server.ts` has no legacy compatibility routing branch.
- [x] Next serves `/game/:versionId`, `/codex`, `/ideas`, `/public/*`, `/games/*`, and `/favicon.ico` in production runtime.
- [x] Auth/CSRF/admin-404 contracts are unchanged for existing protected routes.
- [x] `/games/*` allowlist/denylist behavior is unchanged or tightened (never relaxed).
- [x] Static parity decision (`Option B`) is documented and covered by tests.
- [x] `npm run build:next`, `npm run typecheck`, `npm run lint`, targeted unit/integration tests, and targeted E2E suite pass in cutover validation.
- [x] `docs/overview.md` reflects final ownership model (no legacy compatibility note).

## Rollback plan
Trigger rollback on any high-severity regression in auth, CSRF, admin-404 behavior, `/games/*` exposure, or page availability.

Rollback steps:
1. Revert the cutover commit(s) that removed legacy routing from `src/server.ts`.
2. Restore legacy prefix routing in `src/server.ts` for:
   - `/game/*`, `/codex*`, `/ideas*`, `/public/*`, `/games/*`, `/favicon.ico`.
3. Keep Next-auth/API routes active (already stable) unless regression is in those surfaces.
4. Re-run:
   - `npm run typecheck`
   - `npm run lint`
   - `npm run test:e2e -- tests/e2e/phase1-react-hydration.spec.ts tests/e2e/phase2-next-parallel.spec.ts tests/e2e/phase3-next-backend.spec.ts`
5. Open a follow-up fix branch and reattempt cutover in smaller route batches.

## Incremental sequence used (historical)
1. Landed Workstream A first (module boundaries) with no route ownership change.
2. Landed Workstream B (new Next pages) while legacy server prefixes were still active.
3. Landed Workstream C (static parity hardening) and tests.
4. Removed server prefixes gradually in `src/server.ts`:
   - first `/favicon.ico`
   - then `/public/*` and `/games/*`
   - then `/game/*`, `/codex*`, `/ideas*`
5. After full cutover, isolated dead legacy runtime paths and updated docs.
