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

- Dev port fallback implementation:
  - Added [`src/services/serverPort.ts`](/Users/maryrosecook/conductor/workspaces/game-space/barcelona-v2/src/services/serverPort.ts) to parse `PORT` and optionally walk upward from the default port when fallback is enabled.
  - Updated [`src/server.ts`](/Users/maryrosecook/conductor/workspaces/game-space/barcelona-v2/src/server.ts) to bind through that helper and log when it moves off an occupied default port.
  - Updated [`scripts/dev.ts`](/Users/maryrosecook/conductor/workspaces/game-space/barcelona-v2/scripts/dev.ts) to enable fallback for the spawned dev server only, leaving explicit `PORT` behavior unchanged.
  - Added unit/source coverage in [`tests/serverPort.test.ts`](/Users/maryrosecook/conductor/workspaces/game-space/barcelona-v2/tests/serverPort.test.ts) and [`tests/devScript.test.ts`](/Users/maryrosecook/conductor/workspaces/game-space/barcelona-v2/tests/devScript.test.ts), plus browser-level fallback coverage in [`tests/e2e/dev-port-fallback.spec.ts`](/Users/maryrosecook/conductor/workspaces/game-space/barcelona-v2/tests/e2e/dev-port-fallback.spec.ts).
- Validation:
  - `npm run typecheck`
  - `npm run lint`
  - `npm run test -- tests/serverPort.test.ts tests/devScript.test.ts`
  - `npm run test:e2e -- tests/e2e/dev-port-fallback.spec.ts`

- Owner PR auto-merge implementation:
  - Replaced the inline GraphQL mutation in [`owner-pr-automerge.yml`](/Users/maryrosecook/conductor/workspaces/game-space/memphis/.github/workflows/owner-pr-automerge.yml) with a checked-in helper script and `gh`-tokenized workflow step.
  - Added [`enable-owner-pr-automerge.js`](/Users/maryrosecook/conductor/workspaces/game-space/memphis/scripts/github/enable-owner-pr-automerge.js) to keep the existing owner/main/same-repo eligibility checks, preflight current auto-merge state, resolve an allowed non-interactive merge strategy from repo settings, and retry transient unstable-status failures from `gh pr merge --auto`.
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

## Settings Tab Disable State

- Implementation:
  - Updated [`src/app/shared/components/GameApp.tsx`](/Users/maryrosecook/conductor/workspaces/game-space/lisbon/src/app/shared/components/GameApp.tsx) so the admin Settings tab renders disabled by default and only becomes interactive after client-side runtime controls confirm slider availability.
  - Updated [`src/app/game/[versionId]/legacy/game-view-client.js`](/Users/maryrosecook/conductor/workspaces/game-space/lisbon/src/app/game/[versionId]/legacy/game-view-client.js) to keep the Settings tab disabled when no sliders exist, prevent opening the drawer in that state, and close it if settings disappear.
  - Updated [`src/public/styles.css`](/Users/maryrosecook/conductor/workspaces/game-space/lisbon/src/public/styles.css), [`tests/gameViewClient.test.ts`](/Users/maryrosecook/conductor/workspaces/game-space/lisbon/tests/gameViewClient.test.ts), and [`tests/e2e/game.spec.ts`](/Users/maryrosecook/conductor/workspaces/game-space/lisbon/tests/e2e/game.spec.ts) for disabled-state styling and regression coverage, including a no-settings browser fixture.
- Validation:
  - `CI=1 npm test -- tests/gameViewClient.test.ts`
  - `npm run test:e2e -- tests/e2e/game.spec.ts --grep "admin game toolbar separates build and settings drawers with synced aria state|settings tab stays disabled when a game exposes no runtime settings"`

## Documentation

- Updated [`docs/overview.md`](/Users/maryrosecook/conductor/workspaces/game-space/lisbon/docs/overview.md) so the runtime-settings flow and model note that the admin Settings tab stays disabled for games without sliders.

## Style Guide Review

- Reviewed the settings-tab change against `~/.codex/docs/style-guide.md` and `~/.codex/prompts/final-code-review.md`.
- No remaining style-guide or final-review issues found in the touched files after the disabled-state and test updates.

## Settings Prompt Guidance

- Implementation:
  - Updated [`game-build-prompt.md`](/Users/maryrosecook/conductor/workspaces/game-space/lisbon/game-build-prompt.md) to tell game-building prompts to add meaningful `globals` + `editor.sliders`, cap total settings at 7, preserve explicitly requested tunables when they still fit the game, and mark slider metadata with `gameDevRequested`.
  - Updated [`src/gameRuntimeControls.ts`](/Users/maryrosecook/conductor/workspaces/game-space/lisbon/src/gameRuntimeControls.ts) and [`src/app/game/[versionId]/legacy/game-view-client.js`](/Users/maryrosecook/conductor/workspaces/game-space/lisbon/src/app/game/[versionId]/legacy/game-view-client.js) so slider metadata now requires `gameDevRequested: boolean` end-to-end.
  - Renamed the starter runtime setting from `particleAmount` / `Amount of particles` to `particles` / `Particles` in [`games/starter/src/main.ts`](/Users/maryrosecook/conductor/workspaces/game-space/lisbon/games/starter/src/main.ts), [`games/starter/control-state.json`](/Users/maryrosecook/conductor/workspaces/game-space/lisbon/games/starter/control-state.json), and the tracked starter bundle via rebuild.
  - Updated starter-facing docs and regression coverage in [`games/starter/README.md`](/Users/maryrosecook/conductor/workspaces/game-space/lisbon/games/starter/README.md), [`tests/gameRuntimeControls.test.ts`](/Users/maryrosecook/conductor/workspaces/game-space/lisbon/tests/gameRuntimeControls.test.ts), [`tests/gameRuntimeSource.test.ts`](/Users/maryrosecook/conductor/workspaces/game-space/lisbon/tests/gameRuntimeSource.test.ts), [`tests/starterParticles.test.ts`](/Users/maryrosecook/conductor/workspaces/game-space/lisbon/tests/starterParticles.test.ts), [`tests/nextBackendHandlers.controlState.test.ts`](/Users/maryrosecook/conductor/workspaces/game-space/lisbon/tests/nextBackendHandlers.controlState.test.ts), [`tests/gameViewClient.test.ts`](/Users/maryrosecook/conductor/workspaces/game-space/lisbon/tests/gameViewClient.test.ts), and [`tests/e2e/game.spec.ts`](/Users/maryrosecook/conductor/workspaces/game-space/lisbon/tests/e2e/game.spec.ts).
- Validation:
  - `npm --prefix games/starter run build`
  - `CI=1 npm test -- tests/gameRuntimeControls.test.ts tests/gameRuntimeSource.test.ts tests/starterParticles.test.ts tests/nextBackendHandlers.controlState.test.ts tests/gameViewClient.test.ts tests/starterPackage.test.ts`
  - `npm run test:e2e -- tests/e2e/game.spec.ts --grep "starter game ships runtime settings metadata and loads canvas|admin game toolbar separates build and settings drawers with synced aria state|settings tab stays disabled when a game exposes no runtime settings|particles slider persists across reloads and increases rendered particle density"`

## Documentation

- Updated [`docs/overview.md`](/Users/maryrosecook/conductor/workspaces/game-space/lisbon/docs/overview.md) so the overview reflects the `gameDevRequested` slider metadata, the renamed starter `particles` setting, the prompt-prelude guidance, and the existing disabled-settings-tab behavior.

## Style Guide Review

- Reviewed the prompt/schema/starter changes against `~/.codex/docs/style-guide.md` and `~/.codex/prompts/final-code-review.md`.
- No remaining style-guide or final-review issues found in the touched files after the schema, starter, prompt, and test updates.

## Prompt Guidance Follow-up

- Updated [`game-build-prompt.md`](/Users/maryrosecook/conductor/workspaces/game-space/lisbon/game-build-prompt.md) so it now names the settings file path exactly as `[game-dir]/control-state.json` and narrows the removal rule to `gameDevRequested: true` settings that clearly are no longer relevant.
- Updated [`docs/overview.md`](/Users/maryrosecook/conductor/workspaces/game-space/lisbon/docs/overview.md) so the prompt-prelude summary stays aligned with the new settings-file guidance.
- Validation: skipped `typecheck`, `lint`, and tests because this follow-up is prompt/docs-only and does not change executable code.

## Lineage Tiles

- Implementation:
  - Added persisted `lineageId` metadata plus shared lineage resolution/grouping helpers in [`src/services/gameLineages.ts`](/Users/maryrosecook/conductor/workspaces/game-space/zurich/src/services/gameLineages.ts), then threaded lineage-aware grouping into [`src/app/shared/homepagePageData.ts`](/Users/maryrosecook/conductor/workspaces/game-space/zurich/src/app/shared/homepagePageData.ts) so starter-derived clone trees render as one homepage tile.
  - Updated fork/delete flows in [`src/services/forkGameVersion.ts`](/Users/maryrosecook/conductor/workspaces/game-space/zurich/src/services/forkGameVersion.ts), [`src/services/gameVersions.ts`](/Users/maryrosecook/conductor/workspaces/game-space/zurich/src/services/gameVersions.ts), and [`src/services/nextBackendHandlers.ts`](/Users/maryrosecook/conductor/workspaces/game-space/zurich/src/services/nextBackendHandlers.ts) so new forks inherit a stable lineage id and surviving clones keep that lineage after deletes.
  - Added the admin lineage-history modal in [`src/app/shared/components/GameLineageModal.tsx`](/Users/maryrosecook/conductor/workspaces/game-space/zurich/src/app/shared/components/GameLineageModal.tsx), wired the new clock button and modal interactions through [`src/app/shared/components/GameApp.tsx`](/Users/maryrosecook/conductor/workspaces/game-space/zurich/src/app/shared/components/GameApp.tsx), [`src/app/game/[versionId]/page.tsx`](/Users/maryrosecook/conductor/workspaces/game-space/zurich/src/app/game/[versionId]/page.tsx), [`src/app/game/[versionId]/legacy/game-view-client.js`](/Users/maryrosecook/conductor/workspaces/game-space/zurich/src/app/game/[versionId]/legacy/game-view-client.js), and styled it in [`src/public/styles.css`](/Users/maryrosecook/conductor/workspaces/game-space/zurich/src/public/styles.css).
  - Added coverage in [`tests/gameLineages.test.ts`](/Users/maryrosecook/conductor/workspaces/game-space/zurich/tests/gameLineages.test.ts), [`tests/homepagePageData.test.ts`](/Users/maryrosecook/conductor/workspaces/game-space/zurich/tests/homepagePageData.test.ts), [`tests/nextBackendHandlers.delete.test.ts`](/Users/maryrosecook/conductor/workspaces/game-space/zurich/tests/nextBackendHandlers.delete.test.ts), [`tests/gameViewClient.test.ts`](/Users/maryrosecook/conductor/workspaces/game-space/zurich/tests/gameViewClient.test.ts), [`tests/forkGameVersion.test.ts`](/Users/maryrosecook/conductor/workspaces/game-space/zurich/tests/forkGameVersion.test.ts), [`tests/gameVersions.test.ts`](/Users/maryrosecook/conductor/workspaces/game-space/zurich/tests/gameVersions.test.ts), and [`tests/e2e/game.spec.ts`](/Users/maryrosecook/conductor/workspaces/game-space/zurich/tests/e2e/game.spec.ts).
- Validation:
  - `npm run typecheck`
  - `npm run lint`
  - `npm run test -- tests/homepagePageData.test.ts tests/gameLineages.test.ts tests/nextBackendHandlers.delete.test.ts tests/gameViewClient.test.ts tests/forkGameVersion.test.ts tests/gameVersions.test.ts`
  - `npm run test:e2e -- tests/e2e/game.spec.ts -g "homepage groups a lineage into one tile and lineage modal can play and delete clones"`

## Documentation

- Updated [`docs/overview.md`](/Users/maryrosecook/conductor/workspaces/game-space/zurich/docs/overview.md) to describe the lineage metadata model, grouped homepage tiles, lineage-history modal flow, delete backfill behavior, and the new validation coverage.

## Style Guide Review

- Reviewed the lineage changes against `~/.codex/docs/style-guide.md` and `~/.codex/prompts/final-code-review.md`.
- No remaining style-guide or final-review issues were found after validation and the final diff cleanup.

## Lineage Modal Current Row Highlight

- Implementation:
  - Updated [`src/app/shared/components/GameLineageModal.tsx`](/Users/maryrosecook/conductor/workspaces/game-space/zurich/src/app/shared/components/GameLineageModal.tsx) to add a dedicated current-row modifier class when a lineage entry matches the actively playing clone.
  - Updated [`src/public/styles.css`](/Users/maryrosecook/conductor/workspaces/game-space/zurich/src/public/styles.css) so the active lineage row renders with an off-white border.
  - Extended the existing lineage Playwright scenario in [`tests/e2e/game.spec.ts`](/Users/maryrosecook/conductor/workspaces/game-space/zurich/tests/e2e/game.spec.ts) to assert the active row border color.
- Validation:
  - `npm run typecheck`
  - `npm run lint`
  - `npm run test:e2e -- tests/e2e/game.spec.ts -g "homepage groups a lineage into one tile and lineage modal can play and delete clones"`
- Documentation:
  - Skipped `docs/overview.md` because this follow-up only adjusts an existing modal’s visual affordance and does not change architecture, behavior flow, or operator-facing workflow.
- Style Guide Review:
  - Reviewed the touched files against `~/.codex/docs/style-guide.md` and `~/.codex/prompts/final-code-review.md`.
  - No remaining issues found in the final diff for this tweak.

## Clone Tile Snapshot Fix

- Updated [`src/services/forkGameVersion.ts`](/Users/maryrosecook/conductor/workspaces/game-space/trenton/src/services/forkGameVersion.ts) so new forks still copy the source game tree but skip the top-level `snapshots/` directory, preventing cloned homepage tiles from inheriting stale `snapshots/tile.png` output from the source game.
- Added regression coverage in [`tests/forkGameVersion.test.ts`](/Users/maryrosecook/conductor/workspaces/game-space/trenton/tests/forkGameVersion.test.ts) and [`tests/e2e/homepage.spec.ts`](/Users/maryrosecook/conductor/workspaces/game-space/trenton/tests/e2e/homepage.spec.ts) to prove the copied snapshot file is absent and the homepage renders the fork with a placeholder instead of the source image.
- Validation:
  - `npm run test -- tests/forkGameVersion.test.ts`
  - `npm run test:e2e -- tests/e2e/homepage.spec.ts --grep "newly forked clone"`
  - `npm run typecheck`
  - `npm run lint`

## Style Guide Review

- Reviewed the clone snapshot fix against `~/.codex/docs/style-guide.md` and `~/.codex/prompts/final-code-review.md`.
- No further issues remained after narrowing the copy filter to top-level fork artifacts and reusing existing test helpers for the browser regression.

## Documentation

- Updated [`docs/overview.md`](/Users/maryrosecook/conductor/workspaces/game-space/trenton/docs/overview.md) to document that fork creation now excludes copied snapshot artifacts so new clones cannot inherit stale homepage tiles.

## Automatic Tile Snapshot Fix

- Updated [`src/services/promptSubmission.ts`](/Users/maryrosecook/conductor/workspaces/game-space/trenton/src/services/promptSubmission.ts) so successful prompt runs always trigger the post-generation tile capture, even when the live `completionDetected` flag stays `false`.
- Added focused coverage in [`tests/promptSubmission.test.ts`](/Users/maryrosecook/conductor/workspaces/game-space/trenton/tests/promptSubmission.test.ts) for the `completionDetected: false` success path, and browser coverage in [`tests/e2e/homepage.spec.ts`](/Users/maryrosecook/conductor/workspaces/game-space/trenton/tests/e2e/homepage.spec.ts) that confirms the generated homepage tile image appears after that path completes.
- Validation:
  - `npm run test -- tests/promptSubmission.test.ts`
  - `npm run test:e2e -- tests/e2e/homepage.spec.ts --grep "without completionDetected"`
  - `npm run typecheck`
  - `npm run lint`

## Style Guide Review

- Reviewed the prompt-submission follow-up fix against `~/.codex/docs/style-guide.md` and `~/.codex/prompts/final-code-review.md`.
- No further issues remained after removing the unreliable completion gate and scoping the regression coverage to the background metadata/tile update path.

## Documentation

- Updated [`docs/overview.md`](/Users/maryrosecook/conductor/workspaces/game-space/trenton/docs/overview.md) so the automatic tile snapshot model now states that capture runs after any successful codegen exit.
