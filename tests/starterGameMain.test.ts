import { describe, expect, it, vi } from 'vitest';

import {
  advanceAxisInBounds,
  clampDeltaSeconds,
  consumeFixedSteps,
  createAssetStore,
  createFixedStepTicker,
  createRandom,
  createSceneMachine,
  createTouchInputMapper,
  createTouchStateTracker,
  tickAnimationLoop,
  type LoopTickContext,
  type PointerTouchEventTarget
} from '../games/starter/src/runtime';
import { createCircleVertices, updateStarterCircle } from '../games/starter/src/starterGame';

type PointerEventName = 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel';

type TestPointerEvent = {
  type: PointerEventName;
  pointerType: string;
  pointerId: number;
  clientX: number;
  clientY: number;
  preventDefault: () => void;
};

class TestPointerTarget implements PointerTouchEventTarget {
  private readonly listeners: Record<PointerEventName, Array<(event: PointerEvent) => void>> = {
    pointerdown: [],
    pointermove: [],
    pointerup: [],
    pointercancel: []
  };

  addEventListener(
    type: PointerEventName,
    listener: (event: PointerEvent) => void,
    options?: boolean | AddEventListenerOptions
  ): void {
    void options;
    this.listeners[type].push(listener);
  }

  removeEventListener(
    type: PointerEventName,
    listener: (event: PointerEvent) => void,
    options?: boolean | EventListenerOptions
  ): void {
    void options;
    this.listeners[type] = this.listeners[type].filter((candidate) => candidate !== listener);
  }

  dispatchPointerEvent(event: TestPointerEvent): void {
    for (const listener of this.listeners[event.type]) {
      listener(event as PointerEvent);
    }
  }
}

function createTestPointerEvent(event: Partial<TestPointerEvent> & Pick<TestPointerEvent, 'type'>): TestPointerEvent {
  return {
    pointerType: event.pointerType ?? 'touch',
    pointerId: event.pointerId ?? 1,
    clientX: event.clientX ?? 0,
    clientY: event.clientY ?? 0,
    preventDefault: event.preventDefault ?? (() => {}),
    type: event.type
  };
}

function createTestRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    width,
    height,
    left,
    top,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({})
  } as DOMRect;
}

describe('starter game shapes', () => {
  it('creates a triangle fan centered at origin with a closed circle edge', () => {
    const vertices = createCircleVertices(4);

    expect(vertices.length).toBe(12);
    expect(vertices[0]).toBe(0);
    expect(vertices[1]).toBe(0);
    expect(vertices[2]).toBeCloseTo(1);
    expect(vertices[3]).toBeCloseTo(0);
    expect(vertices[10]).toBeCloseTo(1);
    expect(vertices[11]).toBeCloseTo(0);
  });
});

describe('starter game circle update', () => {
  it('updates position from velocity when the circle stays in bounds', () => {
    const circle = {
      x: 0,
      y: 0,
      velocityX: 0.62,
      velocityY: -0.78,
      radius: 0.12
    };

    const updatedCircle = updateStarterCircle(circle, 0.5, 1);

    expect(updatedCircle.x).toBeCloseTo(0.31);
    expect(updatedCircle.y).toBeCloseTo(-0.39);
    expect(updatedCircle.velocityX).toBeCloseTo(0.62);
    expect(updatedCircle.velocityY).toBeCloseTo(-0.78);
  });

  it('clamps at the wall and reverses velocity when the circle hits bounds', () => {
    const circle = {
      x: 0.86,
      y: -0.86,
      velocityX: 0.8,
      velocityY: -0.8,
      radius: 0.12
    };

    const updatedCircle = updateStarterCircle(circle, 0.2, 1);

    expect(updatedCircle.x).toBeCloseTo(0.88);
    expect(updatedCircle.y).toBeCloseTo(-0.88);
    expect(updatedCircle.velocityX).toBeCloseTo(-0.8);
    expect(updatedCircle.velocityY).toBeCloseTo(0.8);
  });
});

describe('starter built-ins', () => {
  it('maps touch snapshots to action states', () => {
    const inputMapper = createTouchInputMapper({
      jump: {
        down: (touches) => touches.some((touch) => touch.normalizedY < 0),
        pressed: (tapCount) => tapCount > 0
      },
      fire: {
        pressed: (tapCount, touches) => tapCount > 1 || touches.length > 1
      }
    });
    const actionState = inputMapper.map({
      tapCount: 1,
      touches: [
        {
          id: 2,
          x: 30,
          y: 40,
          normalizedX: -0.4,
          normalizedY: -0.25
        }
      ]
    });

    expect(actionState.isDown('jump')).toBe(true);
    expect(actionState.wasPressed('jump')).toBe(true);
    expect(actionState.wasPressed('fire')).toBe(false);
  });

  it('tracks touch pointers and tap presses from pointer events', () => {
    const target = new TestPointerTarget();
    const canvas = {
      getBoundingClientRect: () => createTestRect(10, 20, 100, 200)
    } as HTMLCanvasElement;

    const tracker = createTouchStateTracker(target, canvas);

    const touchDownPreventDefault = vi.fn();
    target.dispatchPointerEvent(
      createTestPointerEvent({
        type: 'pointerdown',
        pointerId: 5,
        clientX: 35,
        clientY: 70,
        preventDefault: touchDownPreventDefault
      })
    );

    const activeSnapshot = tracker.snapshot();
    expect(activeSnapshot.tapCount).toBe(0);
    expect(activeSnapshot.touches).toHaveLength(1);
    expect(activeSnapshot.touches[0]?.normalizedX).toBeCloseTo(-0.5);
    expect(activeSnapshot.touches[0]?.normalizedY).toBeCloseTo(-0.5);
    expect(touchDownPreventDefault).toHaveBeenCalledTimes(1);

    const touchUpPreventDefault = vi.fn();
    target.dispatchPointerEvent(
      createTestPointerEvent({
        type: 'pointerup',
        pointerId: 5,
        clientX: 39,
        clientY: 76,
        preventDefault: touchUpPreventDefault
      })
    );

    const tapSnapshot = tracker.snapshot();
    expect(tapSnapshot.touches).toHaveLength(0);
    expect(tapSnapshot.tapCount).toBe(1);
    expect(touchUpPreventDefault).toHaveBeenCalledTimes(1);
    expect(tracker.snapshot().tapCount).toBe(0);

    const mousePreventDefault = vi.fn();
    target.dispatchPointerEvent(
      createTestPointerEvent({
        type: 'pointerdown',
        pointerType: 'mouse',
        pointerId: 9,
        clientX: 80,
        clientY: 120,
        preventDefault: mousePreventDefault
      })
    );
    expect(tracker.snapshot().touches).toHaveLength(0);
    expect(mousePreventDefault).not.toHaveBeenCalled();

    tracker.dispose();
    target.dispatchPointerEvent(
      createTestPointerEvent({
        type: 'pointerdown',
        pointerId: 5,
        clientX: 40,
        clientY: 80
      })
    );
    expect(tracker.snapshot().touches).toHaveLength(0);
  });

  it('supports deterministic seeded random numbers', () => {
    const randomA = createRandom(1337);
    const randomB = createRandom(1337);

    expect(randomA.next()).toBeCloseTo(randomB.next());
    expect(randomA.nextRange(-5, 5)).toBeCloseTo(randomB.nextRange(-5, 5));
    expect(randomA.nextSign()).toBe(randomB.nextSign());
  });

  it('tracks and switches scenes', () => {
    const scenes = createSceneMachine<'menu' | 'playing'>('menu');

    expect(scenes.isScene('menu')).toBe(true);
    scenes.setScene('playing');
    expect(scenes.getCurrentScene()).toBe('playing');
  });

  it('advances axis motion and bounces at the bounds', () => {
    const bouncedAxis = advanceAxisInBounds(0.9, 0.8, 0.12, 0.2, -1, 1);

    expect(bouncedAxis.position).toBeCloseTo(0.88);
    expect(bouncedAxis.velocity).toBeCloseTo(-0.8);
  });

  it('caches loaded text assets', async () => {
    const textLoader = vi.fn(async (url: string) => {
      if (url === '/data.json') {
        return '{"value":1}';
      }
      return `content:${url}`;
    });
    const assetStore = createAssetStore({ textLoader });

    await Promise.all([assetStore.loadText('/a.txt'), assetStore.loadText('/a.txt')]);
    expect(textLoader).toHaveBeenCalledTimes(1);

    const loadedJson = await assetStore.loadJson<{ value: number }>('/data.json');
    expect(loadedJson).toEqual({ value: 1 });
  });
});

describe('starter loop helpers', () => {
  it('clamps delta and runs fixed-step updates before render', () => {
    const ticker = createFixedStepTicker(0.01, 8);
    const steps: number[] = [];
    const fixedSteps = consumeFixedSteps(ticker, clampDeltaSeconds(0.2, 0.05), (_stepSeconds, _elapsedSeconds, stepIndex) => {
      steps.push(stepIndex);
    });

    expect(fixedSteps).toBe(5);
    expect(steps).toEqual([0, 1, 2, 3, 4]);
  });

  it('runs tick callbacks in frame order and schedules the next frame', () => {
    const callOrder: string[] = [];
    let scheduledTick: FrameRequestCallback | null = null;

    const tickContext: LoopTickContext = {
      previousTimestamp: null,
      fixedStepTicker: createFixedStepTicker(0.01, 8),
      animationFrameId: null,
      isStopped: false,
      canvas: {
        width: 0,
        height: 0,
        clientWidth: 400,
        clientHeight: 200
      },
      config: {
        fixedStepSeconds: 0.01,
        maxFrameDeltaSeconds: 0.05,
        maxFixedStepsPerFrame: 8
      },
      callbacks: {
        beginFrame: () => {
          callOrder.push('beginFrame');
        },
        update: () => {
          callOrder.push('update');
        },
        render: () => {
          callOrder.push('render');
        }
      },
      requestFrame: (callback) => {
        scheduledTick = callback;
        return 1;
      },
      cancelFrame: () => {}
    };

    tickAnimationLoop(1000, tickContext);

    expect(callOrder[0]).toBe('beginFrame');
    expect(callOrder.at(-1)).toBe('render');
    expect(callOrder.includes('update')).toBe(false);
    expect(scheduledTick).not.toBeNull();
    expect(tickContext.animationFrameId).toBe(1);
  });
});
