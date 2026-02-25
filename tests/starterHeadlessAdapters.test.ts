import { describe, expect, it } from 'vitest';

import { HeadlessFrameScheduler } from '../games/starter/src/engine/frameScheduler';
import { HeadlessInputManager, InputSurface } from '../games/starter/src/engine/input';

class HeadlessCanvas implements InputSurface {
  readonly style = {
    touchAction: ''
  };

  addEventListener(): void {
    return;
  }

  removeEventListener(): void {
    return;
  }

  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return {
      left: 0,
      top: 0,
      width: 100,
      height: 200
    };
  }
}

describe('starter headless frame scheduler', () => {
  it('steps deterministic frame callbacks without wall-clock RAF', () => {
    const scheduler = new HeadlessFrameScheduler(16);
    let ticks = 0;

    const callback: FrameRequestCallback = () => {
      ticks += 1;
      scheduler.requestFrame(callback);
    };

    scheduler.requestFrame(callback);
    scheduler.step(5);

    expect(ticks).toBe(5);
  });

  it('supports canceling a queued callback before stepping', () => {
    const scheduler = new HeadlessFrameScheduler();
    let ticks = 0;

    const handle = scheduler.requestFrame(() => {
      ticks += 1;
    });
    scheduler.cancelFrame(handle);
    scheduler.step(1);

    expect(ticks).toBe(0);
  });
});

describe('starter headless input manager', () => {
  it('tracks synthetic pointer events and emits touch-frame coordinates', () => {
    const canvas = new HeadlessCanvas();
    const inputManager = new HeadlessInputManager();
    inputManager.attach(canvas);

    inputManager.applySyntheticEvent({
      action: 'down',
      pointerId: 4,
      clientX: 50,
      clientY: 100,
      source: 'touch'
    });

    expect(inputManager.consumeFrame(canvas)).toEqual({
      touches: [
        {
          id: 4,
          clientX: 50,
          clientY: 100,
          normalizedX: 0,
          normalizedY: 0
        }
      ],
      tapCount: 0
    });
  });

  it('counts one tap for emit: both on down/up at the same location', () => {
    const canvas = new HeadlessCanvas();
    const inputManager = new HeadlessInputManager();
    inputManager.attach(canvas);

    inputManager.applySyntheticEvent({
      action: 'down',
      pointerId: 9,
      clientX: 20,
      clientY: 30,
      source: 'both'
    });
    inputManager.applySyntheticEvent({
      action: 'up',
      pointerId: 9,
      clientX: 20,
      clientY: 30,
      source: 'both'
    });

    expect(inputManager.consumeFrame(canvas)).toEqual({
      touches: [],
      tapCount: 1
    });
  });
});
