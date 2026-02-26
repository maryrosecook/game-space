# Shadcn UI Refactor Plan for Game Controls (React-First)

## Goal
Migrate the game control UI from bespoke styling to `shadcn/ui`-style primitives while preserving all current interaction behavior and control dimensions, while making the implementation as React-native as possible:
- immutable state updates,
- one-way data flow,
- render-driven UI,
- minimal state encoded in DOM classes/attributes,
- minimal direct DOM mutation.

## Non-negotiable behavior to preserve

### 1) Three-level bottom-panel motion
The interface must keep the same three-level sliding behavior:

1. **Closed (default)**
   - Prompt panel hidden.
   - Toolbar anchored at bottom.
2. **Edit open (tap cog/settings)**
   - Prompt panel slides up.
   - Toolbar shifts up by current drawer height.
3. **Transcript expanded (tap transcript button)**
   - Prompt panel expands to near/full viewport height.
   - Toolbar shifts to transcript-expanded offset.

Additionally, while edit is open, prompt textarea growth must continue to produce a **partial incremental toolbar slide** by updating drawer height as content grows.

### 2) Control geometry contracts (must not change)
Preserve effective dimensions for:
- bottom toolbar height (`--bottom-tab-height` equivalent),
- prompt textarea min/max height,
- button hit-area/padding footprints for edit, mic, build, favorite, transcript, capture, delete,
- render area and canvas layering behavior.

### 3) Interaction contracts (must not change)
Retain:
- ARIA semantics for toggles/expanded regions,
- focus behavior between prompt and transcript,
- transcript polling/open/close behavior,
- busy/recording/favorite state indicators,
- keyboard submit shortcut (`Cmd/Ctrl+Enter`),
- prompt auto-grow behavior and drawer-height tracking.

## React architecture principles

### State model (single source of truth)
Use one canonical UI state object (via `useReducer` preferred) rather than state distributed across DOM classes:

```ts
type PanelMode = 'closed' | 'edit' | 'transcript';

type GameUiState = {
  panelMode: PanelMode;
  promptText: string;
  promptRowsPx: number; // measured textarea height in px
  drawerHeightPx: number; // measured sheet height in px
  isRecording: boolean;
  isTranscribing: boolean;
  isFavorited: boolean;
  isGenerating: boolean;
  isTileCaptureBusy: boolean;
};
```

Rules:
- derive visual states from `GameUiState` in render,
- avoid mutating DOM class lists as primary state,
- avoid reading state back from DOM (`aria-expanded`, class names) except migration bridge code.

### Immutable updates
- Use reducer actions (`dispatch({ type: 'TOGGLE_EDIT' })`) and pure transitions.
- No in-place mutation of nested state.
- Keep side effects outside reducer (network calls, focus, measurement).

### Derived UI vs stored UI
Prefer selectors/derived values over storing duplicates:
- `isEditOpen = panelMode !== 'closed'`
- `isTranscriptExpanded = panelMode === 'transcript'`
- `toolbarTranslateY = computeToolbarOffset(panelMode, drawerHeightPx, viewportHeight)`

### Effects and refs (only where necessary)
Use effects for:
- textarea/sheet measurement via `ResizeObserver`/layout effect,
- focus management after mode changes,
- transcript polling lifecycle,
- integration with imperative canvas/recording APIs.

Use refs only for imperative integration points (canvas, media stream, transcript scroller), not as UI state containers.

## Refactor strategy (React-first)

## Phase 0 — Baseline capture and constraints
1. Capture behavior matrix for states:
   - closed/edit/transcript,
   - textarea at min and max,
   - recording idle/recording/busy,
   - favorite on/off.
2. Add/update Playwright E2E tests for state transitions and motion offsets.
3. Snapshot control geometry (bounding boxes/computed heights).

## Phase 1 — Introduce React UI shell + reducer
1. Build a React container for game controls around existing APIs.
2. Implement `useReducer` with immutable transitions for all control state.
3. Render classes/data attributes from reducer state (temporary compatibility layer).
4. Keep existing IDs/selectors where needed for backward compatibility during migration.

## Phase 2 — Convert DOM-state toggles to render-state
1. Replace imperative class toggles with declarative render logic:
   - `className={cn(..., panelMode === 'edit' && '...')}`
2. Move ARIA attributes to render output from state.
3. Replace manual "state-in-the-dom" branching with selectors from reducer state.

## Phase 3 — Shadcn/ui visual migration
1. Swap bespoke controls to shadcn/ui-style components (Button, Textarea, Sheet/Card patterns).
2. Keep geometry constants fixed to preserve control footprints.
3. Allow stylistic changes (light theme, border radius/shadows) without dimensional drift.

## Phase 4 — Measurement-driven motion
1. Use measured heights as data:
   - textarea content height,
   - prompt sheet total height.
2. Feed measurements into reducer actions (`DRAWER_HEIGHT_CHANGED`, `PROMPT_HEIGHT_CHANGED`).
3. Compute transforms from state and measurements, not from ad-hoc DOM mutation.
4. Preserve exact 3-stage motion semantics.

## Phase 5 — Side-effect isolation and cleanup
1. Isolate imperative integrations into hooks/modules:
   - `useTranscriptPolling`,
   - `useRealtimeRecording`,
   - `useCanvasAnnotation`.
2. Remove obsolete mutable globals and class-toggle code.
3. Keep only minimal imperative escapes for browser APIs.

## Phase 6 — Validation and hardening
1. Run checks sequentially:
   1. `npm run typecheck`
   2. `npm run lint`
2. Run E2E tests for toolbar/panel transitions and geometry invariants.
3. Validate no regression in touch/pointer behavior over canvas.

## Implementation notes
- Prefer a **state-machine-ish reducer** for panel transitions:
  - `closed -> edit`,
  - `edit -> transcript`,
  - `transcript -> edit`,
  - `edit -> closed`.
- Keep mutation localized to integration hooks; keep React state immutable.
- Keep IDs stable during migration; once complete, migrate tests to semantic selectors (`role`, `name`, `data-testid`) where appropriate.

## Suggested E2E assertions (minimum)
1. Tapping settings transitions state `closed -> edit`, shows prompt sheet, and moves toolbar by drawer height.
2. Typing multiline prompt increases measured textarea/sheet height and updates toolbar offset incrementally.
3. Tapping transcript transitions `edit -> transcript` and applies full-height expansion.
4. Closing transcript transitions `transcript -> edit` and restores textarea focus.
5. Control bounding boxes (height/width) remain unchanged within strict tolerance.
6. ARIA `expanded` and visible regions always match reducer state (no DOM/state divergence).
