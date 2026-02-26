import { expect, test, type Page } from '@playwright/test';

const TEST_ADMIN_PASSWORD = 'correct horse battery staple';

async function loginAsAdmin(page: Page) {
  await page.goto('/auth');
  await page.locator('#admin-password').fill(TEST_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page.getByText('Admin session is active.')).toBeVisible();
}

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
