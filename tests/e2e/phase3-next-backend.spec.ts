import { expect, test } from '@playwright/test';

import { loginAsAdmin, logoutAsAdmin } from './helpers/auth';

test('phase3 backend preserves auth and ideas API access behavior', async ({ page }) => {
  await page.goto('/auth');
  await expect(page.getByText('Enter the admin password to unlock prompt and transcript tools.')).toBeVisible();

  const guestIdeasResponse = await page.goto('/api/ideas');
  expect(guestIdeasResponse?.status()).toBe(404);

  await loginAsAdmin(page);

  const adminIdeasResponse = await page.goto('/api/ideas');
  expect(adminIdeasResponse?.status()).toBe(200);
  const ideasPayload = JSON.parse((await page.locator('body').textContent()) ?? '{}') as {
    ideas?: unknown;
    isGenerating?: unknown;
  };
  expect(Array.isArray(ideasPayload.ideas)).toBe(true);
  expect(typeof ideasPayload.isGenerating).toBe('boolean');

  await logoutAsAdmin(page);

  const loggedOutIdeasResponse = await page.goto('/api/ideas');
  expect(loggedOutIdeasResponse?.status()).toBe(404);
});

test('auth rejects invalid password even when forwarded IP headers are spoofed', async ({ context, page }) => {
  await page.goto('/auth');
  const csrfToken = await page.locator('input[name="csrfToken"]').inputValue();
  const csrfCookie = (await context.cookies()).find((cookie) => cookie.name === 'game_space_csrf_token');
  if (!csrfCookie) {
    throw new Error('Expected CSRF cookie from /auth page load');
  }

  const invalidLoginResponse = await context.request.post('/auth/login', {
    form: {
      csrfToken,
      password: 'definitely-not-the-admin-password',
    },
    headers: {
      Origin: 'http://127.0.0.1:3100',
      Cookie: `game_space_csrf_token=${encodeURIComponent(csrfCookie.value)}`,
      'X-Forwarded-For': '203.0.113.10, 198.51.100.99',
    },
  });
  expect(invalidLoginResponse.status()).toBe(401);

  await loginAsAdmin(page);
});
