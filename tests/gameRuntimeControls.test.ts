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
        { particleAmount: 4, showHud: true },
        { globals: { particleAmount: 7 } }
      )
    ).toEqual({
      particleAmount: 7,
      showHud: true
    });
  });

  it('rejects invalid slider metadata', () => {
    expect(
      parseGameEditorSliders([
        {
          id: 'particleAmount',
          label: 'Amount of particles',
          min: 1,
          max: 10,
          step: 0,
          globalKey: 'particleAmount'
        }
      ])
    ).toBeNull();
  });

  it('resolves runtime sliders only for numeric global keys', () => {
    const sliders = parseGameEditorSliders([
      {
        id: 'particleAmount',
        label: 'Amount of particles',
        min: 1,
        max: 10,
        step: 1,
        globalKey: 'particleAmount'
      },
      {
        id: 'missing',
        label: 'Missing value',
        min: 1,
        max: 10,
        step: 1,
        globalKey: 'missingValue'
      }
    ]);
    if (sliders === null) {
      throw new Error('Expected valid slider definitions');
    }

    expect(
      resolveRuntimeSliders(
        {
          particleAmount: 8,
          showHud: true
        },
        sliders
      )
    ).toEqual([
      {
        id: 'particleAmount',
        label: 'Amount of particles',
        min: 1,
        max: 10,
        step: 1,
        globalKey: 'particleAmount',
        value: 8
      }
    ]);
  });

  it('clamps persisted slider globals into range and step', () => {
    const sliders = parseGameEditorSliders([
      {
        id: 'particleAmount',
        label: 'Amount of particles',
        min: 1,
        max: 10,
        step: 1,
        globalKey: 'particleAmount'
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
          particleAmount: 12.4
        },
        sliders
      )
    ).toEqual({
      particleAmount: 10
    });
  });
});
