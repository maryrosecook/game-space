import { expect, test } from '@playwright/test';

import { loginAsAdmin, logoutAsAdmin } from './helpers/auth';

test('homepage renders through Next assets on the same origin', async ({ page }) => {
  const nextAssetRequests: string[] = [];
  page.on('request', (request) => {
    const requestUrl = request.url();
    if (requestUrl.includes('/_next/')) {
      nextAssetRequests.push(requestUrl);
    }
  });

  await page.goto('/');
  await expect(page).toHaveTitle('Fountain');
  await expect(page.getByRole('heading', { name: 'Fountain' })).toBeVisible();
  await page.waitForLoadState('networkidle');

  expect(nextAssetRequests.length).toBeGreaterThan(0);
  const homepageOrigin = new URL(page.url()).origin;
  expect(nextAssetRequests.every((requestUrl) => new URL(requestUrl).origin === homepageOrigin)).toBe(true);
});

test('login and logout still toggle homepage admin links', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Login' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ideas' })).toHaveCount(0);

  await loginAsAdmin(page);

  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Admin' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ideas' })).toBeVisible();

  await logoutAsAdmin(page);

  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Login' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ideas' })).toHaveCount(0);
});
