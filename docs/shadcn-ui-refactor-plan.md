# React + TypeScript Refactor Plan for Game Controls

## Goal
Refactor the current game controls implementation to be:
- fully React-driven in UI state and rendering,
- immutable in state transitions,
- one-way in data flow,
- TypeScript-first (port non-JS code in the control layer to TS where applicable).

This plan intentionally focuses only on Reactification and TypeScript migration.

## Scope and non-negotiable behavior parity

### Behavior parity requirements
The refactor must preserve all existing behavior:
1. Three-level bottom-panel behavior:
   - closed,
   - edit-open,
   - transcript-expanded.
2. Partial panel/toolbar motion updates as prompt textarea grows.
3. Existing focus management, keyboard submit shortcut, transcript open/close interactions, and recording-related interactions.
4. Existing control dimensions and interaction timing.

### Migration scope
In scope:
- React componentization of game controls.
- Immutable reducer/state-machine style state transitions.
- Side effects moved into hooks.
- Porting relevant non-JS code to TS in this UI/control surface.

Out of scope:
- style-system changes,
- theme changes,
- visual redesign efforts.

## Target architecture

### 1) Single source of truth state (React)
Use a central reducer (`useReducer`) for controls/UI state.

```ts
type PanelMode = 'closed' | 'edit' | 'transcript';

type GameUiState = {
  panelMode: PanelMode;
  promptText: string;
  textareaHeightPx: number;
  drawerHeightPx: number;
  isRecording: boolean;
  isTranscribing: boolean;
  isGenerating: boolean;
  isFavorited: boolean;
  isTileCaptureBusy: boolean;
};
```

Principles:
- derive UI from state at render time,
- avoid state stored in DOM attributes/classes,
- avoid reading UI state from DOM.

### 2) Immutable transitions
Define typed actions and pure reducer logic.

```ts
type GameUiAction =
  | { type: 'TOGGLE_EDIT' }
  | { type: 'TOGGLE_TRANSCRIPT' }
  | { type: 'SET_PROMPT_TEXT'; text: string }
  | { type: 'SET_TEXTAREA_HEIGHT'; px: number }
  | { type: 'SET_DRAWER_HEIGHT'; px: number }
  | { type: 'SET_RECORDING'; value: boolean }
  | { type: 'SET_TRANSCRIBING'; value: boolean }
  | { type: 'SET_GENERATING'; value: boolean }
  | { type: 'SET_FAVORITED'; value: boolean }
  | { type: 'SET_TILE_CAPTURE_BUSY'; value: boolean };
```

Rules:
- no in-place mutation,
- no reducer side effects,
- deterministic state transitions.

### 3) Declarative rendering
- Render class names/ARIA directly from state.
- Keep derived selectors in pure functions.
- Treat DOM refs as imperative escape hatches only (canvas/media/focus/measurement).

### 4) Side-effect boundaries
Extract imperative behavior into focused hooks:
- `useTranscriptPolling`,
- `useRealtimeRecording`,
- `useCanvasAnnotation`,
- `usePromptMeasurement`.

Hooks perform effects; reducer remains pure.

## TypeScript migration plan

### TS migration objectives
- Port control-related non-JS modules/files to `.ts`/`.tsx`.
- Eliminate untyped state/event payloads in this area.
- Introduce explicit types for:
  - reducer state/actions,
  - transcript payloads,
  - recording lifecycle state,
  - measurement payloads.

### TS migration steps
1. Introduce `GameUiState`, `GameUiAction`, and reducer in TS.
2. Port React control components to `.tsx` with typed props.
3. Port control hooks to `.ts` with typed contracts.
4. Add shared type module(s) for API payload contracts used by controls.
5. Remove legacy JS code paths once TS parity is complete.

### TS quality gates
- Strictly typed action handling (exhaustive reducer checks).
- No `any` in new control-layer code.
- Narrow unknown payloads via runtime guards where needed.

## Phased execution plan

### Phase 0 — Baseline behavior capture
1. Capture behavior matrix for key states/motions.
2. Add/refresh E2E coverage for:
   - panel mode transitions,
   - textarea-growth motion,
   - focus and keyboard submit behavior,
   - transcript and recording flows.

### Phase 1 — React shell and reducer
1. Introduce a React root for controls.
2. Add reducer + action model in TS.
3. Keep existing behavior through adapter layer while migrating.

### Phase 2 — Component migration
1. Split controls into typed React components:
   - toolbar,
   - prompt panel,
   - transcript panel,
   - action rows.
2. Move all rendering decisions to React state/selectors.

### Phase 3 — Hook extraction and imperative isolation
1. Move polling/recording/canvas logic into dedicated hooks.
2. Remove mutable globals and DOM-class-toggling as state carriers.

### Phase 4 — TS completion
1. Port remaining in-scope non-JS control files to TS/TSX.
2. Remove compatibility shims.
3. Ensure typed API boundaries and reducer exhaustiveness.

### Phase 5 — Validation and cleanup
1. Run checks sequentially:
   1. `npm run typecheck`
   2. `npm run lint`
2. Run E2E suite for migrated behavior paths.
3. Remove dead legacy code after parity verification.

## Acceptance criteria
A refactor pass is complete when:
1. UI behavior is unchanged from baseline.
2. Control rendering is fully React state-driven.
3. Control-layer non-JS code in scope is ported to TS/TSX.
4. Reducer transitions are immutable and typed.
5. E2E coverage validates preserved behavior for all panel modes and textarea-growth motion.
