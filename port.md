# Next.js Port Plan: Rebuild PRs #86-#100

This plan restates each PR as behavior-focused milestones that can be reimplemented on top of the current Next.js architecture. It intentionally avoids prescribing legacy implementation details.

## Milestone 1: Refresh Homepage Tile After Manual Capture

Goal: A manual tile capture should immediately refresh the homepage tile image, even when the underlying file path is stable.

Behavior to deliver:

- Manual tile capture always produces a fresh, cache-busted tile image URL for that game.
- The latest tile image reference is persisted with game metadata and returned by the capture response.
- Re-visiting the homepage after capture shows the new tile URL without requiring a hard refresh.

Definition of done:

- Two consecutive manual captures for the same game yield two distinct tile image URLs.
- Homepage tile `src` reflects the newly returned URL after capture.

## Milestone 2: Hide Visible Homepage Tile Name Labels

Goal: Remove visible game-name text from homepage tiles while preserving accessibility.

Behavior to deliver:

- Homepage tiles render image-only visual cards (no visible text label overlay).
- Each tile still has an accessible name for screen readers.

Definition of done:

- No visible tile label element is rendered on tiles.
- Assistive tech can still identify each tile by game name.

## Milestone 6: Blank Starter Scene and Terse Engine API Guidance

Goal: Make the starter game intentionally blank and update guidance to match.

Behavior to deliver:

- Starter game defaults to an empty scene (no objects, no particles) with background-only rendering.
- Starter documentation reflects blank-scene behavior.
- Game build guidance includes a concise engine API quick reference for authors.

Definition of done:

- Launching `starter` renders only background pixels.
- Runtime source and docs reflect an empty default scene contract.

## Milestone 7: Base-Game-Aware Ideation Directives

Goal: Ideation prompt behavior should differ based on selected base game.

Behavior to deliver:

- If base game is `starter`, ideation asks for a full game concept.
- If base game is not `starter`, ideation asks for one focused mechanics improvement.
- Shared ideation guidance text matches this branching behavior.

Definition of done:

- Generated ideation input includes the correct directive for both starter and non-starter cases.

## Milestone 8: Archive Ideas Instead of Deleting

Goal: Preserve idea history while removing archived ideas from active UI/API lists.

Behavior to deliver:

- Ideas support an archive flag and default unarchived state for legacy/new records.
- Archive action marks ideas as archived instead of deleting persisted history.
- Active ideas views (server and client) omit archived entries.
- UI language and controls use "Archive" semantics.

Definition of done:

- Archiving an idea removes it from visible lists but keeps it in persistent storage.
- Legacy idea entries without archive fields are treated as unarchived.

## Milestone 9: Teardown-Safe Game Lifecycle Across Reloads

Goal: Ensure game runtime cleanup occurs when reloading/restarting a game instance.

Behavior to deliver:

- `startGame` supports returning a teardown callback.
- Game page runs prior teardown before starting a fresh instance.
- Teardown is invoked on unload lifecycle events.
- A reusable global teardown handle is exposed for host-controlled cleanup.

Definition of done:

- Reloading the game page runs cleanup exactly once for the prior instance.
- Global teardown handler can be invoked to clean up active runtime.

## Milestone 10: Move Delete Action to End of Admin Toolbar

Goal: Reduce accidental destructive clicks by placing delete as the final action.

Behavior to deliver:

- In admin game controls, delete appears after the other action buttons.
- Delete is the last button in the action row.

Definition of done:

- Toolbar action order consistently renders delete in the final position.

## Milestone 11: Delay Mic Stop Until Realtime Transcription Flushes

Goal: Prevent transcript loss by waiting for realtime finalization before fully stopping recording.

Behavior to deliver:

- Stopping recording enters a short busy state while waiting for final transcription signals and buffered overlay text drain.
- Stop flow includes timeout fallback so UI cannot hang indefinitely.
- Record button remains disabled during flush and re-enables only after finalization.

Definition of done:

- On stop, button transitions to recording+busy disabled state.
- Button returns to normal enabled state only after final realtime completion (or timeout fallback).

## Milestone 12: Persist Per-Game Prompt Drafts

Goal: Preserve unsent prompt text per game across reloads/tab closes.

Behavior to deliver:

- Prompt editor autosaves draft text to per-game local storage key.
- Reloading a game page restores that draft.
- Successful submit clears the stored draft for that game.

Definition of done:

- Draft text survives reload for the same game.
- Stored draft is removed after successful submit/reset flow.

## Milestone 13: Single-Sentence Ideation Outputs

Goal: Tighten ideation output format and tone for both starter and non-starter contexts.

Behavior to deliver:

- Starter ideation requests a creative, single-sentence arcade-style game concept.
- Non-starter ideation requests one off-the-wall, single-sentence improvement grounded in current game context.
- Guidance text and generated ideation directives match this wording.

Definition of done:

- Serialized ideation prompt contains the updated single-sentence directives for each context.

## Milestone 14: Auto-Enable GitHub Auto-Merge for Owner PRs

Goal: Reduce manual merge work by automatically enabling auto-merge on qualifying PRs.

Behavior to deliver:

- A GitHub workflow runs on PR lifecycle events and enables queued auto-merge.
- Workflow scope is restricted to non-draft PRs to `main` created by the repo owner from the same repository.

Definition of done:

- Matching PRs receive auto-merge enablement without manual action.
- Non-matching PRs are ignored.

## Milestone 15: Strengthen Automatic Tile Snapshot Interaction Protocol

Goal: Improve generated tile snapshot reliability by giving gameplay more time and simulating touch activity before capture.

Behavior to deliver:

- Auto snapshot protocol runs longer before capture.
- Protocol includes synthetic touch start/end interactions before final snapshot step.

Definition of done:

- Snapshot protocol source includes extended run timing plus both touch sequences and final snap step.
