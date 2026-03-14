- Runtime settings controls plan: [`factory/spec-runtime-settings-controls.md`](/Users/maryrosecook/conductor/workspaces/game-space/phoenix/factory/spec-runtime-settings-controls.md)
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
