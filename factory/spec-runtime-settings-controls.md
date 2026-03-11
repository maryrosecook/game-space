## Objective

Add a minimal runtime settings system that supports auto-generated sliders for global values, and prove it out in `starter` with a single `particleAmount` slider that drives a falling-particle effect.

## Requirements

- Remove the visible “Describe a change” text from the microphone button and keep the existing microphone icon-only affordance.
- Replace the current Edit tab cog icon with a hammer icon to indicate prompt/build tools.
- Add a new settings tab with the cog icon immediately to the right of the hammer tab.
- Open the new settings panel as a bottom drawer that automatically slides to half the screen height; its contents must scroll if they overflow.
- Keep prompt/build tooling in the hammer drawer and reserve the cog drawer for generated settings controls only.
- Support slider-based settings for global values.
- Update `starter` so it renders particles that spawn just above the top of the screen and fall downward.
- Use three particle colors only: yellow, orange, and red.
- Randomize particle spawn positions and downward speeds so the effect feels alive.
- Add a global setting named `particleAmount` with a user-facing label of “Amount of particles”.
- Render the “Amount of particles” slider automatically from the game’s settings metadata rather than hardcoding a bespoke UI control.
- Set the slider range to `1..10` with integer steps, and use its value as a multiplier on the starter particle emission rate.
- Persist slider changes to per-version control state so refreshes keep the chosen `particleAmount`.

## Non-goals

- Expand beyond the initial global-slider path and the `starter` particle-amount demonstration.

## Architecture/approach

- Keep the existing architectural direction, centered on:
  - `globals`: JSON-serializable top-level tunables.
  - `editor.sliders`: declarative slider metadata for auto-generated settings UI.
- Use a slider schema with:
  - `id`
  - `label`
  - `min`
  - `max`
  - `step`
  - `globalKey`
- Keep the host/runtime bridge optional:
  - `startGame(canvas, host?)` remains compatible with legacy one-argument games.
  - The host passes `versionId` and settings persistence capabilities when available.
  - The runtime exposes only the minimal settings hooks needed now: `getSliders`, `setGlobalValue`, and `serializeControlState`.
- Persist settings without rewriting source:
  - Store saved global values in `games/<versionId>/control-state.json`.
  - Load the base game from code, then merge persisted global overrides at runtime.
  - Save debounced, atomic writes through a backend API route.
- Split the bottom toolbar into two admin drawers:
  - Hammer tab for prompt/build tools.
  - Cog tab for settings.
  - The settings drawer defaults to `50vh` height and scrolls internally on overflow.
- Prove the system with `starter` only:
  - Add `globals.particleAmount` to the starter game data.
  - Add one slider definition for `particleAmount`.
  - Spawn particles from just above the visible screen.
  - Choose each particle color randomly from yellow, orange, and red.
  - Randomize downward velocity and scale emission count/rate by `particleAmount`.

## Data changes/migrations

- Extend `GameFile` with optional `globals` and `editor.sliders`.
- Add a new optional per-version file: `games/<versionId>/control-state.json`.
- No migration is required for existing games; missing `globals`, slider metadata, or persisted control data means “no runtime settings UI”.

## Testing strategy

- Add TypeScript tests for control-state merge logic, slider metadata validation, global-key resolution, and backwards compatibility of the optional `startGame` host argument.
- Add engine tests for the starter particle system so emitted particles stay within the intended color set and respect the `particleVolume` multiplier.
- Add API tests for control-state read/write validation and atomic persistence.
- Add at least one Playwright E2E covering the toolbar changes: hammer tab, cog tab, icon-only microphone button, and settings drawer height/scroll behavior.
- Add at least one Playwright E2E covering the starter “Amount of particles” slider so changing it persists and affects the rendered particle density after reload.
