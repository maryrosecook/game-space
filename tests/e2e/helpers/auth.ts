import { expect, type Page } from '@playwright/test';

export const TEST_ADMIN_PASSWORD = 'correct horse battery staple';

export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/auth');
  await page.locator('#admin-password').fill(TEST_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page.getByText('Admin session is active.')).toBeVisible();
}

export async function logoutAsAdmin(page: Page): Promise<void> {
  await page.goto('/auth');
  await page.getByRole('button', { name: 'Logout' }).click();
  await expect(page.getByText('Enter the admin password to unlock prompt and transcript tools.')).toBeVisible();
}
