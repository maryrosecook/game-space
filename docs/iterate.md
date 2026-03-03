1. Single ideation track: base-game-first generation
   - Collapse Track A/Track B into one path: every ideation request starts from a base game.
   - Keep ideation on `/api/ideas/generate`; no separate refine endpoint/action.
   - Use Claude via `claude --print` in `src/services/ideaGeneration.ts`.
   - Configure ideation to run with maximum thinking and exactly one turn.
   - Require base game context for every generation request; default base game is `starter`.
2. UI entry points and actions
   - Ideas page:
     - Keep a single `Generate` button flow (no prompt/instructions input).
     - Add a required game selector that defaults to `starter` and also lists all starred games.
     - Render selector options with small game thumbnails.
   - Game page tab bar:
     - Add a new icon-only button next to `Build`.
     - Button uses a lightbulb icon and no text label.
     - Clicking it triggers `/api/ideas/generate` in fire-and-forget mode using the current game as base.
     - Ideation results are not required to render immediately on the game page; user sees new ideas when they later open the Ideas page.
   - Preserve existing CSRF/auth behavior for all mutation routes.
3. Data model and list rendering
   - Keep `ideas.json` backward compatible while ensuring each idea records its base game identity.
   - Store enough base-game metadata to render thumbnails in idea rows.
   - Update idea rows on the Ideas page to render in this order:
     - base-game thumbnail (starter or starred game)
     - idea prompt text
     - existing per-idea action buttons (unchanged)
   - Update/remove any refine- or prompt-entry-related UI/text/config elements that no longer apply.
4. Docs and prompt alignment
   - Update `games/starter/README.md` so gameplay-specific content (bouncing ball, particles, etc.) is moved under a new `## The Game` section.
   - Update `game-build-prompt` with terse instructions to keep `./README.md` `## The Game` up to date with a high-level outline of:
     - gameplay
     - graphics
     - input
5. Testing
   - Unit tests (TypeScript):
     - Claude ideation invocation/parsing with max-thinking single-turn settings.
     - Cancellation/failure handling.
     - Base-game request normalization and persistence.
   - E2E tests (Playwright):
     - Ideas page generate flow using default `starter` selector.
     - Ideas page generate flow using a starred game selector option with thumbnail.
     - Game-page lightbulb button fire-and-forget ideation trigger, with resulting idea visible on subsequent Ideas page visit.
   - Reuse existing test idioms/mocks in `tests/` and `tests/e2e/`.
6. Validation, review, and execution order
   - Suggested implementation order:
     1. Backend ideation service and request shape (single track, base-game-required, Claude settings).
     2. Ideas page selector and list thumbnail updates.
     3. Game page tab-bar lightbulb trigger.
     4. Docs/prompt alignment and stale copy cleanup.
   - Validation:
     - Run targeted tests for touched paths.
     - Run `npm run typecheck` then `npm run lint` (sequentially, in that order).
     - Run final code review pass using the repo’s review prompt.
     - Update `docs/overview.md` only if endpoint/data-flow architecture changes.
