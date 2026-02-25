import { describe, expect, it } from 'vitest';

import {
  MAX_SNAPSHOTS,
  MAX_TOTAL_FRAMES,
  STARTER_HEADLESS_VIEWPORT,
  parseStarterHeadlessProtocol
} from '../games/starter/src/headless/protocol';

describe('starter headless protocol parser', () => {
  it('parses a valid steps-only protocol with fixed limits', () => {
    const parsed = parseStarterHeadlessProtocol({
      steps: [{ run: 5 }, { snap: 'done' }]
    });

    expect(parsed.steps).toEqual([{ run: 5 }, { snap: 'done' }]);
  });

  it('rejects legacy top-level protocol fields', () => {
    expect(() => {
      parseStarterHeadlessProtocol({
        v: 1,
        steps: [{ run: 1 }]
      });
    }).toThrow('Unsupported top-level field "v"');
  });

  it(`rejects scripts that exceed the fixed frame limit of ${MAX_TOTAL_FRAMES}`, () => {
    expect(() => {
      parseStarterHeadlessProtocol({
        steps: [{ run: MAX_TOTAL_FRAMES - 1 }, { run: 2 }]
      });
    }).toThrow(`exceeds frame limit ${MAX_TOTAL_FRAMES}`);
  });

  it(`rejects scripts that exceed the fixed snapshot limit of ${MAX_SNAPSHOTS}`, () => {
    expect(() => {
      parseStarterHeadlessProtocol({
        steps: [{ snap: 'one' }, { snap: 'two' }]
      });
    }).toThrow(`exceeds snapshot limit ${MAX_SNAPSHOTS}`);
  });

  it('rejects pixel-space input outside the fixed viewport bounds', () => {
    expect(() => {
      parseStarterHeadlessProtocol({
        steps: [
          {
            input: {
              action: 'down',
              pointerId: 1,
              x: STARTER_HEADLESS_VIEWPORT.width + 1,
              y: 100,
              space: 'pixels',
              emit: 'touch'
            }
          }
        ]
      });
    }).toThrow(`steps[0].input.x must be between 0 and ${STARTER_HEADLESS_VIEWPORT.width}`);
  });
});
