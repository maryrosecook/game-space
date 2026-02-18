import { expect, test } from '@playwright/test';

test('homepage renders game index shell', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Fountain');
  await expect(page.getByRole('heading', { level: 1, name: 'Fountain' })).toBeVisible();
});
