import { describe, expect, it } from 'vitest';

import {
  applySliderValuesToGlobals,
  mergeGameGlobals,
  normalizeSliderValue,
  parseGameEditorSliders,
  resolveRuntimeSliders,
} from '../src/gameRuntimeControls';

describe('game runtime controls helpers', () => {
  it('merges persisted globals over base globals', () => {
    expect(
      mergeGameGlobals(
        { particles: 4, showHud: true },
        { globals: { particles: 7 } }
      )
    ).toEqual({
      particles: 7,
      showHud: true
    });
  });

  it('rejects invalid slider metadata', () => {
    expect(
      parseGameEditorSliders([
        {
          id: 'particles',
          label: 'Particles',
          min: 1,
          max: 10,
          step: 0,
          globalKey: 'particles',
          gameDevRequested: false
        }
      ])
    ).toBeNull();

    expect(
      parseGameEditorSliders([
        {
          id: 'particles',
          label: 'Particles',
          min: 1,
          max: 10,
          step: 1,
          globalKey: 'particles'
        }
      ])
    ).toBeNull();
  });

  it('resolves runtime sliders only for numeric global keys', () => {
    const sliders = parseGameEditorSliders([
      {
        id: 'particles',
        label: 'Particles',
        min: 1,
        max: 10,
        step: 1,
        globalKey: 'particles',
        gameDevRequested: false
      },
      {
        id: 'missing',
        label: 'Missing value',
        min: 1,
        max: 10,
        step: 1,
        globalKey: 'missingValue',
        gameDevRequested: true
      }
    ]);
    if (sliders === null) {
      throw new Error('Expected valid slider definitions');
    }

    expect(
      resolveRuntimeSliders(
        {
          particles: 8,
          showHud: true
        },
        sliders
      )
    ).toEqual([
      {
        id: 'particles',
        label: 'Particles',
        min: 1,
        max: 10,
        step: 1,
        globalKey: 'particles',
        gameDevRequested: false,
        value: 8
      }
    ]);
  });

  it('clamps persisted slider globals into range and step', () => {
    const sliders = parseGameEditorSliders([
      {
        id: 'particles',
        label: 'Particles',
        min: 1,
        max: 10,
        step: 1,
        globalKey: 'particles',
        gameDevRequested: false
      }
    ]);
    if (sliders === null) {
      throw new Error('Expected valid slider definitions');
    }
    const slider = sliders[0];
    if (!slider) {
      throw new Error('Expected a slider definition');
    }

    expect(normalizeSliderValue(slider, 12.4)).toBe(10);
    expect(
      applySliderValuesToGlobals(
        {
          particles: 12.4
        },
        sliders
      )
    ).toEqual({
      particles: 10
    });
  });
});
