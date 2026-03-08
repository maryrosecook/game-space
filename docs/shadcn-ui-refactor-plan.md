# Shadcn UI Refactor Plan for Game View Controls

## Goal
Refactor the game controls to use the **default `shadcn/ui` light theme** (not a custom dark variant) while preserving all current behavior and control dimensions.

## Theme Direction (explicit)

- Use `shadcn/ui`'s default light token set as the migration baseline.
- Avoid introducing custom theme overrides during the initial refactor unless they are strictly needed to preserve dimensions/behavior.
- Treat any color, border, and surface changes from adopting the default light theme as acceptable, but preserve interaction behavior and control geometry.

## Behavior and UX Invariants (must not change)

1. **Three toolbar elevation levels stay intact:**
   - **Level 1 (collapsed):** only bottom toolbar row visible over game.
   - **Level 2 (edit open):** tapping the settings/cog opens prompt panel, toolbar shifts up by drawer height.
   - **Level 3 (transcript expanded):** tapping transcript button expands drawer to near/full screen and toolbar shifts up to top of drawer region.
2. **Prompt textarea growth changes drawer height dynamically** as the user types.
3. **Control dimensions remain functionally identical** (tap targets, spacing, panel heights, textarea min/max height).
4. **Existing keyboard and accessibility behavior remains** (`aria-expanded`, `aria-hidden`, submit with Cmd/Ctrl+Enter, focus return behavior).
5. **Voice recording/transcription and annotation flow remains unchanged** (including overlay and drawing canvas behaviors).

## Current Architecture Snapshot

- Markup is server-rendered in `renderGameView` (`src/views.ts`) with IDs used as JS hooks.
- Interaction logic is centralized in `src/public/game-view.js` with a reducer-like UI state:
  - `editPanelOpen`
  - `codexPanelExpanded`
  - `recordingInProgress`
  - etc.
- Motion/layout are currently class-driven in `src/public/styles.css`:
  - `.prompt-panel`, `.prompt-panel--open`
  - `.game-page--edit-open`, `.game-page--codex-expanded`
  - CSS var `--edit-drawer-height`
- Textarea auto-resize (`resizePromptInput`) recalculates panel height and updates `--edit-drawer-height`.

## Proposed Refactor Strategy

### Phase 0: Baseline capture (before visual migration)
1. Capture control metrics from live DOM (buttons, textarea min/max height, bottom tab height, panel paddings, gaps).
2. Add or update E2E coverage for:
   - Cog toggles edit drawer.
   - Transcript toggle expands to full-screen state.
   - Textarea growth raises drawer and shifts toolbar.
3. Record baseline screenshots for comparison.

### Phase 1: Introduce `shadcn/ui` primitives with compatibility wrappers
1. Add lightweight wrappers (or class adapters) for target primitives:
   - `Button` (for toolbar actions)
   - `Textarea` (prompt input)
   - `Sheet`/`Drawer`-style container (prompt panel shell)
   - `ScrollArea` for transcript body if needed
2. Keep existing IDs and data/aria attributes to avoid breaking `game-view.js` during migration.
3. Use `className` passthrough to retain exact sizing tokens while allowing default light theme surface styles.

### Phase 2: Separate behavior state from presentation classes
1. Replace direct class toggles with semantic state attributes on root/panel (e.g. `data-edit-open`, `data-codex-expanded`).
2. Keep `applyBottomPanelState` as single state-to-DOM sync point.
3. Preserve and explicitly test:
   - `toggleEditPanel` collapsing transcript when closing edit panel.
   - `toggleCodexPanelExpanded` auto-opening edit panel first.

### Phase 3: Rebuild layout with shadcn-themed styling while preserving geometry
1. Migrate toolbar and panel styling to the default `shadcn/ui` light theme tokens.
2. Lock dimensions with explicit CSS custom properties sourced from baseline:
   - button heights/paddings
   - icon button square sizes
   - textarea `min-height`/`max-height`
   - drawer paddings/gaps
3. Preserve transform-based slide mechanics:
   - closed: drawer translated below viewport
   - edit-open: bottom tabs offset by `--edit-drawer-height`
   - transcript-expanded: drawer fills `100dvh - --bottom-tab-height`

### Phase 4: Transcript and prompt content area parity
1. Keep transcript mount node stable (`#game-codex-session-view`) for presenter integration.
2. Ensure transcript auto-scroll behavior remains in expanded mode.
3. Verify prompt submit reset behavior still clears textarea, canvas, and overlay state.

### Phase 5: Cleanup and hardening
1. Remove obsolete legacy-only classes once selectors are migrated.
2. Consolidate sizing constants and theme variables in one place.
3. Confirm no regressions in admin-only vs public game view rendering paths.

## Detailed Acceptance Checklist

- [ ] Tapping cog opens prompt drawer and sets `aria-expanded=true` on edit button.
- [ ] Tapping cog again closes prompt drawer and transcript expansion.
- [ ] Tapping transcript button opens edit drawer (if closed) and expands transcript region.
- [ ] Tapping transcript again collapses transcript and returns prompt focus.
- [ ] Typing multi-line prompt increases textarea height (clamped to max) and shifts toolbar upward.
- [ ] Cmd/Ctrl+Enter still submits prompt.
- [ ] Submit still clears prompt, overlay text, and annotation canvas.
- [ ] Record button behavior unchanged (including busy/disabled visual state timing).
- [ ] Favorite, tile capture, and delete buttons retain tap target size and action wiring.

## E2E Test Plan (to implement during refactor)

1. `game-toolbar-levels.spec.ts`
   - Assert initial collapsed state.
   - Click edit/cog; verify edit-open class/attribute and vertical shift.
   - Click transcript; verify expanded state and transcript visible.
2. `game-prompt-resize.spec.ts`
   - Fill textarea with multi-line text; assert height increase and bounded max.
   - Assert bottom toolbar transform changes with drawer height.
3. `game-controls-parity.spec.ts`
   - Keyboard submit shortcut.
   - Focus management on transcript toggle.
   - Core action buttons still present with unchanged bounding box dimensions (within tolerance).

## Risk Areas and Mitigations

- **Risk:** Visual library defaults change spacing/size.
  - **Mitigation:** Pin dimensions with explicit CSS vars and DOM measurement assertions in E2E.
- **Risk:** Behavior regressions from changing selectors/IDs.
  - **Mitigation:** Preserve IDs until final cleanup; migrate incrementally.
- **Risk:** Full-screen expanded mode breaks on mobile viewport changes.
  - **Mitigation:** Keep `100dvh` logic and test on mobile emulation.

## Rollout Notes

- Land in small PRs by phase.
- Keep each PR behavior-safe with updated E2E tests.
- If user-visible behavior changes in any phase, include corresponding `video-tests` selectors in PR body.
