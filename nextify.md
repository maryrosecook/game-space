# Nextify Plan

Updated: 2026-03-01

## Objective
Complete the Next.js migration by (1) moving frontend source and build outputs to idiomatic Next.js locations, and (2) porting remaining hand-authored browser `src/public/*.js` modules to typed React/Next code.

## Success Criteria
- No committed/generated frontend bundles in `src/public/react`.
- No runtime dependence on hand-authored browser source files in `src/public/*.js`.
- `next-app/app/game/[versionId]/page.tsx` renders and controls the full game page behavior through React/TypeScript.
- Existing security and behavior contracts remain intact (admin 404 semantics, CSRF checks, runtime asset allowlist, game fork/build flow).
- Targeted unit/integration tests and E2E tests pass, including at least one E2E path added/updated for user-visible behavior changes.

## Requirements
- Keep existing URL surface and backend contracts unless a change is explicitly documented as intentional:
  - `/game/:versionId`, `/api/games/:versionId/*`, `/api/codex-sessions/:versionId`, `/api/transcribe`, `/api/dev/reload-token/:versionId`, `/games/*`.
- Preserve admin/public behavior split on the game page.
- Preserve existing game runtime asset model under `games/<versionId>/dist/*`.
- Preserve current security invariants:
  - Admin-only routes return `404` when unauthorized.
  - CSRF requirements remain unchanged for mutation routes.
  - `/games/*` allowlist enforcement remains unchanged or tighter.

## Non-goals
- No schema changes to `games/*/metadata.json`, `ideas.json`, or session storage.
- No change to game runtime build output location (`games/<versionId>/dist`).
- No redesign of game UX; this is a parity migration.

## Current State Summary
- `scripts/build-client.ts` bundles React entrypoints into `src/public/react/*`.
- Game page still loads non-React browser modules:
  - `/public/game-view.js` (admin controls and integrations)
  - `/public/game-live-reload.js` (dev token polling)
  - `codex-transcript-presenter.js` (shared transcript rendering helper)
- `/public/*` is served from `src/public/*` through `next-app/app/public/[...assetPath]/route.ts` + `handlePublicAssetGet`.

## Target Architecture
- Frontend source:
  - Route UI and client behavior in `next-app/app/**` and typed shared modules under `src/react/**` (or `next-app/**` where appropriate).
- Frontend build output:
  - Produced by Next (`.next/**`) only.
  - Static-only assets in repo root `public/**` (images/fonts/static files), not generated bundles.
- Game page behavior:
  - React components/hooks own admin controls, transcript rendering, live reload behavior, and event wiring.
  - Remove `game-react-hydrated` event orchestration and script-tag boot sequencing.

## Workstreams

### WS0: Baseline and guardrails
- Capture parity expectations from:
  - `docs/overview.md`
  - `docs/next-complete.md`
  - existing tests for game page and live reload clients.
- Add or update a migration checklist in this plan with explicit sign-off for:
  - auth/CSRF behavior
  - transcript behavior
  - prompt submit behavior
  - snapshot capture behavior
  - favorite toggle behavior

### WS1: Normalize frontend output and static asset layout
- Replace `scripts/build-client.ts` + `src/public/react/*` runtime dependency with Next-native client bundles.
- Remove script-tag injection of `/public/react/*.js` from Next pages.
- Move true static assets from `src/public/*` to repo root `public/*` where appropriate.
- Decide and implement final `/public/*` strategy:
  - Preferred: use native Next static serving from repo root `public/` and remove custom `/public/[...assetPath]` route.
  - Keep custom route only if a required behavior cannot be preserved otherwise; if retained, document exact reason.
- Cleanup:
  - Remove obsolete build scripts and references in `package.json`.
  - Remove committed generated chunks under `src/public/react`.

### WS2: Port remaining hand-authored browser JS to React/TypeScript
- Port `src/public/game-view.js` into React hooks/components with clear responsibility boundaries:
  - prompt panel open/close + keyboard submission behavior
  - favorite toggle mutation flow
  - delete flow
  - tile snapshot capture flow
  - transcript polling + rendering + auto-scroll
  - provider-aware transcript title behavior
  - realtime transcription session + WebRTC flow
  - overlay transcript display
  - annotation drawing capture and prompt attachment
  - generating state visual toggles
- Port `src/public/codex-transcript-presenter.js` into typed React rendering (component-driven transcript view).
- Port `src/public/game-live-reload.js` into a React effect/hook gated by dev/live-reload settings.
- Remove DOM query + `instanceof` guard bootstrap style and replace with typed component props/state.
- Remove `game-react-hydrated` custom event coordination once React ownership is complete.

### WS3: Remove legacy browser-source modules and route/script wiring
- Delete:
  - `src/public/game-view.js`
  - `src/public/game-live-reload.js`
  - `src/public/codex-transcript-presenter.js`
- Remove all references in:
  - `next-app/app/game/[versionId]/page.tsx`
  - tests that execute those files directly as scripts.
- Replace script-centric tests with React/component/integration tests that validate equivalent behavior.

### WS4: Documentation and final cleanup
- Update `docs/overview.md` to reflect final architecture once migration lands.
- Remove or update stale docs that describe `src/public/react` as a build output.
- Ensure the PR template `video-tests` block remains present and updated for user-visible changes.

## Implementation Order (Recommended)
1. Land WS1 infrastructure changes behind parity checks.
2. Land WS2 in small slices (favorite/delete, transcript, prompt submit, transcription/annotation, live reload).
3. Land WS3 deletions only after WS2 parity tests pass.
4. Land WS4 doc cleanup last.

## Testing Strategy
- Unit/integration (targeted):
  - migrate `gameViewClient`/`gameLiveReloadClient` coverage to React/component-level tests.
  - keep API/service tests that enforce auth/CSRF/allowlist contracts.
- E2E (required for user-visible changes):
  - at least one Playwright test that exercises migrated game admin controls end-to-end.
  - update existing phase E2E coverage to assert no dependency on removed `/public/game-view.js` and `/public/game-live-reload.js`.
  - keep existing 404 checks for already removed legacy hydration artifacts.
- Validation command order (sequential):
  1. `npm run typecheck`
  2. `npm run lint`
  3. targeted `npm run test -- <files>`
  4. targeted `npm run test:e2e -- <specs>`

## Rollout / Validation Steps
- Phase gate A (after WS1):
  - game/codex/ideas pages load without `/public/react/*.js` script injection.
  - no generated client bundles tracked under `src/public/react`.
- Phase gate B (after WS2):
  - game page admin/public behavior matches baseline flows.
  - all migrated tests green.
- Phase gate C (after WS3):
  - no runtime references to deleted JS modules.
  - E2E suite covering game flow passes.
- Phase gate D (after WS4):
  - docs and architecture references are consistent with final state.

## Risks and Mitigations
- Risk: behavior regressions from large `game-view.js` port.
  - Mitigation: migrate by feature slice and lock each slice with tests before deleting legacy code.
- Risk: accidental security drift during UI migration.
  - Mitigation: keep API contracts unchanged; retain existing server tests and add focused auth/CSRF assertions where coverage is thin.
- Risk: static asset routing regressions when removing custom `/public/*` route.
  - Mitigation: inventory required assets first and add targeted static serving tests before and after move.
- Risk: Next client/server boundary mistakes in new hooks/components.
  - Mitigation: keep side-effectful logic in dedicated client components/hooks with strict typing and focused tests.

## Open Decisions (Default Recommendations)
- Should dev live reload remain a standalone script?
  - Default: no; move into React hook for consistency.
- Should any JS remain under `src/public` after migration?
  - Default: only true static assets in root `public/`; no hand-authored runtime logic modules in `src/public`.

