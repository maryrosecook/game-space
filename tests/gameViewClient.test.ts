import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

type TestEvent = {
  key?: string;
  preventDefault: () => void;
};

type EventListener = (event: TestEvent) => void;

type FetchResponse = {
  ok: boolean;
  json: () => Promise<unknown>;
};

type FetchCall = {
  url: string;
  init: Record<string, unknown> | undefined;
};

type FetchImplementation = (url: string, init?: Record<string, unknown>) => Promise<FetchResponse>;

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

class TestBodyElement extends TestHTMLElement {
  public readonly dataset: { versionId?: string; csrfToken?: string };

  constructor(versionId: string, csrfToken: string | undefined) {
    super();
    this.dataset = { versionId, csrfToken };
  }
}

class TestDocument extends TestEventTarget {
  public readonly body: TestBodyElement;
  private readonly elements = new Map<string, unknown>();

  constructor(versionId: string, csrfToken: string | undefined) {
    super();
    this.body = new TestBodyElement(versionId, csrfToken);
  }

  registerElement(id: string, element: unknown): void {
    this.elements.set(id, element);
  }

  getElementById(id: string): unknown {
    return this.elements.get(id) ?? null;
  }
}

type GameViewHarness = {
  fetchCalls: FetchCall[];
  assignCalls: string[];
  body: TestBodyElement;
  editTab: TestHTMLButtonElement;
  recordButton: TestHTMLButtonElement;
  codexToggle: TestHTMLButtonElement;
  promptForm: TestHTMLFormElement;
  promptInput: TestHTMLInputElement;
  promptPanel: TestHTMLElement;
  intervalCallbacks: Array<() => void>;
};

type RunGameViewOptions = {
  csrfToken?: string | undefined;
  startTranscriptPolling?: boolean;
};

function createEvent(overrides: Partial<TestEvent> = {}): TestEvent {
  return {
    key: overrides.key,
    preventDefault: overrides.preventDefault ?? (() => {})
  };
}

async function flushAsyncOperations(): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await Promise.resolve();
  }
}

async function runGameViewScript(
  fetchImplementation: FetchImplementation,
  options: RunGameViewOptions = {}
): Promise<GameViewHarness> {
  const csrfToken = Object.hasOwn(options, 'csrfToken') ? options.csrfToken : 'csrf-token-123';
  const startTranscriptPolling = options.startTranscriptPolling ?? false;
  const promptPanel = new TestHTMLElement();
  const promptForm = new TestHTMLFormElement();
  const promptInput = new TestHTMLInputElement();
  const editTab = new TestHTMLButtonElement();
  const recordButton = new TestHTMLButtonElement();
  const codexToggle = new TestHTMLButtonElement();
  const codexTranscript = new TestHTMLElement();
  const gameSessionView = new TestHTMLElement();

  const document = new TestDocument('source-version', csrfToken);
  document.registerElement('prompt-panel', promptPanel);
  document.registerElement('prompt-form', promptForm);
  document.registerElement('prompt-input', promptInput);
  document.registerElement('game-tab-edit', editTab);
  document.registerElement('prompt-record-button', recordButton);
  document.registerElement('game-codex-toggle', codexToggle);
  document.registerElement('game-codex-transcript', codexTranscript);
  document.registerElement('game-codex-session-view', gameSessionView);

  const fetchCalls: FetchCall[] = [];
  const assignCalls: string[] = [];
  const intervalCallbacks: Array<() => void> = [];

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
    .replace('\nstartTranscriptPolling();\n', startTranscriptPolling ? '\nstartTranscriptPolling();\n' : '\n');

  const context = {
    document,
    window,
    fetch(url: string, init?: Record<string, unknown>): Promise<FetchResponse> {
      fetchCalls.push({ url, init });
      return fetchImplementation(url, init);
    },
    HTMLButtonElement: TestHTMLButtonElement,
    HTMLElement: TestHTMLElement,
    HTMLFormElement: TestHTMLFormElement,
    HTMLInputElement: TestHTMLInputElement,
    createCodexTranscriptPresenter() {
      return {
        showEmptyState() {},
        renderTranscript() {}
      };
    },
    encodeURIComponent,
    Error
  };

  vm.runInNewContext(runnableSource, context, { filename: scriptPath });

  return {
    fetchCalls,
    assignCalls,
    body: document.body,
    editTab,
    recordButton,
    codexToggle,
    promptForm,
    promptInput,
    promptPanel,
    intervalCallbacks
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
        body: JSON.stringify({ prompt: 'darken the ball' })
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
      body: JSON.stringify({ prompt: 'darken the ball' })
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
});
