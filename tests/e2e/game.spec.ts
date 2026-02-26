import { expect, test } from '@playwright/test';

test('public game page hides manual tile snapshot capture controls', async ({ page }) => {
  await page.goto('/game/starter');

  await expect(page.locator('#game-home-button')).toBeVisible();
  await expect(page.locator('#game-tab-capture-tile')).toHaveCount(0);
});
