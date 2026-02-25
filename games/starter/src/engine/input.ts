import { TouchInputFrame, TouchPoint } from './types';

type ActiveTouch = {
  id: number;
  startX: number;
  startY: number;
  clientX: number;
  clientY: number;
};

export type InputBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type BrowserInputEventType =
  | 'pointerdown'
  | 'pointermove'
  | 'pointerup'
  | 'pointercancel'
  | 'mousedown'
  | 'mousemove'
  | 'mouseup'
  | 'mouseleave';

export type InputSurface = {
  style: {
    touchAction: string;
  };
  addEventListener: (type: BrowserInputEventType, listener: EventListener) => void;
  removeEventListener: (type: BrowserInputEventType, listener: EventListener) => void;
  getBoundingClientRect: () => InputBounds;
};

export type SyntheticInputAction = 'down' | 'move' | 'up' | 'cancel';
export type SyntheticInputSource = 'touch' | 'mouse' | 'both';

export type SyntheticInputEvent = {
  action: SyntheticInputAction;
  pointerId: number;
  clientX: number;
  clientY: number;
  source: SyntheticInputSource;
};

export interface StarterInputManager {
  attach(target: InputSurface): void;
  detach(): void;
  consumeFrame(canvas: InputSurface): TouchInputFrame;
}

const TAP_DISTANCE_THRESHOLD_PX = 16;
const MOUSE_TOUCH_ID = -1;

class InputFrameState {
  private readonly activeTouches = new Map<number, ActiveTouch>();
  private tapCount = 0;

  startInput(id: number, clientX: number, clientY: number): void {
    this.activeTouches.set(id, {
      id,
      startX: clientX,
      startY: clientY,
      clientX,
      clientY
    });
  }

  moveInput(id: number, clientX: number, clientY: number): boolean {
    const active = this.activeTouches.get(id);
    if (!active) {
      return false;
    }

    active.clientX = clientX;
    active.clientY = clientY;
    return true;
  }

  endInput(id: number, clientX: number, clientY: number, shouldCountTap: boolean): boolean {
    const active = this.activeTouches.get(id);
    this.activeTouches.delete(id);

    if (!active) {
      return false;
    }

    if (shouldCountTap) {
      const deltaX = clientX - active.startX;
      const deltaY = clientY - active.startY;
      const travelDistance = Math.hypot(deltaX, deltaY);
      if (travelDistance <= TAP_DISTANCE_THRESHOLD_PX) {
        this.tapCount += 1;
      }
    }

    return true;
  }

  consumeFrame(canvas: InputSurface): TouchInputFrame {
    const touches = this.collectTouches(canvas);
    const frame: TouchInputFrame = {
      touches,
      tapCount: this.tapCount
    };
    this.tapCount = 0;
    return frame;
  }

  reset(): void {
    this.activeTouches.clear();
    this.tapCount = 0;
  }

  private collectTouches(canvas: InputSurface): TouchPoint[] {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);

    const touches = Array.from(this.activeTouches.values(), (touch): TouchPoint => {
      return {
        id: touch.id,
        clientX: touch.clientX,
        clientY: touch.clientY,
        normalizedX: clampNormalized(((touch.clientX - rect.left) / width) * 2 - 1),
        normalizedY: clampNormalized(((touch.clientY - rect.top) / height) * 2 - 1)
      };
    });

    touches.sort((left, right) => left.id - right.id);
    return touches;
  }
}

export class BrowserInputManager implements StarterInputManager {
  private target: InputSurface | null = null;
  private readonly state = new InputFrameState();

  private readonly handlePointerDown: EventListener = (event) => {
    const payload = readTouchPointerPayload(event);
    if (!payload) {
      return;
    }

    this.state.startInput(payload.id, payload.clientX, payload.clientY);
    event.preventDefault();
  };

  private readonly handlePointerMove: EventListener = (event) => {
    const payload = readTouchPointerPayload(event);
    if (!payload) {
      return;
    }

    if (!this.state.moveInput(payload.id, payload.clientX, payload.clientY)) {
      return;
    }
    event.preventDefault();
  };

  private readonly handlePointerUpOrCancel: EventListener = (event) => {
    const payload = readTouchPointerPayload(event);
    if (!payload) {
      return;
    }

    const shouldCountTap = event.type === 'pointerup';
    this.state.endInput(payload.id, payload.clientX, payload.clientY, shouldCountTap);
    event.preventDefault();
  };

  private readonly handleMouseDown: EventListener = (event) => {
    const payload = readPrimaryMousePayload(event);
    if (!payload) {
      return;
    }

    this.state.startInput(MOUSE_TOUCH_ID, payload.clientX, payload.clientY);
    event.preventDefault();
  };

  private readonly handleMouseMove: EventListener = (event) => {
    const payload = readMousePositionPayload(event);
    if (!payload) {
      return;
    }

    if (!this.state.moveInput(MOUSE_TOUCH_ID, payload.clientX, payload.clientY)) {
      return;
    }
    event.preventDefault();
  };

  private readonly handleMouseUp: EventListener = (event) => {
    const payload = readMousePositionPayload(event);
    if (!payload) {
      return;
    }

    if (!this.state.endInput(MOUSE_TOUCH_ID, payload.clientX, payload.clientY, true)) {
      return;
    }
    event.preventDefault();
  };

  private readonly handleMouseLeave: EventListener = (event) => {
    const payload = readMousePositionPayload(event);
    if (!payload) {
      return;
    }

    if (!this.state.endInput(MOUSE_TOUCH_ID, payload.clientX, payload.clientY, false)) {
      return;
    }
    event.preventDefault();
  };

  attach(target: InputSurface): void {
    if (this.target === target) {
      return;
    }

    this.detach();
    this.target = target;
    this.target.style.touchAction = 'none';
    this.target.addEventListener('pointerdown', this.handlePointerDown);
    this.target.addEventListener('pointermove', this.handlePointerMove);
    this.target.addEventListener('pointerup', this.handlePointerUpOrCancel);
    this.target.addEventListener('pointercancel', this.handlePointerUpOrCancel);
    this.target.addEventListener('mousedown', this.handleMouseDown);
    this.target.addEventListener('mousemove', this.handleMouseMove);
    this.target.addEventListener('mouseup', this.handleMouseUp);
    this.target.addEventListener('mouseleave', this.handleMouseLeave);
  }

  detach(): void {
    if (!this.target) {
      return;
    }

    this.target.removeEventListener('pointerdown', this.handlePointerDown);
    this.target.removeEventListener('pointermove', this.handlePointerMove);
    this.target.removeEventListener('pointerup', this.handlePointerUpOrCancel);
    this.target.removeEventListener('pointercancel', this.handlePointerUpOrCancel);
    this.target.removeEventListener('mousedown', this.handleMouseDown);
    this.target.removeEventListener('mousemove', this.handleMouseMove);
    this.target.removeEventListener('mouseup', this.handleMouseUp);
    this.target.removeEventListener('mouseleave', this.handleMouseLeave);
    this.target = null;
    this.state.reset();
  }

  consumeFrame(canvas: InputSurface): TouchInputFrame {
    return this.state.consumeFrame(canvas);
  }
}

export class HeadlessInputManager implements StarterInputManager {
  private target: InputSurface | null = null;
  private readonly state = new InputFrameState();

  attach(target: InputSurface): void {
    this.target = target;
    this.target.style.touchAction = 'none';
  }

  detach(): void {
    this.target = null;
    this.state.reset();
  }

  consumeFrame(canvas: InputSurface): TouchInputFrame {
    return this.state.consumeFrame(canvas);
  }

  applySyntheticEvent(event: SyntheticInputEvent): void {
    if (event.source === 'both') {
      // Deduped intentionally as one logical pointer mutation.
    }

    if (event.action === 'down') {
      this.state.startInput(event.pointerId, event.clientX, event.clientY);
      return;
    }

    if (event.action === 'move') {
      this.state.moveInput(event.pointerId, event.clientX, event.clientY);
      return;
    }

    const shouldCountTap = event.action === 'up';
    this.state.endInput(event.pointerId, event.clientX, event.clientY, shouldCountTap);
  }
}

export { BrowserInputManager as InputManager };

function clampNormalized(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function readTouchPointerPayload(
  event: Event
): { id: number; clientX: number; clientY: number } | null {
  const pointerType = readStringProperty(event, 'pointerType');
  if (pointerType !== 'touch') {
    return null;
  }

  const id = readNumberProperty(event, 'pointerId');
  const clientX = readNumberProperty(event, 'clientX');
  const clientY = readNumberProperty(event, 'clientY');
  if (id === null || clientX === null || clientY === null) {
    return null;
  }

  return {
    id,
    clientX,
    clientY
  };
}

function readPrimaryMousePayload(
  event: Event
): { clientX: number; clientY: number } | null {
  const button = readNumberProperty(event, 'button');
  if (button !== 0) {
    return null;
  }
  return readMousePositionPayload(event);
}

function readMousePositionPayload(
  event: Event
): { clientX: number; clientY: number } | null {
  const clientX = readNumberProperty(event, 'clientX');
  const clientY = readNumberProperty(event, 'clientY');
  if (clientX === null || clientY === null) {
    return null;
  }

  return {
    clientX,
    clientY
  };
}

function readNumberProperty(event: Event, key: string): number | null {
  const value = Reflect.get(event, key);
  if (typeof value !== 'number') {
    return null;
  }

  return value;
}

function readStringProperty(event: Event, key: string): string | null {
  const value = Reflect.get(event, key);
  if (typeof value !== 'string') {
    return null;
  }

  return value;
}
