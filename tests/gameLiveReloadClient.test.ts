import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

type FetchResponse = {
  ok: boolean;
  text: () => Promise<string>;
};

type FetchImplementation = (
  url: string,
  init?: Record<string, unknown>
) => Promise<FetchResponse>;

type ReloadHarness = {
  fetchCalls: Array<{
    url: string;
    init: Record<string, unknown> | undefined;
  }>;
  reloadCalls: number;
  tick: () => Promise<void>;
};

async function flushAsyncOperations(): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await Promise.resolve();
  }
}

async function runLiveReloadScript(fetchImplementation: FetchImplementation): Promise<ReloadHarness> {
  const fetchCalls: Array<{ url: string; init: Record<string, unknown> | undefined }> = [];
  let reloadCalls = 0;
  let intervalCallback: (() => void) | null = null;

  const context = {
    document: {
      body: {
        dataset: {
          versionId: 'source-version'
        }
      }
    },
    window: {
      location: {
        reload(): void {
          reloadCalls += 1;
        }
      }
    },
    fetch(url: string, init?: Record<string, unknown>): Promise<FetchResponse> {
      fetchCalls.push({ url, init });
      return fetchImplementation(url, init);
    },
    setInterval(callback: () => void): number {
      intervalCallback = callback;
      return 1;
    },
    Date,
    encodeURIComponent
  };

  const scriptPath = path.join(process.cwd(), 'src/public/game-live-reload.js');
  const source = await readFile(scriptPath, 'utf8');
  vm.runInNewContext(source, context, { filename: scriptPath });
  await flushAsyncOperations();

  return {
    fetchCalls,
    get reloadCalls() {
      return reloadCalls;
    },
    async tick() {
      intervalCallback?.();
      await flushAsyncOperations();
    }
  };
}

describe('game live reload client', () => {
  it('reloads the page when the reload token changes after the baseline read', async () => {
    const tokens = ['token-1', 'token-2'];
    const harness = await runLiveReloadScript(async () => {
      const token = tokens.shift();
      return {
        ok: token !== undefined,
        async text() {
          return token ?? '';
        }
      };
    });

    await harness.tick();

    expect(harness.reloadCalls).toBe(1);
    expect(harness.fetchCalls[0]?.url).toContain('/games/source-version/dist/reload-token.txt');
    expect(harness.fetchCalls[0]?.init).toEqual({ cache: 'no-store' });
  });

  it('does not reload when the token value stays the same', async () => {
    const harness = await runLiveReloadScript(async () => ({
      ok: true,
      async text() {
        return 'same-token';
      }
    }));

    await harness.tick();

    expect(harness.reloadCalls).toBe(0);
  });

  it('does not reload when token reads fail', async () => {
    const harness = await runLiveReloadScript(async () => ({
      ok: false,
      async text() {
        return '';
      }
    }));

    await harness.tick();

    expect(harness.reloadCalls).toBe(0);
  });
});
