import { TouchInputFrame, TouchPoint } from './types';

type ActiveTouch = {
  id: number;
  startX: number;
  startY: number;
  clientX: number;
  clientY: number;
};

const TAP_DISTANCE_THRESHOLD_PX = 16;

export class InputManager {
  private target: HTMLCanvasElement | null = null;
  private activeTouches = new Map<number, ActiveTouch>();
  private tapCount = 0;

  private readonly handlePointerDown = (event: PointerEvent) => {
    if (event.pointerType !== 'touch') {
      return;
    }

    this.activeTouches.set(event.pointerId, {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      clientX: event.clientX,
      clientY: event.clientY
    });
    event.preventDefault();
  };

  private readonly handlePointerMove = (event: PointerEvent) => {
    if (event.pointerType !== 'touch') {
      return;
    }

    const active = this.activeTouches.get(event.pointerId);
    if (!active) {
      return;
    }

    active.clientX = event.clientX;
    active.clientY = event.clientY;
    event.preventDefault();
  };

  private readonly handlePointerUpOrCancel = (event: PointerEvent) => {
    if (event.pointerType !== 'touch') {
      return;
    }

    const active = this.activeTouches.get(event.pointerId);
    if (active && event.type === 'pointerup') {
      const deltaX = event.clientX - active.startX;
      const deltaY = event.clientY - active.startY;
      const travelDistance = Math.hypot(deltaX, deltaY);
      if (travelDistance <= TAP_DISTANCE_THRESHOLD_PX) {
        this.tapCount += 1;
      }
    }

    this.activeTouches.delete(event.pointerId);
    event.preventDefault();
  };

  attach(target: HTMLCanvasElement): void {
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
  }

  detach(): void {
    if (!this.target) {
      return;
    }

    this.target.removeEventListener('pointerdown', this.handlePointerDown);
    this.target.removeEventListener('pointermove', this.handlePointerMove);
    this.target.removeEventListener('pointerup', this.handlePointerUpOrCancel);
    this.target.removeEventListener('pointercancel', this.handlePointerUpOrCancel);
    this.target = null;
    this.activeTouches.clear();
    this.tapCount = 0;
  }

  consumeFrame(canvas: HTMLCanvasElement): TouchInputFrame {
    const touches = this.collectTouches(canvas);
    const frame: TouchInputFrame = {
      touches,
      tapCount: this.tapCount
    };
    this.tapCount = 0;
    return frame;
  }

  private collectTouches(canvas: HTMLCanvasElement): TouchPoint[] {
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

function clampNormalized(value: number): number {
  return Math.max(-1, Math.min(1, value));
}
