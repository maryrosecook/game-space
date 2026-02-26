# Tiles Screenshot Plan

1. In the headless runner, add `captureTileSnapshot(gameDir)` and call it from a single `onGenerationComplete(run)` path.
2. Detect completion with provider adapters:
   - Codex: mark complete when stream emits terminal event (`response.completed`/`run.completed`) or process exits `0` after final assistant output.
   - Claude: mark complete when SDK/event stream emits `message_stop` (or equivalent final stop reason) after last content block.
   - Fallback: if no terminal event arrives, treat idle timeout after last token + clean exit as complete; otherwise skip capture and log.
3. `captureTileSnapshot` should request one screenshot at exactly `178x100` from the existing page/session and write to `${gameDir}/snapshots/tile.png` (mkdir `snapshots` recursively, overwrite file).
4. Thread `tileSnapshotPath` through game metadata returned to the web app (default to `null` if missing).
5. Home page: render each tile image from `tileSnapshotPath` (or placeholder), switch tile container to `aspect-ratio: 9 / 16`, keep `object-fit: cover`.
6. Add e2e coverage: mock/fixture completed runs for Codex + Claude, assert `snapshots/tile.png` is created on completion and home tiles render snapshot images with 9:16 sizing.
