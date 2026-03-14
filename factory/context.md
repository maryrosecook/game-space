- Runtime settings controls plan: [`factory/spec-runtime-settings-controls.md`](/Users/maryrosecook/conductor/workspaces/game-space/phoenix/factory/spec-runtime-settings-controls.md)
- Owner PR auto-merge retry plan: [`factory/spec-owner-pr-automerge-retry.md`](/Users/maryrosecook/conductor/workspaces/game-space/memphis/factory/spec-owner-pr-automerge-retry.md)
- Runtime settings controls implementation:
  - Added shared runtime-control parsing and normalization in [`src/gameRuntimeControls.ts`](/Users/maryrosecook/conductor/workspaces/game-space/phoenix/src/gameRuntimeControls.ts) plus persisted control-state storage in [`src/services/gameControlState.ts`](/Users/maryrosecook/conductor/workspaces/game-space/phoenix/src/services/gameControlState.ts).
  - Added `GET`/`POST` control-state handling and the `/api/games/[versionId]/control-state` route, then threaded `initialControlState` and a runtime host through the game page bootstrap so admin sessions can load and save runtime settings.
  - Split the admin toolbar into separate build and settings drawers, rendered runtime sliders from game metadata, and added an early admin warmup script so prompt drafts and prompt-drawing stroke styling are available before hydrated client imports finish.
  - Upgraded the starter game from a blank scene to a particle emitter demo with `globals` plus `editor.sliders`, and wired runtime slider changes into live particle density plus persisted `control-state.json`.
  - Added unit/integration coverage for runtime controls, control-state persistence, starter particle behavior, legacy client drawer behavior, and Playwright coverage for the full admin/settings flow.
- Validation:
  - `npm run test -- tests/gameRuntimeControls.test.ts tests/gameRuntimeSource.test.ts tests/starterParticles.test.ts tests/nextBackendHandlers.controlState.test.ts tests/gameViewClient.test.ts tests/starterPackage.test.ts`
  - `npm run test -- tests/gameRuntimeSource.test.ts tests/starterParticles.test.ts`
  - `npm run test -- tests/gameViewClient.test.ts`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run test:e2e -- tests/e2e/game.spec.ts`

## Style Guide Review

- Reviewed the touched files against `~/.codex/docs/style-guide.md` and `~/.codex/prompts/final-code-review.md`.
- No additional style-guide or final-review issues remained after the last fixes. The small inline admin warmup script in [`src/app/game/[versionId]/page.tsx`](/Users/maryrosecook/conductor/workspaces/game-space/phoenix/src/app/game/[versionId]/page.tsx) is intentional duplication to guarantee prompt-draft persistence and annotation-canvas styling before the hydrated legacy client finishes loading.

- Owner PR auto-merge implementation:
  - Replaced the inline GraphQL mutation in [`owner-pr-automerge.yml`](/Users/maryrosecook/conductor/workspaces/game-space/memphis/.github/workflows/owner-pr-automerge.yml) with a checked-in helper script and `gh`-tokenized workflow step.
  - Added [`enable-owner-pr-automerge.js`](/Users/maryrosecook/conductor/workspaces/game-space/memphis/scripts/github/enable-owner-pr-automerge.js) to keep the existing owner/main/same-repo eligibility checks, preflight current auto-merge state, and retry transient unstable-status failures from `gh pr merge --auto`.
  - Added integration-style coverage in [`ownerPrAutomergeScript.test.ts`](/Users/maryrosecook/conductor/workspaces/game-space/memphis/tests/ownerPrAutomergeScript.test.ts) plus updated workflow assertions in [`repoAutomation.test.ts`](/Users/maryrosecook/conductor/workspaces/game-space/memphis/tests/repoAutomation.test.ts).
- Validation:
  - `npm run typecheck`
  - `npm run lint`
  - `npm run test -- tests/ownerPrAutomergeScript.test.ts tests/repoAutomation.test.ts`
  - No Playwright E2E was added because this change is repo automation in GitHub Actions and is not demonstrable through the product UI.

## Documentation

- Updated [`docs/overview.md`](/Users/maryrosecook/conductor/workspaces/game-space/memphis/docs/overview.md) to describe the new helper-script workflow path, the retrying `gh pr merge --auto` model, and the added automation test coverage.
- Removed stale merge-conflict markers from [`docs/overview.md`](/Users/maryrosecook/conductor/workspaces/game-space/memphis/docs/overview.md) while making the required overview update.

## Settings Drawer Sizing

- Implementation:
  - Updated [`src/public/styles.css`](/Users/maryrosecook/conductor/workspaces/game-space/brasilia/src/public/styles.css) so the runtime settings drawer grows to its content instead of forcing `50vh`, while capping its height at one-third of the viewport.
  - Updated [`src/app/game/[versionId]/legacy/game-view-client.js`](/Users/maryrosecook/conductor/workspaces/game-space/brasilia/src/app/game/[versionId]/legacy/game-view-client.js) so open settings drawer rerenders resync `--edit-drawer-height` on the next animation frame, keeping the bottom tabs aligned after runtime-control changes.
  - Added focused regression coverage in [`tests/gameViewClient.test.ts`](/Users/maryrosecook/conductor/workspaces/game-space/brasilia/tests/gameViewClient.test.ts) and [`tests/e2e/game.spec.ts`](/Users/maryrosecook/conductor/workspaces/game-space/brasilia/tests/e2e/game.spec.ts) for content-sized settings height, one-third viewport capping, and live rerender height syncing.
- Validation:
  - `npm run test -- tests/gameViewClient.test.ts`
  - `npm run test:e2e -- tests/e2e/game.spec.ts --grep "admin game toolbar separates build and settings drawers with synced aria state"`
  - `npm run typecheck`
  - `npm run lint`

## Documentation

- Updated [`docs/overview.md`](/Users/maryrosecook/conductor/workspaces/game-space/brasilia/docs/overview.md) so the runtime settings flow notes the drawer now sizes to its content up to one-third of the viewport.

## Style Guide Review

- Reviewed the changed settings drawer files against `~/.codex/docs/style-guide.md` and `~/.codex/prompts/final-code-review.md`.
- No remaining style-guide or final-review issues found in the touched files.
- Reverted generated `src/next-env.d.ts` churn from the Playwright build so the diff stays scoped to the requested behavior change.
