import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

type TestEvent = {
  key?: string;
  data?: unknown;
  button?: number;
  pointerId?: number;
  pointerType?: string;
  clientX?: number;
  clientY?: number;
  preventDefault: () => void;
};

type EventListener = (event: TestEvent) => void;

type FetchResponse = {
  ok: boolean;
  status?: number;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
};

type FetchCall = {
  url: string;
  init: Record<string, unknown> | undefined;
};

type FetchImplementation = (url: string, init?: Record<string, unknown>) => Promise<FetchResponse>;

type TranscriptRenderCall = {
  sessionId: unknown;
  messages: unknown;
  options: { autoScrollToBottom?: boolean } | undefined;
};

type CanvasOperation =
  | { type: 'beginPath' }
  | { type: 'moveTo'; x: number; y: number }
  | { type: 'lineTo'; x: number; y: number }
  | { type: 'stroke' }
  | { type: 'clearRect'; x: number; y: number; width: number; height: number }
  | { type: 'drawImage'; width: number; height: number };

class TestEventTarget {
  private readonly listeners = new Map<string, EventListener[]>();

  addEventListener(type: string, listener: EventListener): void {
    const existing = this.listeners.get(type);
    if (existing) {
      existing.push(listener);
      return;
    }

    this.listeners.set(type, [listener]);
  }

  dispatchEvent(type: string, event: TestEvent): void {
    const listeners = this.listeners.get(type);
    if (!listeners) {
      return;
    }

    for (const listener of listeners) {
      listener(event);
    }
  }
}

class TestClassList {
  private readonly values = new Set<string>();

  add(...tokens: string[]): void {
    for (const token of tokens) {
      this.values.add(token);
    }
  }

  remove(...tokens: string[]): void {
    for (const token of tokens) {
      this.values.delete(token);
    }
  }

  contains(token: string): boolean {
    return this.values.has(token);
  }

  toggle(token: string, force?: boolean): boolean {
    const shouldEnable = force === undefined ? !this.values.has(token) : force;
    if (shouldEnable) {
      this.values.add(token);
      return true;
    }

    this.values.delete(token);
    return false;
  }
}

class TestHTMLElement extends TestEventTarget {
  public readonly classList = new TestClassList();
  private readonly attributes = new Map<string, string>();
  public focused = false;
  public textContent: string | null = null;
  public scrollTop = 0;
  public scrollHeight = 0;
  public scrollLeft = 0;
  public scrollWidth = 0;

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  focus(): void {
    this.focused = true;
  }
}

class TestHTMLButtonElement extends TestHTMLElement {
  public disabled = false;
}

class TestHTMLFormElement extends TestHTMLElement {
  requestSubmit(): void {
    this.dispatchEvent('submit', createEvent());
  }
}

class TestHTMLInputElement extends TestHTMLElement {
  public value = '';
}

class TestMediaStreamTrack {
  public stopped = false;

  stop(): void {
    this.stopped = true;
  }
}

class TestMediaStream {
  private readonly tracks: TestMediaStreamTrack[];

  constructor(tracks: TestMediaStreamTrack[]) {
    this.tracks = tracks;
  }

  getTracks(): TestMediaStreamTrack[] {
    return this.tracks;
  }
}

type SessionDescription = {
  type: string;
  sdp: string;
};

class TestRTCDataChannel extends TestEventTarget {
  public readyState = 'open';
  public closed = false;
  public readonly sentMessages: string[] = [];

  send(message: string): void {
    this.sentMessages.push(message);
  }

  close(): void {
    this.readyState = 'closed';
    this.closed = true;
  }
}

class TestRTCPeerConnection {
  public static latestInstance: TestRTCPeerConnection | null = null;
  public readonly dataChannel = new TestRTCDataChannel();
  public localDescription: SessionDescription | null = null;
  public remoteDescription: SessionDescription | null = null;
  public closed = false;

  constructor() {
    TestRTCPeerConnection.latestInstance = this;
  }

  createDataChannel(label: string): TestRTCDataChannel {
    void label;
    return this.dataChannel;
  }

  addTrack(track: TestMediaStreamTrack, stream: TestMediaStream): void {
    void track;
    void stream;
    // Track registration is not asserted directly in these tests.
  }

  async createOffer(): Promise<SessionDescription> {
    return { type: 'offer', sdp: 'fake-offer-sdp' };
  }

  async setLocalDescription(description: SessionDescription): Promise<void> {
    this.localDescription = description;
  }

  async setRemoteDescription(description: SessionDescription): Promise<void> {
    this.remoteDescription = description;
  }

  close(): void {
    this.closed = true;
  }
}


class TestCanvasRenderingContext2D {
  public readonly operations: CanvasOperation[] = [];
  public lineCapValue = '';
  public lineJoinValue = '';
  public strokeStyleValue = '';
  public lineWidthValue = 0;

  setTransform(...args: number[]): void {
    void args;
  }

  beginPath(): void {
    this.operations.push({ type: 'beginPath' });
  }

  moveTo(x: number, y: number): void {
    this.operations.push({ type: 'moveTo', x, y });
  }

  lineTo(x: number, y: number): void {
    this.operations.push({ type: 'lineTo', x, y });
  }

  stroke(): void {
    this.operations.push({ type: 'stroke' });
  }

  clearRect(x: number, y: number, width: number, height: number): void {
    this.operations.push({ type: 'clearRect', x, y, width, height });
  }

  drawImage(image: { width?: number; height?: number }, x: number, y: number, width: number, height: number): void {
    void image;
    void x;
    void y;
    this.operations.push({ type: 'drawImage', width, height });
  }

  set lineCap(value: string) {
    this.lineCapValue = value;
  }

  set lineJoin(value: string) {
    this.lineJoinValue = value;
  }

  set strokeStyle(value: string) {
    this.strokeStyleValue = value;
  }

  set lineWidth(value: number) {
    this.lineWidthValue = value;
  }
}

class TestHTMLCanvasElement extends TestHTMLElement {
  public width = 0;
  public height = 0;
  public clientWidth = 360;
  public clientHeight = 640;
  private readonly context = new TestCanvasRenderingContext2D();
  private readonly capturedPointerIds = new Set<number>();

  getContext(kind: string): TestCanvasRenderingContext2D | null {
    if (kind !== '2d') {
      return null;
    }

    return this.context;
  }

  toDataURL(type?: string): string {
    void type;
    return 'data:image/png;base64,test-canvas';
  }

  getBoundingClientRect(): { left: number; top: number } {
    return { left: 0, top: 0 };
  }

  setPointerCapture(pointerId: number): void {
    this.capturedPointerIds.add(pointerId);
  }

  hasPointerCapture(pointerId: number): boolean {
    return this.capturedPointerIds.has(pointerId);
  }

  releasePointerCapture(pointerId: number): void {
    this.capturedPointerIds.delete(pointerId);
  }
}

class TestBodyElement extends TestHTMLElement {
  public readonly dataset: { versionId?: string; csrfToken?: string; gameFavorited?: string; codegenProvider?: string };

  constructor(versionId: string, csrfToken: string | undefined, gameFavorited: boolean, codegenProvider?: string) {
    super();
    this.dataset = { versionId, csrfToken, gameFavorited: gameFavorited ? 'true' : 'false', codegenProvider };
  }
}

class TestDocument extends TestEventTarget {
  public readonly body: TestBodyElement;
  private readonly elements = new Map<string, unknown>();

  constructor(versionId: string, csrfToken: string | undefined, gameFavorited: boolean, codegenProvider?: string) {
    super();
    this.body = new TestBodyElement(versionId, csrfToken, gameFavorited, codegenProvider);
  }

  registerElement(id: string, element: unknown): void {
    this.elements.set(id, element);
  }

  getElementById(id: string): unknown {
    return this.elements.get(id) ?? null;
  }

  createElement(tagName: string): unknown {
    if (tagName === 'canvas') {
      return new TestHTMLCanvasElement();
    }

    return null;
  }
}

type GameViewHarness = {
  fetchCalls: FetchCall[];
  consoleLogs: unknown[][];
  assignCalls: string[];
  body: TestBodyElement;
  transcriptTitle: string | null;
  editTab: TestHTMLButtonElement;
  favoriteButton: TestHTMLButtonElement;
  deleteButton: TestHTMLButtonElement;
  recordButton: TestHTMLButtonElement;
  tileCaptureButton: TestHTMLButtonElement;
  codexToggle: TestHTMLButtonElement;
  promptForm: TestHTMLFormElement;
  promptInput: TestHTMLInputElement;
  promptPanel: TestHTMLElement;
  promptOverlay: TestHTMLElement;
  promptDrawingCanvas: TestHTMLCanvasElement;
  gameCanvas: TestHTMLCanvasElement;
  renderTranscriptCalls: TranscriptRenderCall[];
  getScrollToBottomCalls: () => number;
  intervalCallbacks: Array<() => void>;
  getPeerConnection: () => TestRTCPeerConnection | null;
  mediaTrack: TestMediaStreamTrack;
  getUserMediaCalls: () => number;
};

type RunGameViewOptions = {
  csrfToken?: string | undefined;
  startTranscriptPolling?: boolean;
  gameFavorited?: boolean;
  codegenProvider?: string;
};

function createEvent(overrides: Partial<TestEvent> = {}): TestEvent {
  return {
    key: overrides.key,
    data: overrides.data,
    button: overrides.button,
    pointerId: overrides.pointerId,
    pointerType: overrides.pointerType,
    clientX: overrides.clientX,
    clientY: overrides.clientY,
    preventDefault: overrides.preventDefault ?? (() => {})
  };
}

async function flushAsyncOperations(): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await Promise.resolve();
  }

  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function runGameViewScript(
  fetchImplementation: FetchImplementation,
  options: RunGameViewOptions = {}
): Promise<GameViewHarness> {
  const csrfToken = Object.hasOwn(options, 'csrfToken') ? options.csrfToken : 'csrf-token-123';
  const startTranscriptPolling = options.startTranscriptPolling ?? false;
  const gameFavorited = options.gameFavorited ?? false;
  const codegenProvider = options.codegenProvider;
  const promptPanel = new TestHTMLElement();
  const promptForm = new TestHTMLFormElement();
  const promptInput = new TestHTMLInputElement();
  const editTab = new TestHTMLButtonElement();
  const favoriteButton = new TestHTMLButtonElement();
  const deleteButton = new TestHTMLButtonElement();
  const recordButton = new TestHTMLButtonElement();
  const tileCaptureButton = new TestHTMLButtonElement();
  const codexToggle = new TestHTMLButtonElement();
  const codexTranscript = new TestHTMLElement();
  const promptOverlay = new TestHTMLElement();
  const gameSessionView = new TestHTMLElement();
  const promptDrawingCanvas = new TestHTMLCanvasElement();
  const gameCanvas = new TestHTMLCanvasElement();

  const document = new TestDocument('source-version', csrfToken, gameFavorited, codegenProvider);
  document.registerElement('prompt-panel', promptPanel);
  document.registerElement('prompt-form', promptForm);
  document.registerElement('prompt-input', promptInput);
  document.registerElement('game-tab-edit', editTab);
  document.registerElement('game-tab-favorite', favoriteButton);
  document.registerElement('game-tab-delete', deleteButton);
  document.registerElement('prompt-record-button', recordButton);
  document.registerElement('game-tab-capture-tile', tileCaptureButton);
  document.registerElement('game-codex-toggle', codexToggle);
  document.registerElement('game-codex-transcript', codexTranscript);
  document.registerElement('prompt-overlay', promptOverlay);
  document.registerElement('prompt-drawing-canvas', promptDrawingCanvas);
  document.registerElement('game-canvas', gameCanvas);
  document.registerElement('game-codex-session-view', gameSessionView);

  const fetchCalls: FetchCall[] = [];
  const consoleLogs: unknown[][] = [];
  const assignCalls: string[] = [];
  const intervalCallbacks: Array<() => void> = [];
  const mediaTrack = new TestMediaStreamTrack();
  const mediaStream = new TestMediaStream([mediaTrack]);
  let getUserMediaCalls = 0;
  let transcriptTitle: string | null = null;
  const renderTranscriptCalls: TranscriptRenderCall[] = [];
  let scrollToBottomCalls = 0;
  TestRTCPeerConnection.latestInstance = null;

  const navigator = {
    mediaDevices: {
      async getUserMedia(): Promise<TestMediaStream> {
        getUserMediaCalls += 1;
        return mediaStream;
      }
    }
  };

  const Image = class extends TestEventTarget {
    public width = 360;
    public height = 640;

    set src(value: string) {
      void value;
      this.dispatchEvent('load', createEvent());
    }
  };

  const window = {
    requestAnimationFrame(callback: () => void): number {
      callback();
      return 1;
    },
    location: {
      assign(url: string): void {
        assignCalls.push(url);
      }
    },
    setInterval(callback: () => void): number {
      intervalCallbacks.push(callback);
      callback();
      return intervalCallbacks.length;
    },
    clearInterval(id: number): void {
      void id;
    },
    setTimeout(callback: () => void): number {
      callback();
      return 1;
    },
    clearTimeout(id: number): void {
      void id;
    },
    addEventListener(event: string, listener: () => void): void {
      void event;
      void listener;
    }
  };

  const scriptPath = path.join(process.cwd(), 'src/public/game-view.js');
  const source = await readFile(scriptPath, 'utf8');
  const runnableSource = source
    .replace(
      "import { createCodexTranscriptPresenter } from './codex-transcript-presenter.js';\n\n",
      ''
    )
    .replace(/\nstartTranscriptPolling\(\);\s*$/, startTranscriptPolling ? '\nstartTranscriptPolling();\n' : '\n');

  const context = {
    Image,
    document,
    window,
    fetch(url: string, init?: Record<string, unknown>): Promise<FetchResponse> {
      fetchCalls.push({ url, init });
      return fetchImplementation(url, init);
    },
    console: {
      log(...args: unknown[]): void {
        consoleLogs.push(args);
      }
    },
    HTMLButtonElement: TestHTMLButtonElement,
    HTMLElement: TestHTMLElement,
    HTMLFormElement: TestHTMLFormElement,
    HTMLInputElement: TestHTMLInputElement,
    HTMLCanvasElement: TestHTMLCanvasElement,
    navigator,
    RTCPeerConnection: TestRTCPeerConnection,
    createCodexTranscriptPresenter(_sessionView: unknown, options?: { transcriptTitle?: string }) {
      transcriptTitle = typeof options?.transcriptTitle === 'string' ? options.transcriptTitle : null;
      return {
        showEmptyState() {},
        renderTranscript(sessionId: unknown, messages: unknown, presenterOptions?: { autoScrollToBottom?: boolean }) {
          renderTranscriptCalls.push({
            sessionId,
            messages,
            options: presenterOptions
          });
        },
        scrollToBottom() {
          scrollToBottomCalls += 1;
        }
      };
    },
    encodeURIComponent,
    Error
  };

  vm.runInNewContext(runnableSource, context, { filename: scriptPath });

  return {
    fetchCalls,
    consoleLogs,
    assignCalls,
    body: document.body,
    transcriptTitle,
    editTab,
    favoriteButton,
    deleteButton,
    recordButton,
    tileCaptureButton,
    codexToggle,
    promptForm,
    promptInput,
    promptPanel,
    promptOverlay,
    promptDrawingCanvas,
    gameCanvas,
    renderTranscriptCalls,
    getScrollToBottomCalls: () => scrollToBottomCalls,
    intervalCallbacks,
    getPeerConnection: () => TestRTCPeerConnection.latestInstance,
    mediaTrack,
    getUserMediaCalls: () => getUserMediaCalls
  };
}

describe('game view prompt submit client', () => {
  it('redirects to the newly forked game page when prompt submit succeeds', async () => {
    const harness = await runGameViewScript(async () => ({
      ok: true,
      async json() {
        return { forkId: 'pebble-iris-dawn' };
      }
    }));

    harness.editTab.dispatchEvent('click', createEvent());
    harness.promptInput.value = 'darken the ball';
    harness.promptForm.dispatchEvent('submit', createEvent());
    await flushAsyncOperations();

    expect(harness.fetchCalls).toHaveLength(1);
    expect(harness.fetchCalls[0]).toEqual({
      url: '/api/games/source-version/prompts',
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': 'csrf-token-123'
        },
        body: JSON.stringify({ prompt: 'darken the ball', annotationPngDataUrl: null, gameScreenshotPngDataUrl: 'data:image/png;base64,test-canvas' })
      }
    });
    expect(harness.assignCalls).toEqual(['/game/pebble-iris-dawn']);
    expect(harness.promptInput.value).toBe('');
    expect(harness.promptPanel.getAttribute('aria-hidden')).toBe('false');
    expect(harness.editTab.classList.contains('game-view-tab--active')).toBe(true);
  });

  it('omits the CSRF header when no token exists on the page', async () => {
    const harness = await runGameViewScript(
      async () => ({
        ok: true,
        async json() {
          return { forkId: 'pebble-iris-dawn' };
        }
      }),
      { csrfToken: undefined }
    );

    harness.editTab.dispatchEvent('click', createEvent());
    harness.promptInput.value = 'darken the ball';
    harness.promptForm.dispatchEvent('submit', createEvent());
    await flushAsyncOperations();

    expect(harness.fetchCalls).toHaveLength(1);
    expect(harness.fetchCalls[0]?.init).toEqual({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ prompt: 'darken the ball', annotationPngDataUrl: null, gameScreenshotPngDataUrl: 'data:image/png;base64,test-canvas' })
    });
  });

  it('does not redirect when prompt submit response is missing fork id', async () => {
    const harness = await runGameViewScript(async () => ({
      ok: true,
      async json() {
        return { status: 'accepted' };
      }
    }));

    harness.editTab.dispatchEvent('click', createEvent());
    harness.promptInput.value = 'add gravity';
    harness.promptForm.dispatchEvent('submit', createEvent());
    await flushAsyncOperations();

    expect(harness.fetchCalls).toHaveLength(1);
    expect(harness.assignCalls).toHaveLength(0);
  });

  it('toggles the edit panel open and closed from the bottom Edit tab', async () => {
    const harness = await runGameViewScript(async () => ({
      ok: true,
      async json() {
        return { forkId: 'unused' };
      }
    }));

    expect(harness.promptPanel.getAttribute('aria-hidden')).toBe('true');
    expect(harness.editTab.classList.contains('game-view-tab--active')).toBe(false);

    harness.editTab.dispatchEvent('click', createEvent());
    expect(harness.promptPanel.getAttribute('aria-hidden')).toBe('false');
    expect(harness.editTab.classList.contains('game-view-tab--active')).toBe(true);

    harness.codexToggle.dispatchEvent('click', createEvent());
    expect(harness.body.classList.contains('game-page--codex-expanded')).toBe(true);

    harness.editTab.dispatchEvent('click', createEvent());
    expect(harness.promptPanel.getAttribute('aria-hidden')).toBe('true');
    expect(harness.editTab.classList.contains('game-view-tab--active')).toBe(false);
    expect(harness.body.classList.contains('game-page--codex-expanded')).toBe(false);
  });

  it('reflects the initial favorite state from page dataset', async () => {
    const harness = await runGameViewScript(
      async () => ({
        ok: true,
        async json() {
          return { status: 'ok' };
        }
      }),
      { gameFavorited: true }
    );

    expect(harness.favoriteButton.classList.contains('game-view-icon-tab--active')).toBe(true);
    expect(harness.favoriteButton.getAttribute('aria-pressed')).toBe('true');
    expect(harness.favoriteButton.getAttribute('aria-label')).toBe('Unfavorite game');
  });

  it('toggles the favorite button state by calling the favorite endpoint', async () => {
    let toggleCount = 0;
    const harness = await runGameViewScript(async (url) => {
      if (url !== '/api/games/source-version/favorite') {
        throw new Error(`Unexpected fetch URL: ${url}`);
      }

      toggleCount += 1;
      return {
        ok: true,
        async json() {
          return { favorite: toggleCount === 1 };
        }
      };
    });

    harness.favoriteButton.dispatchEvent('click', createEvent());
    await flushAsyncOperations();
    expect(harness.fetchCalls[0]).toEqual({
      url: '/api/games/source-version/favorite',
      init: {
        method: 'POST',
        headers: {
          'X-CSRF-Token': 'csrf-token-123'
        }
      }
    });
    expect(harness.favoriteButton.classList.contains('game-view-icon-tab--active')).toBe(true);
    expect(harness.favoriteButton.getAttribute('aria-pressed')).toBe('true');
    expect(harness.favoriteButton.getAttribute('aria-label')).toBe('Unfavorite game');

    harness.favoriteButton.dispatchEvent('click', createEvent());
    await flushAsyncOperations();
    expect(harness.favoriteButton.classList.contains('game-view-icon-tab--active')).toBe(false);
    expect(harness.favoriteButton.getAttribute('aria-pressed')).toBe('false');
    expect(harness.favoriteButton.getAttribute('aria-label')).toBe('Favorite game');
  });

  it('retries tile capture when the first canvas snapshots are blank and posts the first non-blank frame', async () => {
    const harness = await runGameViewScript(async (url) => {
      if (url !== '/api/games/source-version/tile-snapshot') {
        throw new Error(`Unexpected fetch URL: ${url}`);
      }

      return {
        ok: true,
        async json() {
          return { status: 'ok' };
        }
      };
    });

    let snapshotReadCount = 0;
    harness.gameCanvas.toDataURL = () => {
      snapshotReadCount += 1;
      if (snapshotReadCount < 3) {
        return 'data:image/png;base64,test-canvas';
      }

      return 'data:image/png;base64,drawn-canvas';
    };

    harness.tileCaptureButton.dispatchEvent('click', createEvent());
    await flushAsyncOperations();

    expect(harness.fetchCalls).toHaveLength(1);
    expect(harness.fetchCalls[0]).toEqual({
      url: '/api/games/source-version/tile-snapshot',
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': 'csrf-token-123'
        },
        body: JSON.stringify({ tilePngDataUrl: 'data:image/png;base64,drawn-canvas' })
      }
    });
    expect(snapshotReadCount).toBe(3);
    expect(harness.tileCaptureButton.disabled).toBe(false);
  });

  it('toggles codex transcript expansion from the robot button', async () => {
    const harness = await runGameViewScript(async () => ({
      ok: true,
      async json() {
        return { forkId: 'unused' };
      }
    }));

    expect(harness.promptPanel.getAttribute('aria-hidden')).toBe('true');
    expect(harness.body.classList.contains('game-page--codex-expanded')).toBe(false);
    expect(harness.codexToggle.getAttribute('aria-expanded')).toBe('false');

    harness.codexToggle.dispatchEvent('click', createEvent());
    expect(harness.promptPanel.getAttribute('aria-hidden')).toBe('false');
    expect(harness.body.classList.contains('game-page--codex-expanded')).toBe(true);
    expect(harness.codexToggle.getAttribute('aria-expanded')).toBe('true');

    harness.codexToggle.dispatchEvent('click', createEvent());
    expect(harness.promptPanel.getAttribute('aria-hidden')).toBe('false');
    expect(harness.body.classList.contains('game-page--codex-expanded')).toBe(false);
  });

  it('scrolls transcript to bottom when opening codex transcript after messages load', async () => {
    const harness = await runGameViewScript(
      async (url) => {
        if (url !== '/api/codex-sessions/source-version') {
          throw new Error(`Unexpected fetch URL: ${url}`);
        }

        return {
          ok: true,
          async json() {
            return {
              status: 'ok',
              eyeState: 'idle',
              sessionId: 'session-source',
              messages: [{ role: 'user', text: 'first prompt', timestamp: '2026-02-22T00:00:00.000Z' }]
            };
          }
        };
      },
      { startTranscriptPolling: true }
    );

    await flushAsyncOperations();
    expect(harness.renderTranscriptCalls).toHaveLength(1);
    expect(harness.getScrollToBottomCalls()).toBe(0);

    harness.codexToggle.dispatchEvent('click', createEvent());

    expect(harness.getScrollToBottomCalls()).toBe(1);
    expect(harness.body.classList.contains('game-page--codex-expanded')).toBe(true);
  });

  it('starts realtime transcription by creating a session and exchanging SDP', async () => {
    const harness = await runGameViewScript(async (url) => {
      if (url === '/api/transcribe') {
        return {
          ok: true,
          async json() {
            return { clientSecret: 'ephemeral-secret', model: 'gpt-realtime-1.5' };
          }
        };
      }

      if (url === 'https://api.openai.com/v1/realtime/calls') {
        return {
          ok: true,
          async text() {
            return 'fake-answer-sdp';
          }
        };
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    harness.recordButton.dispatchEvent('click', createEvent());
    await flushAsyncOperations();

    expect(harness.getUserMediaCalls()).toBe(1);
    expect(harness.fetchCalls).toHaveLength(2);
    expect(harness.fetchCalls[0]).toEqual({
      url: '/api/transcribe',
      init: {
        method: 'POST',
        headers: {
          'X-CSRF-Token': 'csrf-token-123'
        }
      }
    });
    expect(harness.fetchCalls[1]).toEqual({
      url: 'https://api.openai.com/v1/realtime/calls',
      init: {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ephemeral-secret',
          'Content-Type': 'application/sdp'
        },
        body: 'fake-offer-sdp'
      }
    });
    expect(harness.recordButton.getAttribute('aria-label')).toBe('Stop voice recording');
    expect(harness.recordButton.classList.contains('game-view-icon-tab--recording')).toBe(true);

    const peerConnection = harness.getPeerConnection();
    expect(peerConnection?.localDescription).toEqual({ type: 'offer', sdp: 'fake-offer-sdp' });
    expect(peerConnection?.remoteDescription).toEqual({ type: 'answer', sdp: 'fake-answer-sdp' });
  });

  it('enables annotation drawing during recording and includes annotation PNG in prompt submit', async () => {
    const harness = await runGameViewScript(async (url) => {
      if (url === '/api/transcribe') {
        return {
          ok: true,
          async json() {
            return { clientSecret: 'ephemeral-secret', model: 'gpt-realtime-1.5' };
          }
        };
      }

      if (url === 'https://api.openai.com/v1/realtime/calls') {
        return {
          ok: true,
          async text() {
            return 'fake-answer-sdp';
          }
        };
      }

      if (url === '/api/games/source-version/prompts') {
        return {
          ok: true,
          async json() {
            return { forkId: 'voice-fork' };
          }
        };
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    harness.recordButton.dispatchEvent('click', createEvent());
    await flushAsyncOperations();

    expect(harness.promptDrawingCanvas.classList.contains('prompt-drawing-canvas--active')).toBe(true);
    expect(harness.promptDrawingCanvas.getAttribute('aria-hidden')).toBe('false');

    const drawingContext = harness.promptDrawingCanvas.getContext('2d');
    if (!drawingContext) {
      throw new Error('drawing context missing from test harness');
    }

    harness.promptDrawingCanvas.dispatchEvent(
      'pointerdown',
      createEvent({ pointerId: 12, pointerType: 'mouse', button: 0, clientX: 25, clientY: 35 })
    );
    harness.promptDrawingCanvas.dispatchEvent(
      'pointermove',
      createEvent({ pointerId: 12, pointerType: 'mouse', button: 0, clientX: 70, clientY: 96 })
    );
    harness.promptDrawingCanvas.dispatchEvent(
      'pointerup',
      createEvent({ pointerId: 12, pointerType: 'mouse', button: 0, clientX: 70, clientY: 96 })
    );

    const peerConnection = harness.getPeerConnection();
    peerConnection?.dataChannel.dispatchEvent(
      'message',
      createEvent({
        data: JSON.stringify({
          type: 'conversation.item.input_audio_transcription.completed',
          transcript: 'make the paddle bigger'
        })
      })
    );

    harness.recordButton.dispatchEvent('click', createEvent());
    await flushAsyncOperations();

    expect(drawingContext.strokeStyleValue).toBe('rgba(250, 204, 21, 0.95)');
    expect(drawingContext.operations).toContainEqual({ type: 'moveTo', x: 25, y: 35 });
    expect(drawingContext.operations).toContainEqual({ type: 'lineTo', x: 25, y: 35 });
    expect(drawingContext.operations).toContainEqual({ type: 'lineTo', x: 70, y: 96 });
    expect(drawingContext.operations).toContainEqual({ type: 'stroke' });
    expect(harness.promptDrawingCanvas.classList.contains('prompt-drawing-canvas--active')).toBe(false);
    expect(harness.promptDrawingCanvas.getAttribute('aria-hidden')).toBe('true');

    expect(harness.fetchCalls[2]).toEqual({
      url: '/api/games/source-version/prompts',
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': 'csrf-token-123'
        },
        body: JSON.stringify({
          prompt: 'make the paddle bigger',
          annotationPngDataUrl: 'data:image/png;base64,test-canvas',
          gameScreenshotPngDataUrl: 'data:image/png;base64,test-canvas'
        })
      }
    });
  });

  it('draws from touch pointer events while recording', async () => {
    const harness = await runGameViewScript(async (url) => {
      if (url === '/api/transcribe') {
        return {
          ok: true,
          async json() {
            return { clientSecret: 'ephemeral-secret', model: 'gpt-realtime-1.5' };
          }
        };
      }

      if (url === 'https://api.openai.com/v1/realtime/calls') {
        return {
          ok: true,
          async text() {
            return 'fake-answer-sdp';
          }
        };
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    harness.recordButton.dispatchEvent('click', createEvent());
    await flushAsyncOperations();

    const drawingContext = harness.promptDrawingCanvas.getContext('2d');
    if (!drawingContext) {
      throw new Error('drawing context missing from test harness');
    }

    harness.promptDrawingCanvas.dispatchEvent(
      'pointerdown',
      createEvent({ pointerId: 3, pointerType: 'touch', clientX: 11, clientY: 17 })
    );
    harness.promptDrawingCanvas.dispatchEvent(
      'pointermove',
      createEvent({ pointerId: 3, pointerType: 'touch', clientX: 38, clientY: 61 })
    );
    harness.promptDrawingCanvas.dispatchEvent(
      'pointerup',
      createEvent({ pointerId: 3, pointerType: 'touch', clientX: 38, clientY: 61 })
    );

    expect(drawingContext.operations).toContainEqual({ type: 'moveTo', x: 11, y: 17 });
    expect(drawingContext.operations).toContainEqual({ type: 'lineTo', x: 11, y: 17 });
    expect(drawingContext.operations).toContainEqual({ type: 'lineTo', x: 38, y: 61 });

    harness.recordButton.dispatchEvent('click', createEvent());
    await flushAsyncOperations();
    expect(harness.promptDrawingCanvas.classList.contains('prompt-drawing-canvas--active')).toBe(false);
  });

  it('does not retry a fallback endpoint when realtime calls returns 400', async () => {
    const harness = await runGameViewScript(async (url) => {
      if (url === '/api/transcribe') {
        return {
          ok: true,
          async json() {
            return { clientSecret: 'ephemeral-secret', model: 'gpt-realtime-1.5' };
          }
        };
      }

      if (url === 'https://api.openai.com/v1/realtime/calls') {
        return {
          ok: false,
          status: 400,
          async text() {
            return 'invalid request';
          }
        };
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    harness.recordButton.dispatchEvent('click', createEvent());
    await flushAsyncOperations();

    expect(harness.fetchCalls).toHaveLength(2);
    expect(harness.fetchCalls[1]).toEqual({
      url: 'https://api.openai.com/v1/realtime/calls',
      init: {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ephemeral-secret',
          'Content-Type': 'application/sdp'
        },
        body: 'fake-offer-sdp'
      }
    });

    const peerConnection = harness.getPeerConnection();
    expect(peerConnection?.remoteDescription).toBeNull();
    expect(peerConnection?.closed).toBe(true);
    expect(harness.mediaTrack.stopped).toBe(true);
    expect(harness.recordButton.classList.contains('game-view-icon-tab--recording')).toBe(false);
  });

  it('logs transcribe endpoint errors and does not start recording', async () => {
    const harness = await runGameViewScript(async (url) => {
      if (url === '/api/transcribe') {
        return {
          ok: false,
          status: 503,
          async json() {
            return { error: 'OpenAI realtime model gpt-realtime-1.5 is unavailable for this API key' };
          }
        };
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    harness.recordButton.dispatchEvent('click', createEvent());
    await flushAsyncOperations();

    expect(harness.fetchCalls).toHaveLength(1);
    expect(harness.getUserMediaCalls()).toBe(0);
    expect(harness.recordButton.classList.contains('game-view-icon-tab--recording')).toBe(false);
    expect(harness.consoleLogs).toContainEqual([
      '[realtime-transcription] session request failed',
      'status 503: OpenAI realtime model gpt-realtime-1.5 is unavailable for this API key'
    ]);
  });

  it('buffers realtime transcript into overlay when edit tab is closed', async () => {
    const harness = await runGameViewScript(async (url) => {
      if (url === '/api/transcribe') {
        return {
          ok: true,
          async json() {
            return { clientSecret: 'ephemeral-secret', model: 'gpt-realtime-1.5' };
          }
        };
      }

      if (url === 'https://api.openai.com/v1/realtime/calls') {
        return {
          ok: true,
          async text() {
            return 'fake-answer-sdp';
          }
        };
      }

      if (url === '/api/games/source-version/prompts') {
        return {
          ok: true,
          async json() {
            return { forkId: 'voice-fork' };
          }
        };
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    harness.recordButton.dispatchEvent('click', createEvent());
    await flushAsyncOperations();

    const peerConnection = harness.getPeerConnection();
    expect(peerConnection).not.toBeNull();
    harness.promptOverlay.scrollWidth = 480;
    peerConnection?.dataChannel.dispatchEvent(
      'message',
      createEvent({
        data: JSON.stringify({
          type: 'conversation.item.input_audio_transcription.completed',
          transcript: 'make the paddle bigger'
        })
      })
    );
    expect(harness.promptOverlay.textContent).toBe('make');
    harness.intervalCallbacks[0]?.();
    harness.intervalCallbacks[0]?.();
    harness.intervalCallbacks[0]?.();
    expect(harness.promptOverlay.textContent).toBe('make the paddle bigger');
    expect(harness.promptOverlay.classList.contains('prompt-overlay--visible')).toBe(true);
    expect(harness.promptOverlay.getAttribute('aria-hidden')).toBe('false');
    expect(harness.promptOverlay.scrollLeft).toBe(480);

    harness.recordButton.dispatchEvent('click', createEvent());
    await flushAsyncOperations();

    expect(harness.promptInput.value).toBe('');
    expect(harness.promptOverlay.textContent).toBe('');
    expect(peerConnection?.dataChannel.sentMessages).toContain(JSON.stringify({ type: 'input_audio_buffer.commit' }));
    expect(harness.mediaTrack.stopped).toBe(true);
    expect(peerConnection?.closed).toBe(true);
    expect(harness.recordButton.getAttribute('aria-label')).toBe('Start voice recording');
    expect(harness.fetchCalls[2]).toEqual({
      url: '/api/games/source-version/prompts',
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': 'csrf-token-123'
        },
        body: JSON.stringify({ prompt: 'make the paddle bigger', annotationPngDataUrl: null, gameScreenshotPngDataUrl: 'data:image/png;base64,test-canvas' })
      }
    });
    expect(harness.assignCalls).toEqual(['/game/voice-fork']);
    expect(harness.recordButton.classList.contains('game-view-icon-tab--recording')).toBe(false);
    expect(harness.consoleLogs).toContainEqual(['[realtime-transcription] started']);
    expect(harness.consoleLogs).toContainEqual([
      '[realtime-transcription] data received',
      JSON.stringify({
        type: 'conversation.item.input_audio_transcription.completed',
        transcript: 'make the paddle bigger'
      })
    ]);
    expect(harness.consoleLogs).toContainEqual(['[realtime-transcription] stopped']);
    expect(harness.consoleLogs).toContainEqual([
      '[realtime-transcription] final transcribed text',
      ''
    ]);
  });

  it('adds and removes the generating class using eyeState from polling responses', async () => {
    let requestCount = 0;
    const harness = await runGameViewScript(
      async () => {
        requestCount += 1;
        if (requestCount === 1) {
          return {
            ok: true,
            async json() {
              return { status: 'no-session', eyeState: 'generating' };
            }
          };
        }

        return {
          ok: true,
          async json() {
            return { status: 'no-session', eyeState: 'idle' };
          }
        };
      },
      { startTranscriptPolling: true }
    );

    await flushAsyncOperations();
    expect(harness.editTab.classList.contains('game-view-tab--generating')).toBe(true);
    expect(harness.editTab.getAttribute('aria-busy')).toBe('true');

    harness.intervalCallbacks[0]?.();
    await flushAsyncOperations();
    expect(harness.editTab.classList.contains('game-view-tab--generating')).toBe(false);
    expect(harness.editTab.getAttribute('aria-busy')).toBe('false');
  });

  it('renders polling transcript updates with auto-scroll enabled', async () => {
    let requestCount = 0;
    const harness = await runGameViewScript(
      async (url) => {
        if (url !== '/api/codex-sessions/source-version') {
          throw new Error(`Unexpected fetch URL: ${url}`);
        }

        requestCount += 1;
        if (requestCount === 1) {
          return {
            ok: true,
            async json() {
              return {
                status: 'ok',
                eyeState: 'idle',
                sessionId: 'session-source',
                messages: [{ role: 'user', text: 'first prompt', timestamp: '2026-02-22T00:00:00.000Z' }]
              };
            }
          };
        }

        return {
          ok: true,
          async json() {
            return {
              status: 'ok',
              eyeState: 'idle',
              sessionId: 'session-source',
              messages: [
                { role: 'user', text: 'first prompt', timestamp: '2026-02-22T00:00:00.000Z' },
                { role: 'assistant', text: 'second reply', timestamp: '2026-02-22T00:00:01.000Z' }
              ]
            };
          }
        };
      },
      { startTranscriptPolling: true }
    );

    await flushAsyncOperations();
    expect(harness.renderTranscriptCalls).toHaveLength(1);
    expect(harness.renderTranscriptCalls[0]).toMatchObject({
      options: { autoScrollToBottom: true }
    });

    harness.intervalCallbacks[0]?.();
    await flushAsyncOperations();

    expect(harness.renderTranscriptCalls).toHaveLength(2);
    expect(harness.renderTranscriptCalls[1]).toMatchObject({
      options: { autoScrollToBottom: true }
    });
  });

  it('shows generating spinner behavior for claude provider', async () => {
    const harness = await runGameViewScript(
      async () => ({
        ok: true,
        async json() {
          return { status: 'no-session', eyeState: 'generating' };
        }
      }),
      { startTranscriptPolling: true, codegenProvider: 'claude' }
    );

    await flushAsyncOperations();
    expect(harness.transcriptTitle).toBe('Claude Transcript');
    expect(harness.editTab.classList.contains('game-view-tab--generating')).toBe(true);
    expect(harness.editTab.getAttribute('aria-busy')).toBe('true');
  });

  it('uses codex transcript title by default', async () => {
    const harness = await runGameViewScript(async () => ({
      ok: true,
      async json() {
        return { status: 'no-session', eyeState: 'idle' };
      }
    }));

    expect(harness.transcriptTitle).toBe('Codex Transcript');
  });
});
