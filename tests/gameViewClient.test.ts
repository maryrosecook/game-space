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

type TestSpeechRecognitionResultEvent = {
  results: Array<Array<{ transcript: string }>>;
};

class TestSpeechRecognition {
  public static instances: TestSpeechRecognition[] = [];
  public continuous = false;
  public interimResults = false;
  public lang = '';
  public onresult: ((event: TestSpeechRecognitionResultEvent) => void) | null = null;
  public onerror: (() => void) | null = null;
  public onend: (() => void) | null = null;
  public started = false;
  public stopCallCount = 0;

  constructor() {
    TestSpeechRecognition.instances.push(this);
  }

  start(): void {
    this.started = true;
  }

  stop(): void {
    this.started = false;
    this.stopCallCount += 1;
    this.onend?.();
  }

  emitTranscript(transcript: string): void {
    this.onresult?.({
      results: [[{ transcript }]]
    });
  }
}

class TestDocument extends TestEventTarget {
  public readonly body: { dataset: { versionId?: string } };
  private readonly elements = new Map<string, unknown>();

  constructor(versionId: string) {
    super();
    this.body = {
      dataset: {
        versionId
      }
    };
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
  promptForm: TestHTMLFormElement;
  promptInput: TestHTMLInputElement;
  promptPanel: TestHTMLElement;
  promptRecord: TestHTMLButtonElement;
  speechRecognitions: TestSpeechRecognition[];
};

type RunGameViewOptions = {
  withSpeechRecognition?: boolean;
};

function createEvent(overrides: Partial<TestEvent> = {}): TestEvent {
  return {
    key: overrides.key,
    preventDefault: overrides.preventDefault ?? (() => {})
  };
}

async function flushAsyncOperations(): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await Promise.resolve();
  }
}

async function runGameViewScript(
  fetchImplementation: FetchImplementation,
  options: RunGameViewOptions = {}
): Promise<GameViewHarness> {
  const withSpeechRecognition = options.withSpeechRecognition ?? true;
  const promptPanel = new TestHTMLElement();
  const promptForm = new TestHTMLFormElement();
  const promptInput = new TestHTMLInputElement();
  const promptRecord = new TestHTMLButtonElement();
  promptRecord.textContent = 'Record';
  const gameSessionView = new TestHTMLElement();

  const document = new TestDocument('source-version');
  document.registerElement('prompt-panel', promptPanel);
  document.registerElement('prompt-form', promptForm);
  document.registerElement('prompt-input', promptInput);
  document.registerElement('prompt-record', promptRecord);
  document.registerElement('game-codex-session-view', gameSessionView);

  const fetchCalls: FetchCall[] = [];
  const assignCalls: string[] = [];
  TestSpeechRecognition.instances = [];
  const speechRecognitions = TestSpeechRecognition.instances;

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
    SpeechRecognition: withSpeechRecognition ? TestSpeechRecognition : undefined
  };

  const scriptPath = path.join(process.cwd(), 'src/public/game-view.js');
  const source = await readFile(scriptPath, 'utf8');
  const runnableSource = source
    .replace(
      "import { createCodexTranscriptPresenter } from './codex-transcript-presenter.js';\n\n",
      ''
    )
    .replace('\nstartTranscriptPolling();\n', '\n');

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
    promptForm,
    promptInput,
    promptPanel,
    promptRecord,
    speechRecognitions
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

    harness.promptInput.value = 'darken the ball';
    harness.promptForm.dispatchEvent('submit', createEvent());
    await flushAsyncOperations();

    expect(harness.fetchCalls).toHaveLength(1);
    expect(harness.fetchCalls[0]).toEqual({
      url: '/api/games/source-version/prompts',
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ prompt: 'darken the ball' })
      }
    });
    expect(harness.assignCalls).toEqual(['/game/pebble-iris-dawn']);
    expect(harness.promptInput.value).toBe('');
    expect(harness.promptPanel.getAttribute('aria-hidden')).toBe('false');
  });

  it('does not redirect when prompt submit response is missing fork id', async () => {
    const harness = await runGameViewScript(async () => ({
      ok: true,
      async json() {
        return { status: 'accepted' };
      }
    }));

    harness.promptInput.value = 'add gravity';
    harness.promptForm.dispatchEvent('submit', createEvent());
    await flushAsyncOperations();

    expect(harness.fetchCalls).toHaveLength(1);
    expect(harness.assignCalls).toHaveLength(0);
  });

  it('records speech and inserts transcript into the prompt on the second click', async () => {
    const harness = await runGameViewScript(async () => ({
      ok: true,
      async json() {
        return { forkId: 'unused' };
      }
    }));

    harness.promptInput.value = 'make';
    harness.promptRecord.dispatchEvent('click', createEvent());
    expect(harness.speechRecognitions).toHaveLength(1);
    expect(harness.promptRecord.classList.contains('prompt-record--recording')).toBe(true);
    expect(harness.promptRecord.getAttribute('aria-pressed')).toBe('true');
    expect(harness.promptRecord.textContent).toBe('Record');
    expect(harness.promptInput.value).toBe('make');

    harness.speechRecognitions[0]?.emitTranscript('the ball glow');
    harness.promptRecord.dispatchEvent('click', createEvent());

    expect(harness.promptRecord.classList.contains('prompt-record--recording')).toBe(false);
    expect(harness.promptRecord.getAttribute('aria-pressed')).toBe('false');
    expect(harness.promptRecord.textContent).toBe('Record');
    expect(harness.speechRecognitions[0]?.stopCallCount).toBe(1);
    expect(harness.promptInput.value).toBe('make the ball glow');
    expect(harness.promptInput.focused).toBe(true);
  });

  it('disables the record button when speech recognition is unavailable', async () => {
    const harness = await runGameViewScript(
      async () => ({
        ok: true,
        async json() {
          return { forkId: 'unused' };
        }
      }),
      { withSpeechRecognition: false }
    );

    expect(harness.promptRecord.disabled).toBe(true);
  });
});
