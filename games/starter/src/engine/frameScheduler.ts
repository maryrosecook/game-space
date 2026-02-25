export type FrameScheduler = {
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (handle: number) => void;
};

type RafWindow = Pick<Window, 'requestAnimationFrame' | 'cancelAnimationFrame'>;

export class BrowserRafScheduler implements FrameScheduler {
  constructor(private readonly windowRef: RafWindow | null = readBrowserWindow()) {}

  requestFrame(callback: FrameRequestCallback): number {
    if (!this.windowRef) {
      throw new Error('BrowserRafScheduler requires window.requestAnimationFrame');
    }
    return this.windowRef.requestAnimationFrame(callback);
  }

  cancelFrame(handle: number): void {
    if (!this.windowRef) {
      throw new Error('BrowserRafScheduler requires window.cancelAnimationFrame');
    }
    this.windowRef.cancelAnimationFrame(handle);
  }
}

export class HeadlessFrameScheduler implements FrameScheduler {
  private readonly callbacks = new Map<number, FrameRequestCallback>();
  private nextHandle = 1;
  private nowMs = 0;

  constructor(private readonly frameDurationMs = 1000 / 60) {}

  requestFrame(callback: FrameRequestCallback): number {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.callbacks.set(handle, callback);
    return handle;
  }

  cancelFrame(handle: number): void {
    this.callbacks.delete(handle);
  }

  step(frameCount: number): void {
    const safeFrameCount = Math.max(0, Math.floor(frameCount));
    for (let frameIndex = 0; frameIndex < safeFrameCount; frameIndex += 1) {
      if (this.callbacks.size === 0) {
        return;
      }

      const scheduledCallbacks = [...this.callbacks.values()];
      this.callbacks.clear();
      this.nowMs += this.frameDurationMs;

      for (const callback of scheduledCallbacks) {
        callback(this.nowMs);
      }
    }
  }
}

function readBrowserWindow(): RafWindow | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window;
}
