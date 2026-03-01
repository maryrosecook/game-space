import { expect, test } from '@playwright/test';
import { loginAsAdmin } from './helpers/auth';

test('public game page hides manual tile snapshot capture controls', async ({ page }) => {
  await page.goto('/game/starter');

  await expect(page.locator('#game-home-button')).toBeVisible();
  await expect(page.locator('#game-tab-capture-tile')).toHaveCount(0);
});

test('game page does not log a favicon 404 console error on load', async ({ page }) => {
  const errorMessages: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') {
      return;
    }

    errorMessages.push(message.text());
  });

  await page.goto('/game/starter');
  await expect(page.locator('#game-canvas')).toBeVisible();
  expect(
    errorMessages.some(
      (message) => message.includes('favicon.ico') && message.includes('404')
    )
  ).toBe(false);
});

test('game page passes a connected canvas to the starter module bootstrap', async ({ page }) => {
  await page.route('**/games/starter/dist/game.js', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        export function startGame(canvas) {
          const windowWithState = window;
          const isCanvas = canvas instanceof HTMLCanvasElement;
          windowWithState.__starterStartGameCanvasState = {
            isCanvas,
            isConnected: isCanvas ? canvas.isConnected : null,
            id: isCanvas ? canvas.id : null
          };
        }
      `,
    });
  });

  await page.goto('/game/starter');

  await expect.poll(async () => {
    return await page.evaluate(() => {
      const windowWithState = window as Window & {
        __starterStartGameCanvasState?: {
          isCanvas: boolean;
          isConnected: boolean | null;
          id: string | null;
        };
      };

      return windowWithState.__starterStartGameCanvasState ?? null;
    });
  }).toEqual({
    isCanvas: true,
    isConnected: true,
    id: 'game-canvas',
  });
});

test('admin game page does not emit React hydration mismatch errors', async ({ page }) => {
  await loginAsAdmin(page);

  const errorMessages: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') {
      return;
    }

    errorMessages.push(message.text());
  });

  await page.goto('/game/starter');
  await expect(page.locator('#prompt-record-button')).toBeVisible();
  expect(
    errorMessages.some(
      (message) =>
        message.includes('React error #418') ||
        message.includes("A tree hydrated but some attributes of the server rendered HTML didn't match the client properties")
    )
  ).toBe(false);
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


test('admin game page shows a labeled record button with rounded border styling', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/game/starter');

  const recordButton = page.locator('#prompt-record-button');
  await expect(recordButton).toBeVisible();
  await expect(recordButton).toContainText('Describe a change');
  await expect(recordButton).toHaveCSS('border-top-left-radius', '999px');
  await expect(recordButton).toHaveCSS('border-top-width', '1px');
});


test('game page initializes yellow annotation stroke color for prompt drawing', async ({ page }) => {
  await loginAsAdmin(page);
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
