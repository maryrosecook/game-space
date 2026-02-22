import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

type FetchResponse = {
  ok: boolean;
  status?: number;
  json?: () => Promise<unknown>;
};

type FetchImplementation = (url: string) => Promise<FetchResponse>;

type TranscriptRenderCall = {
  sessionId: unknown;
  messages: unknown;
  options: { autoScrollToBottom?: boolean } | undefined;
};

class TestHTMLElement {}

class TestHTMLSelectElement {
  public readonly options: Array<{ value: string }>;
  public value: string;
  private readonly listeners = new Map<string, Array<() => void>>();

  constructor(optionValues: string[], selectedValue: string) {
    this.options = optionValues.map((value) => ({ value }));
    this.value = selectedValue;
  }

  addEventListener(type: string, listener: () => void): void {
    const existing = this.listeners.get(type);
    if (existing) {
      existing.push(listener);
      return;
    }

    this.listeners.set(type, [listener]);
  }
}

class TestDocument {
  public readonly body: { dataset: { codegenProvider?: string } };
  private readonly elements = new Map<string, unknown>();

  constructor(codegenProvider?: string) {
    this.body = { dataset: { codegenProvider } };
  }

  registerElement(id: string, element: unknown): void {
    this.elements.set(id, element);
  }

  getElementById(id: string): unknown {
    return this.elements.get(id) ?? null;
  }
}

async function flushAsyncOperations(): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await Promise.resolve();
  }

  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function runCodexViewScript(fetchImplementation: FetchImplementation): Promise<{
  fetchCalls: string[];
  renderCalls: TranscriptRenderCall[];
}> {
  const gameSelect = new TestHTMLSelectElement(['source-version'], 'source-version');
  const sessionView = new TestHTMLElement();
  const document = new TestDocument('codex');
  document.registerElement('codex-game-select', gameSelect);
  document.registerElement('codex-session-view', sessionView);

  const fetchCalls: string[] = [];
  const renderCalls: TranscriptRenderCall[] = [];
  const window = {
    location: {
      href: 'https://example.com/codex'
    },
    history: {
      replaceState(state: unknown, title: string, url: URL): void {
        void state;
        void title;
        void url;
      }
    }
  };

  const scriptPath = path.join(process.cwd(), 'src/public/codex-view.js');
  const source = await readFile(scriptPath, 'utf8');
  const runnableSource = source.replace(
    "import { createCodexTranscriptPresenter } from './codex-transcript-presenter.js';\n\n",
    ''
  );

  const context = {
    document,
    window,
    fetch(url: string): Promise<FetchResponse> {
      fetchCalls.push(url);
      return fetchImplementation(url);
    },
    createCodexTranscriptPresenter(sessionView: unknown, options?: { transcriptTitle?: string }) {
      void sessionView;
      void options;
      return {
        showLoadingState() {},
        showEmptyState() {},
        renderTranscript(sessionId: unknown, messages: unknown, options?: { autoScrollToBottom?: boolean }) {
          renderCalls.push({
            sessionId,
            messages,
            options
          });
        }
      };
    },
    HTMLSelectElement: TestHTMLSelectElement,
    URL,
    encodeURIComponent
  };

  vm.runInNewContext(runnableSource, context, { filename: scriptPath });
  await flushAsyncOperations();

  return {
    fetchCalls,
    renderCalls
  };
}

describe('codex view client', () => {
  it('renders loaded transcript with auto-scroll enabled', async () => {
    const messages = [{ role: 'user', text: 'first prompt' }];
    const harness = await runCodexViewScript(async (url) => {
      if (url !== '/api/codex-sessions/source-version') {
        throw new Error(`Unexpected fetch URL: ${url}`);
      }

      return {
        ok: true,
        async json() {
          return {
            status: 'ok',
            sessionId: 'session-source',
            messages
          };
        }
      };
    });

    expect(harness.fetchCalls).toEqual(['/api/codex-sessions/source-version']);
    expect(harness.renderCalls).toEqual([
      {
        sessionId: 'session-source',
        messages,
        options: { autoScrollToBottom: true }
      }
    ]);
  });
});
