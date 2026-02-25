import { describe, expect, it } from 'vitest';

import { SyntheticInputEvent } from '../games/starter/src/engine/input';
import {
  executeStarterHeadlessProtocol,
  StarterHeadlessScriptDriver
} from '../games/starter/src/headless/executor';
import { parseStarterHeadlessProtocol } from '../games/starter/src/headless/protocol';

type DriverCall =
  | { type: 'run'; frames: number }
  | { type: 'input'; event: SyntheticInputEvent }
  | { type: 'snap' };

type DriverFixture = {
  readonly calls: readonly DriverCall[];
  readonly driver: StarterHeadlessScriptDriver;
};

function createDriverFixture(): DriverFixture {
  const calls: DriverCall[] = [];
  let frameCount = 0;

  const driver: StarterHeadlessScriptDriver = {
    runFrames: async (frames) => {
      calls.push({ type: 'run', frames });
      frameCount += frames;
    },
    applyInput: async (event) => {
      calls.push({ type: 'input', event });
    },
    captureSnapshot: async () => {
      calls.push({ type: 'snap' });
      return {
        frame: frameCount,
        pngDataUrl: 'data:image/png;base64,AA=='
      };
    },
    readFrameCount: async () => frameCount
  };

  return {
    calls,
    driver
  };
}

describe('starter headless executor', () => {
  it('executes steps sequentially with normalized input conversion and snapshot bookkeeping', async () => {
    const protocol = parseStarterHeadlessProtocol({
      steps: [
        { run: 5 },
        {
          input: {
            action: 'down',
            pointerId: 2,
            x: 0.5,
            y: 0.25,
            space: 'norm01',
            emit: 'touch'
          }
        },
        { run: 4 },
        { snap: 'after-input' }
      ]
    });

    const fixture = createDriverFixture();
    const result = await executeStarterHeadlessProtocol(protocol, fixture.driver);

    expect(fixture.calls).toEqual([
      { type: 'run', frames: 5 },
      {
        type: 'input',
        event: {
          action: 'down',
          pointerId: 2,
          clientX: 180,
          clientY: 160,
          source: 'touch'
        }
      },
      { type: 'run', frames: 4 },
      { type: 'snap' }
    ]);

    expect(result.frameCount).toBe(9);
    expect(result.captures).toEqual([
      {
        label: 'after-input',
        frame: 9,
        pngDataUrl: 'data:image/png;base64,AA=='
      }
    ]);
  });

  it('preserves emit: both as one logical input event', async () => {
    const protocol = parseStarterHeadlessProtocol({
      steps: [
        {
          input: {
            action: 'down',
            pointerId: 7,
            x: 30,
            y: 40,
            space: 'pixels',
            emit: 'both'
          }
        }
      ]
    });

    const fixture = createDriverFixture();
    await executeStarterHeadlessProtocol(protocol, fixture.driver);

    expect(fixture.calls).toEqual([
      {
        type: 'input',
        event: {
          action: 'down',
          pointerId: 7,
          clientX: 30,
          clientY: 40,
          source: 'both'
        }
      }
    ]);
  });

  it('fails when runtime exceeds maxRunSeconds', async () => {
    const protocol = parseStarterHeadlessProtocol({
      steps: [{ run: 1 }]
    });

    const fixture = createDriverFixture();
    const times = [0, 2000, 2001];
    let index = 0;

    await expect(() =>
      executeStarterHeadlessProtocol(protocol, fixture.driver, {
        nowMs: () => {
          const value = times[index] ?? times[times.length - 1] ?? 2001;
          index += 1;
          return value;
        },
        maxRunSeconds: 1
      })
    ).rejects.toThrow('Headless run exceeded max runtime');
  });
});
