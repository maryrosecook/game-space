import { expect, test } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { loginAsAdmin, logoutAsAdmin } from './helpers/auth';

const IDEAS_PATH = path.resolve('ideas.json');

type GameIdea = {
  prompt: string;
  hasBeenBuilt: boolean;
};

type ForkMetadata = {
  parentId?: string | null;
  prompt?: string;
  codexSessionStatus?: string | null;
};

function pathnameFromUrl(url: string): string {
  return new URL(url).pathname;
}

function gameVersionIdFromUrl(url: string): string | null {
  const pathname = pathnameFromUrl(url);
  if (!pathname.startsWith('/game/')) {
    return null;
  }

  const encodedVersionId = pathname.slice('/game/'.length);
  if (encodedVersionId.length === 0) {
    return null;
  }

  try {
    return decodeURIComponent(encodedVersionId);
  } catch {
    return null;
  }
}

async function writeIdeasFile(ideas: readonly GameIdea[]): Promise<void> {
  await fs.writeFile(IDEAS_PATH, `${JSON.stringify(ideas, null, 2)}\n`, 'utf8');
}

async function removeGameVersionDirectory(versionId: string | null): Promise<void> {
  if (typeof versionId !== 'string' || versionId.length === 0) {
    return;
  }

  await fs.rm(path.resolve('games', versionId), { recursive: true, force: true });
}

async function waitForForkSessionStatusToSettle(versionId: string | null): Promise<void> {
  if (typeof versionId !== 'string' || versionId.length === 0) {
    return;
  }

  const metadataPath = path.resolve('games', versionId, 'metadata.json');
  const timeoutAt = Date.now() + 5_000;

  while (Date.now() < timeoutAt) {
    try {
      const serializedMetadata = await fs.readFile(metadataPath, 'utf8');
      const metadata = JSON.parse(serializedMetadata) as ForkMetadata;
      const status = metadata.codexSessionStatus;

      if (status === 'error' || status === 'stopped' || status === 'none') {
        return;
      }
    } catch {
      return;
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 100);
    });
  }
}

test.describe.configure({ mode: 'serial' });

test('dedicated login/logout flow toggles admin-only visibility and access', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Login' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Admin' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Ideas' })).toHaveCount(0);

  await loginAsAdmin(page);

  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Admin' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ideas' })).toBeVisible();

  await logoutAsAdmin(page);

  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Login' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Admin' })).toHaveCount(0);

  const ideasResponse = await page.goto('/ideas');
  expect(ideasResponse?.status()).toBe(404);
  await expect(page.getByText(/could not be found/i)).toBeVisible();
});

test('ideas generate action sends csrf and renders returned ideas', async ({ page }) => {
  await loginAsAdmin(page);

  await page.route('**/api/ideas', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ideas: [{ prompt: 'phase0 baseline idea', hasBeenBuilt: false }],
        isGenerating: false,
      }),
    });
  });

  let generateCsrfHeaderLength = 0;
  await page.route('**/api/ideas/generate', async (route) => {
    const csrfHeader = route.request().headers()['x-csrf-token'];
    generateCsrfHeaderLength = typeof csrfHeader === 'string' ? csrfHeader.length : 0;

    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        prompt: 'phase0 generated idea',
        ideas: [
          { prompt: 'phase0 generated idea', hasBeenBuilt: false },
          { prompt: 'phase0 baseline idea', hasBeenBuilt: false },
        ],
      }),
    });
  });

  try {
    await page.goto('/ideas');
    await expect(page.getByRole('heading', { level: 1, name: 'Ideas' })).toBeVisible();
    await expect(page.locator('.idea-row')).toHaveCount(1);

    await page.locator('#ideas-generate-button').click();
    await expect.poll(() => generateCsrfHeaderLength).toBeGreaterThan(0);
    await expect(page.locator('.idea-row')).toHaveCount(2);
    await expect(page.locator('.idea-row').first().locator('.idea-prompt')).toHaveText('phase0 generated idea');
  } finally {
    await page.unroute('**/api/ideas/generate');
    await page.unroute('**/api/ideas');
  }
});

test('ideas build and delete actions trigger backend mutations from the UI', async ({ page }) => {
  const originalIdeasContents = await fs.readFile(IDEAS_PATH, 'utf8');
  let forkedVersionId: string | null = null;
  let deleteRequestCount = 0;

  try {
    await writeIdeasFile([
      { prompt: 'phase0 seed alpha', hasBeenBuilt: false },
      { prompt: 'phase0 seed beta', hasBeenBuilt: false },
    ]);

    await loginAsAdmin(page);
    await page.goto('/ideas');
    await expect(page.getByRole('heading', { level: 1, name: 'Ideas' })).toBeVisible();
    await expect(page.locator('.idea-row')).toHaveCount(2);

    const buildResponsePromise = page.waitForResponse((response) => {
      if (response.request().method() !== 'POST') {
        return false;
      }

      return /^\/api\/ideas\/\d+\/build$/.test(pathnameFromUrl(response.url()));
    });

    await page
      .locator('.idea-row', { hasText: 'phase0 seed alpha' })
      .getByRole('button', { name: 'Build from idea' })
      .click();
    const buildResponse = await buildResponsePromise;
    expect(buildResponse.status()).toBe(202);

    await expect(page).toHaveURL(/\/game\/[^/?#]+$/);
    forkedVersionId = gameVersionIdFromUrl(page.url());
    if (forkedVersionId === null || forkedVersionId.length === 0) {
      throw new Error('Expected ideas build flow to navigate to a forked game URL');
    }

    await page.goto('/ideas');
    await expect(
      page.locator('.idea-row', { hasText: 'phase0 seed alpha' }).locator('.idea-built-pill'),
    ).toHaveCount(1);

    page.on('request', (request) => {
      if (request.method() !== 'DELETE') {
        return;
      }

      if (/^\/api\/ideas\/\d+$/.test(pathnameFromUrl(request.url()))) {
        deleteRequestCount += 1;
      }
    });

    const ideaToDelete = page.locator('.idea-row', { hasText: 'phase0 seed beta' });
    await expect(ideaToDelete).toBeVisible();

    page.once('dialog', (dialog) => {
      void dialog.dismiss();
    });
    await ideaToDelete.getByRole('button', { name: 'Delete idea' }).click();
    await expect.poll(() => deleteRequestCount).toBe(0);
    await expect(ideaToDelete).toBeVisible();

    const deleteResponsePromise = page.waitForResponse((response) => {
      if (response.request().method() !== 'DELETE') {
        return false;
      }

      return /^\/api\/ideas\/\d+$/.test(pathnameFromUrl(response.url()));
    });
    page.once('dialog', (dialog) => {
      void dialog.accept();
    });
    await ideaToDelete.getByRole('button', { name: 'Delete idea' }).click();
    const deleteResponse = await deleteResponsePromise;
    expect(deleteResponse.status()).toBe(200);
    await expect(ideaToDelete).toHaveCount(0);
    await expect.poll(() => deleteRequestCount).toBe(1);
  } finally {
    await fs.writeFile(IDEAS_PATH, originalIdeasContents, 'utf8');
    await waitForForkSessionStatusToSettle(forkedVersionId);
    await removeGameVersionDirectory(forkedVersionId);
  }
});

test('admin prompt submit triggers backend start from UI and navigates to the fork', async ({ page }) => {
  let forkedVersionId: string | null = null;
  let promptSubmitRequestCount = 0;

  try {
    await loginAsAdmin(page);
    await page.goto('/game/starter');
    await page.locator('#game-tab-edit').click();

    page.on('request', (request) => {
      if (request.method() !== 'POST') {
        return;
      }

      if (pathnameFromUrl(request.url()) === '/api/games/starter/prompts') {
        promptSubmitRequestCount += 1;
      }
    });

    const promptInput = page.locator('#prompt-input');
    const promptSubmitButton = page.locator('#prompt-submit-button');

    await promptInput.fill('   ');
    await promptSubmitButton.click();
    await expect.poll(() => promptSubmitRequestCount).toBe(0);

    const promptText = `phase0 backend trigger ${Date.now()}`;
    await promptInput.fill(promptText);

    const promptResponsePromise = page.waitForResponse((response) => {
      return (
        response.request().method() === 'POST' &&
        pathnameFromUrl(response.url()) === '/api/games/starter/prompts'
      );
    });
    await promptSubmitButton.click();
    const promptResponse = await promptResponsePromise;
    expect(promptResponse.status()).toBe(202);

    await expect(page).toHaveURL(/\/game\/[^/?#]+$/);
    forkedVersionId = gameVersionIdFromUrl(page.url());
    if (forkedVersionId === null || forkedVersionId.length === 0) {
      throw new Error('Expected prompt submit flow to navigate to a forked game URL');
    }

    const forkMetadataPath = path.resolve('games', forkedVersionId, 'metadata.json');
    await expect.poll(async () => {
      try {
        const serializedMetadata = await fs.readFile(forkMetadataPath, 'utf8');
        const metadata = JSON.parse(serializedMetadata) as ForkMetadata;
        return metadata.prompt ?? null;
      } catch {
        return null;
      }
    }).toBe(promptText);

    const serializedMetadata = await fs.readFile(forkMetadataPath, 'utf8');
    const metadata = JSON.parse(serializedMetadata) as ForkMetadata;
    expect(metadata.parentId).toBe('starter');
    expect(metadata.prompt).toBe(promptText);
    expect(['created', 'stopped', 'error']).toContain(metadata.codexSessionStatus ?? 'none');
  } finally {
    await waitForForkSessionStatusToSettle(forkedVersionId);
    await removeGameVersionDirectory(forkedVersionId);
  }
});
