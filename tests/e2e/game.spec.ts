import { expect, test, type Page } from '@playwright/test';

const TEST_ADMIN_PASSWORD = 'correct horse battery staple';

async function loginAsAdmin(page: Page) {
  await page.goto('/auth');
  await page.locator('#admin-password').fill(TEST_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page.getByText('Admin session is active.')).toBeVisible();
}



test('starter canvas remains background-only with no things or particles', async ({ page }) => {
  await page.goto('/game/starter');

  await page.waitForTimeout(120);

  const sample = await page.locator('#game-canvas').evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) {
      return null;
    }

    const gl = canvas.getContext('webgl');
    if (!gl) {
      return null;
    }

    const centerX = Math.floor(gl.drawingBufferWidth / 2);
    const centerY = Math.floor(gl.drawingBufferHeight / 2);
    const pixel = new Uint8Array(4);
    gl.readPixels(centerX, centerY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);

    return Array.from(pixel);
  });

  expect(sample).toEqual([2, 6, 23, 255]);
});


test('game page teardown runs on refresh for games that return cleanup handlers', async ({ page }) => {
  await page.route('**/games/starter/dist/game.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        globalThis.__refreshCleanupStats = globalThis.__refreshCleanupStats ?? { starts: 0, cleanups: 0 };
        export function startGame() {
          globalThis.__refreshCleanupStats.starts += 1;
          return () => {
            globalThis.__refreshCleanupStats.cleanups += 1;
          };
        }
      `
    });
  });

  await page.goto('/game/starter');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const stats = (globalThis as typeof globalThis & {
          __refreshCleanupStats?: { starts: number; cleanups: number };
        }).__refreshCleanupStats;
        return stats ? { ...stats } : null;
      })
    )
    .toEqual({ starts: 1, cleanups: 0 });

  await page.reload();

  await expect
    .poll(() =>
      page.evaluate(() => {
        const stats = (globalThis as typeof globalThis & {
          __refreshCleanupStats?: { starts: number; cleanups: number };
        }).__refreshCleanupStats;
        return stats ? { ...stats } : null;
      })
    )
    .toEqual({ starts: 2, cleanups: 1 });
});


test('game page stores a reusable teardown handler on window during runtime', async ({ page }) => {
  await page.route('**/games/starter/dist/game.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        globalThis.__windowTeardownStats = globalThis.__windowTeardownStats ?? { starts: 0, cleanups: 0 };
        export function startGame() {
          globalThis.__windowTeardownStats.starts += 1;
          return () => {
            globalThis.__windowTeardownStats.cleanups += 1;
          };
        }
      `
    });
  });

  await page.goto('/game/starter');

  await expect
    .poll(() =>
      page.evaluate(() => {
        const teardown = (globalThis as typeof globalThis & {
          __fountainGameTeardown?: unknown;
        }).__fountainGameTeardown;
        return typeof teardown;
      })
    )
    .toBe('function');

  await page.evaluate(() => {
    const teardown = (globalThis as typeof globalThis & {
      __fountainGameTeardown?: (() => void) | null;
    }).__fountainGameTeardown;
    if (typeof teardown === 'function') {
      teardown();
    }
  });

  await expect
    .poll(() =>
      page.evaluate(() => {
        const stats = (globalThis as typeof globalThis & {
          __windowTeardownStats?: { starts: number; cleanups: number };
        }).__windowTeardownStats;
        return stats ? { ...stats } : null;
      })
    )
    .toEqual({ starts: 1, cleanups: 1 });
});
test('public game page hides manual tile snapshot capture controls', async ({ page }) => {
  await page.goto('/game/starter');

  await expect(page.locator('#game-home-button')).toBeVisible();
  await expect(page.locator('#game-tab-capture-tile')).toHaveCount(0);
});

test('admin game page places tile capture in edit panel and posts tile snapshot data', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/game/starter');

  await expect(page.locator('#prompt-panel')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.game-tool-tabs #game-tab-capture-tile')).toHaveCount(0);

  await page.locator('#game-tab-edit').click();
  await expect(page.locator('#prompt-panel')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('#game-tab-capture-tile')).toBeVisible();
  await expect(page.locator('#game-tab-capture-tile')).toHaveCSS('color', 'rgb(247, 249, 255)');

  const actionButtonIds = await page
    .locator('#prompt-form .prompt-action-row > button')
    .evaluateAll((elements) => elements.map((element) => element.id));
  const tileCaptureIndex = actionButtonIds.indexOf('game-tab-capture-tile');
  const deleteIndex = actionButtonIds.indexOf('game-tab-delete');
  expect(tileCaptureIndex).toBeGreaterThanOrEqual(0);
  expect(deleteIndex).toBeGreaterThanOrEqual(0);
  expect(tileCaptureIndex).toBeLessThan(deleteIndex);
  expect(deleteIndex).toBe(actionButtonIds.length - 1);

  let tileCaptureRequestBody: string | null = null;
  await page.route('**/api/games/starter/tile-snapshot', async (route) => {
    tileCaptureRequestBody = route.request().postData() ?? null;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        versionId: 'starter',
        tileSnapshotPath: '/games/starter/snapshots/tile.png'
      })
    });
  });

  await page.locator('#game-tab-capture-tile').click();

  await expect.poll(() => tileCaptureRequestBody).not.toBeNull();
  const tileCapturePayload = JSON.parse(tileCaptureRequestBody ?? '{}') as { tilePngDataUrl?: string };
  expect(typeof tileCapturePayload.tilePngDataUrl).toBe('string');
  expect(tileCapturePayload.tilePngDataUrl?.startsWith('data:image/png;base64,')).toBe(true);
});


test('manual tile capture refreshes homepage tile snapshot URL', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/game/starter');
  await page.locator('#game-tab-edit').click();
  await page.locator('#game-tab-capture-tile').click();

  await page.goto('/');
  await expect
    .poll(async () =>
      page
        .locator('.game-tile[data-version-id="starter"] .tile-image')
        .getAttribute('src')
    )
    .toMatch(/^\/games\/starter\/snapshots\/tile\.png\?v=/);
});

test('admin game page shows a labeled record button with rounded border styling', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/game/starter');

  const recordButton = page.locator('#prompt-record-button');
  await expect(recordButton).toBeVisible();
  await expect(recordButton).toContainText('Describe a change');
  await expect(recordButton).toHaveCSS('border-top-left-radius', '999px');
  await expect(recordButton).toHaveCSS('border-top-width', '1px');
});

test('stop recording keeps the mic button disabled until realtime transcription finalizes', async ({ page }) => {
  await page.addInitScript(() => {
    class FakeTrack {
      stop() {}
    }

    class FakeStream {
      getTracks() {
        return [new FakeTrack()];
      }
    }

    class FakeDataChannel {
      readyState = 'open';
      #messageListener: ((event: { data: string }) => void) | null = null;

      addEventListener(type: string, listener: (event: { data: string }) => void) {
        if (type === 'message') {
          this.#messageListener = listener;
        }
      }

      send(message: string) {
        void message;
      }

      close() {
        this.readyState = 'closed';
      }

      emit(payload: unknown) {
        if (!this.#messageListener) {
          return;
        }

        this.#messageListener({ data: JSON.stringify(payload) });
      }
    }

    class FakeRTCPeerConnection {
      dataChannel = new FakeDataChannel();

      createDataChannel() {
        (window as typeof window & { __fakeRealtimeDataChannel?: FakeDataChannel }).__fakeRealtimeDataChannel =
          this.dataChannel;
        return this.dataChannel;
      }

      addTrack() {}

      async createOffer() {
        return { type: 'offer', sdp: 'fake-offer-sdp' };
      }

      async setLocalDescription() {}

      async setRemoteDescription() {}

      close() {}
    }

    (window as typeof window & { __emitRealtimeFinal?: () => void }).__emitRealtimeFinal = () => {
      (window as typeof window & { __fakeRealtimeDataChannel?: FakeDataChannel }).__fakeRealtimeDataChannel?.emit({
        type: 'response.done'
      });
    };

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        async getUserMedia() {
          return new FakeStream();
        }
      }
    });

    Object.defineProperty(window, 'RTCPeerConnection', {
      configurable: true,
      writable: true,
      value: FakeRTCPeerConnection
    });
  });

  await page.route('**/api/transcribe', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ clientSecret: 'ephemeral-secret', model: 'gpt-realtime-1.5' })
    });
  });

  await page.route('https://api.openai.com/v1/realtime/calls', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/sdp',
      body: 'fake-answer-sdp'
    });
  });

  await loginAsAdmin(page);
  await page.goto('/game/starter');

  const recordButton = page.locator('#prompt-record-button');
  await recordButton.click();
  await expect(recordButton).toHaveAttribute('aria-label', 'Stop voice recording');

  await recordButton.click();
  await expect(recordButton).toBeDisabled();
  await expect(recordButton).toHaveClass(/game-view-icon-tab--recording/);
  await expect(recordButton).toHaveClass(/game-view-icon-tab--busy/);

  await page.evaluate(() => {
    (window as typeof window & { __emitRealtimeFinal?: () => void }).__emitRealtimeFinal?.();
  });

  await expect(recordButton).toBeEnabled();
  await expect(recordButton).toHaveAttribute('aria-label', 'Start voice recording');
});


test('game page initializes yellow annotation stroke color for prompt drawing', async ({ page }) => {
  await page.goto('/game/starter');

  const strokeStyle = await page.locator('#prompt-drawing-canvas').evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) {
      return null;
    }

    const context = canvas.getContext('2d');
    return context?.strokeStyle ?? null;
  });

  expect(strokeStyle).toBe('rgba(250, 204, 21, 0.95)');
});


test('admin game panel toggles keep aria-expanded attributes in sync', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/game/starter');

  const editToggle = page.locator('#game-tab-edit');
  const transcriptToggle = page.locator('#game-codex-toggle');
  const promptPanel = page.locator('#prompt-panel');
  const transcriptPanel = page.locator('#game-codex-transcript');

  await expect(editToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(transcriptToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(promptPanel).toHaveAttribute('aria-hidden', 'true');
  await expect(transcriptPanel).toHaveAttribute('aria-hidden', 'true');

  await editToggle.click();
  await expect(editToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(promptPanel).toHaveAttribute('aria-hidden', 'false');
  await expect(transcriptToggle).toHaveAttribute('aria-expanded', 'false');

  await transcriptToggle.click();
  await expect(transcriptToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(transcriptPanel).toHaveAttribute('aria-hidden', 'false');

  await transcriptToggle.click();
  await expect(transcriptToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(transcriptPanel).toHaveAttribute('aria-hidden', 'true');
  await expect(editToggle).toHaveAttribute('aria-expanded', 'true');

  await editToggle.click();
  await expect(editToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(promptPanel).toHaveAttribute('aria-hidden', 'true');
});

test('admin game prompt draft persists per game in local storage and clears on submit', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/game/starter');
  await page.locator('#game-tab-edit').click();

  const promptInput = page.locator('#prompt-input');
  await promptInput.fill('persist me');

  await expect
    .poll(() =>
      page.evaluate(() => window.localStorage.getItem('game-space:draft-prompt:starter'))
    )
    .toBe('persist me');

  await page.reload();
  await page.locator('#game-tab-edit').click();
  await expect(promptInput).toHaveValue('persist me');

  await expect(
    await page.evaluate(() => Object.keys(window.localStorage))
  ).toContain('game-space:draft-prompt:starter');


  await page.route('**/api/games/starter/prompts', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ forkId: 'starter-submitted' })
    });
  });

  await promptInput.fill('submit and clear');
  await page.locator('#prompt-form').press('Meta+Enter');

  await expect(page).toHaveURL('**/game/starter-submitted');
  await page.goto('/game/starter');
  await page.locator('#game-tab-edit').click();
  await expect(page.locator('#prompt-input')).toHaveValue('');

  await expect
    .poll(() =>
      page.evaluate(() => window.localStorage.getItem('game-space:draft-prompt:starter'))
    )
    .toBeNull();
});
