# Game Plan

## Goal

Build a local web app for curating and evolving browser-game versions: the
homepage lists versions, users open one to play, and users can submit prompts
that run Codex edits against the selected game.

## UX

### Homepage (Game Picker)

- Render a grid of square tiles.
- Render exactly three square tiles per row.
- Every square is a game version; show all versions in reverse chronological
  order (newest first).
- On each request to `/`, backend reads `/games/*` and sorts versions by
  `metadata.json.createdTime` descending before rendering tiles.
- Tapping a tile opens that version.

### Game View

- Game renders in most of the screen.
- Show a floating button in the top-right corner with a `✏️` icon.
- Tapping the `✏️` button slides a prompt box down from the top of the screen
  (matching the provided mock).
- The prompt panel includes a close (`×`) control.
- Pressing Return/Go on the keyboard submits the prompt.

## Runtime and Rendering

- V1 runs locally only (no local/remote sync layer).
- Game runtime is 100% client-side.
- Start with WebGL rendering, even for simple circles/rectangles, so the move
  to custom shaders is easier later.
- Root `npm run dev` must:
  - build games automatically on startup
  - serve game outputs for gameplay
  - watch game source files and rebuild games when sources change
- Root `npm run build` must also build games as part of production builds.

## Prompt Execution (V1)

- On Return/Go in the prompt box, frontend sends the prompt to backend for the
  currently opened version.
- Submission is fire-and-forget: frontend does not wait for completion status
  and V1 has no notifications/status feed.
- Backend immediately forks the current version into `/games/<new-version-id>/`
  before running Codex; the source version is never edited in place.
- The new fork appears on homepage listing as soon as the new game directory
  exists and `/` is requested again.
- Backend runs `codex exec` in the new fork directory.
- The prompt passed to `codex exec` prepends the contents of
  `game-build-prompt.md` before the user prompt text.
- `codex exec` invocation must safely handle arbitrary prompt content
  (newlines/special characters/quotes); do not rely on fragile shell string
  interpolation.

## Versioning and Isolation (V1 Default)

- Each game version lives in `/games/<version-id>/`.
- Metadata lives in each game directory in `metadata.json`.
- `metadata.json` must include at least:
  - `id`
  - `parentId`
  - `createdTime` (used for homepage sorting on `/`)
- Each game directory has its own `package.json`.
- `node_modules` exists inside each game directory when that game is installed,
  run, or built.
- Dependencies install per game directory via npm prefix/scoped commands.
- Forking a game creates a new lineage by copying a game directory, then
  iterating independently.

## Future

- Move to an async `change_request` queue-based generation pipeline.
- Add background LLM/Codex ideation that creates new versions without direct
  user prompts.
- Add async UI notifications and job-status tracking for generated versions.

## Initial Milestones

1. Create initial `docs/overview.md` in the required AGENTS format, including
   `Project`, `Repo structure`, `Most important code paths`, `Data stores`, and
   `Testing`.
2. Create `game-build-prompt.md` with:
   - pointers to `game-plan.md` and phase docs
   - simple geometric-shape game style guidance
   - phone-first constraints and a `9:16` portrait primary target
3. Build first playable game version: a single ball that continuously bounces
   around the screen and reflects cleanly off all four screen edges.
4. Build homepage game-picker grid with exactly three squares per row and all
   versions listed.
5. Build reverse-chron homepage feed behavior by sorting on
   `metadata.json.createdTime` when `/` is requested.
6. Build game view with floating top-right `✏️` button and slide-down prompt
   panel.
7. Implement prompt submission on Return/Go as fire-and-forget: fork first,
   then run `codex exec` in the new fork directory with
   `game-build-prompt.md` prepended to the user prompt using safe prompt
   passing that supports arbitrary characters/newlines.
8. Make root `npm run dev` build and serve games automatically with watch-mode
   rebuilds on game source changes.
9. Make root `npm run build` include game builds for production output.
10. Implement per-game sandbox directories with isolated dependency/version
    control.

## Success Criteria

- Users can browse all versions from the homepage (three tiles per row) and
  open any version to play.
- Homepage ordering is based on `metadata.json.createdTime` and new fork
  directories appear on the next `/` request.
- Pressing Return/Go in the slide-down prompt box triggers fire-and-forget
  fork-then-edit behavior: backend runs `codex exec` against the new fork with
  `game-build-prompt.md` prepended, handling arbitrary prompt formatting safely.
- `npm run dev` builds, serves, and watches games; source edits trigger rebuilds.
- `npm run build` includes game builds for production.
- Per-game dependency isolation prevents framework changes from breaking old
  games.
