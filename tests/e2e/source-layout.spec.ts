import { expect, test } from '@playwright/test';

import { loginAsAdmin } from './helpers/auth';

test('homepage and game routes still load after Next app directory relocation', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Fountain');

  const gamePageResponse = await page.goto('/game/starter');
  expect(gamePageResponse?.status()).toBe(200);
  await expect(page.locator('#game-canvas')).toBeVisible();

  await loginAsAdmin(page);
  await page.goto('/game/starter');
  await page.locator('#game-tab-edit').click();
  await expect(page.locator('#prompt-panel')).toHaveAttribute('aria-hidden', 'false');
});
