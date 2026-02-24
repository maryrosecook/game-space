import { describe, expect, it } from 'vitest';

import { InputManager } from '../games/starter/src/engine/input';

const POINTER_EVENT_TYPES = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const;
const MOUSE_EVENT_TYPES = ['mousedown', 'mousemove', 'mouseup', 'mouseleave'] as const;

type PointerEventType = (typeof POINTER_EVENT_TYPES)[number];
type MouseEventType = (typeof MOUSE_EVENT_TYPES)[number];
type InputEventType = PointerEventType | MouseEventType;

class MockCanvas {
  readonly style = {
    touchAction: ''
  };

  private readonly listeners = new Map<InputEventType, Set<EventListener>>();

  constructor(
    private readonly bounds: { left: number; top: number; width: number; height: number } = {
      left: 10,
      top: 20,
      width: 100,
      height: 200
    }
  ) {
    for (const eventType of [...POINTER_EVENT_TYPES, ...MOUSE_EVENT_TYPES]) {
      this.listeners.set(eventType, new Set());
    }
  }

  addEventListener(type: InputEventType, listener: EventListener): void {
    this.listeners.get(type)?.add(listener);
  }

  removeEventListener(type: InputEventType, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return this.bounds;
  }

  listenerCount(type: InputEventType): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  dispatchPointer(
    type: PointerEventType,
    options: { pointerId: number; pointerType: string; clientX: number; clientY: number }
  ): Event {
    const event = new Event(type, { cancelable: true });
    defineEventProperty(event, 'pointerId', options.pointerId);
    defineEventProperty(event, 'pointerType', options.pointerType);
    defineEventProperty(event, 'clientX', options.clientX);
    defineEventProperty(event, 'clientY', options.clientY);
    this.dispatch(type, event);
    return event;
  }

  dispatchMouse(
    type: MouseEventType,
    options: { button: number; clientX: number; clientY: number }
  ): Event {
    const event = new Event(type, { cancelable: true });
    defineEventProperty(event, 'button', options.button);
    defineEventProperty(event, 'clientX', options.clientX);
    defineEventProperty(event, 'clientY', options.clientY);
    this.dispatch(type, event);
    return event;
  }

  private dispatch(type: InputEventType, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

function defineEventProperty(event: Event, key: string, value: number | string): void {
  Object.defineProperty(event, key, {
    configurable: true,
    enumerable: true,
    value
  });
}

describe('starter InputManager', () => {
  it('binds and unbinds pointer + mouse listeners during attach and detach', () => {
    const inputManager = new InputManager();
    const canvas = new MockCanvas();

    inputManager.attach(canvas);

    expect(canvas.style.touchAction).toBe('none');
    for (const eventType of [...POINTER_EVENT_TYPES, ...MOUSE_EVENT_TYPES]) {
      expect(canvas.listenerCount(eventType)).toBe(1);
    }

    inputManager.detach();

    for (const eventType of [...POINTER_EVENT_TYPES, ...MOUSE_EVENT_TYPES]) {
      expect(canvas.listenerCount(eventType)).toBe(0);
    }
  });

  it('tracks touch pointer movement and normalizes touch coordinates', () => {
    const inputManager = new InputManager();
    const canvas = new MockCanvas();
    inputManager.attach(canvas);

    const downEvent = canvas.dispatchPointer('pointerdown', {
      pointerId: 7,
      pointerType: 'touch',
      clientX: 60,
      clientY: 120
    });
    const moveEvent = canvas.dispatchPointer('pointermove', {
      pointerId: 7,
      pointerType: 'touch',
      clientX: 110,
      clientY: 220
    });

    expect(downEvent.defaultPrevented).toBe(true);
    expect(moveEvent.defaultPrevented).toBe(true);

    expect(inputManager.consumeFrame(canvas)).toEqual({
      touches: [
        {
          id: 7,
          clientX: 110,
          clientY: 220,
          normalizedX: 1,
          normalizedY: 1
        }
      ],
      tapCount: 0
    });
  });

  it('supports desktop mouse down/move/leave through the same touch frame', () => {
    const inputManager = new InputManager();
    const canvas = new MockCanvas();
    inputManager.attach(canvas);

    const downEvent = canvas.dispatchMouse('mousedown', {
      button: 0,
      clientX: 60,
      clientY: 120
    });
    const moveEvent = canvas.dispatchMouse('mousemove', {
      button: 0,
      clientX: 80,
      clientY: 220
    });

    expect(downEvent.defaultPrevented).toBe(true);
    expect(moveEvent.defaultPrevented).toBe(true);

    const moveFrame = inputManager.consumeFrame(canvas);
    expect(moveFrame.touches).toHaveLength(1);
    expect(moveFrame.touches[0]).toMatchObject({
      id: -1,
      clientX: 80,
      clientY: 220,
      normalizedY: 1
    });
    expect(moveFrame.touches[0]?.normalizedX).toBeCloseTo(0.4);
    expect(moveFrame.tapCount).toBe(0);

    const leaveEvent = canvas.dispatchMouse('mouseleave', {
      button: 0,
      clientX: 80,
      clientY: 220
    });
    expect(leaveEvent.defaultPrevented).toBe(true);
    expect(inputManager.consumeFrame(canvas)).toEqual({
      touches: [],
      tapCount: 0
    });
  });

  it('counts taps from both touch pointerup and mouseup within movement threshold', () => {
    const inputManager = new InputManager();
    const canvas = new MockCanvas();
    inputManager.attach(canvas);

    canvas.dispatchPointer('pointerdown', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 40,
      clientY: 50
    });
    canvas.dispatchPointer('pointerup', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: 48,
      clientY: 56
    });

    canvas.dispatchMouse('mousedown', {
      button: 0,
      clientX: 70,
      clientY: 90
    });
    canvas.dispatchMouse('mouseup', {
      button: 0,
      clientX: 77,
      clientY: 96
    });

    expect(inputManager.consumeFrame(canvas)).toEqual({
      touches: [],
      tapCount: 2
    });
    expect(inputManager.consumeFrame(canvas).tapCount).toBe(0);
  });

  it('ignores non-touch pointer events and non-primary mouse buttons', () => {
    const inputManager = new InputManager();
    const canvas = new MockCanvas();
    inputManager.attach(canvas);

    const pointerEvent = canvas.dispatchPointer('pointerdown', {
      pointerId: 9,
      pointerType: 'mouse',
      clientX: 50,
      clientY: 60
    });
    const mouseEvent = canvas.dispatchMouse('mousedown', {
      button: 1,
      clientX: 50,
      clientY: 60
    });

    expect(pointerEvent.defaultPrevented).toBe(false);
    expect(mouseEvent.defaultPrevented).toBe(false);
    expect(inputManager.consumeFrame(canvas)).toEqual({
      touches: [],
      tapCount: 0
    });
  });
});
