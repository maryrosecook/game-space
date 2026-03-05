import { expect, test, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const TEST_ADMIN_PASSWORD = 'correct horse battery staple';
const ONE_BY_ONE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ0QAAAAASUVORK5CYII=';
const IDEAS_PATH = path.resolve('ideas.json');

async function loginAsAdmin(page: Page) {
  await page.goto('/auth');
  await page.locator('#admin-password').fill(TEST_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page.getByText('Admin session is active.')).toBeVisible();
}

async function writeGameFixture(options: {
  id: string;
  createdTime: string;
  favorite?: boolean;
  threeWords?: string;
  includeDist?: boolean;
  includeSnapshot?: boolean;
}): Promise<string> {
  const gamePath = path.resolve('games', options.id);
  const distPath = path.join(gamePath, 'dist');
  const snapshotsPath = path.join(gamePath, 'snapshots');

  await fs.mkdir(gamePath, { recursive: true });
  await fs.writeFile(
    path.join(gamePath, 'metadata.json'),
    `${JSON.stringify(
      {
        id: options.id,
        parentId: 'starter',
        createdTime: options.createdTime,
        ...(typeof options.threeWords === 'string' ? { threeWords: options.threeWords } : {}),
        favorite: options.favorite === true,
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  if (options.includeDist) {
    await fs.mkdir(distPath, { recursive: true });
    await fs.writeFile(
      path.join(distPath, 'game.js'),
      "export function startGame(canvas) { void canvas; }\n",
      'utf8'
    );
  }

  if (options.includeSnapshot) {
    await fs.mkdir(snapshotsPath, { recursive: true });
    await fs.writeFile(path.join(snapshotsPath, 'tile.png'), Buffer.from(ONE_BY_ONE_PNG_BASE64, 'base64'));
  }

  return gamePath;
}

test.describe.configure({ mode: 'serial' });

test('ideas generate defaults to starter base game', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/ideas');

  await expect(page.locator('#ideas-base-game-input')).toHaveValue('starter');

  let requestBody: string | null = null;
  await page.route('**/api/ideas/generate', async (route) => {
    requestBody = route.request().postData() ?? null;
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        prompt: 'starter idea',
        ideas: [
          {
            prompt: 'starter idea',
            hasBeenBuilt: false,
            baseGame: {
              id: 'starter',
              label: 'starter',
              tileSnapshotPath: '/games/starter/snapshots/tile.png'
            }
          }
        ]
      })
    });
  });

  await page.locator('#ideas-generate-button').click();
  await expect.poll(() => requestBody).not.toBeNull();

  const parsedRequest = JSON.parse(requestBody ?? '{}') as { baseGameId?: string };
  expect(parsedRequest.baseGameId).toBe('starter');

  const firstRowChildClasses = await page.locator('.idea-row').first().evaluate((row) =>
    Array.from(row.children).map((child) => child.className)
  );
  expect(firstRowChildClasses[0]).toContain('idea-base-game');
  expect(firstRowChildClasses[1]).toContain('idea-content');
  expect(firstRowChildClasses[2]).toContain('idea-actions');
});

test('ideas page supports starred-game selection with thumbnail options', async ({ page }) => {
  const starredGameId = `ideas-starred-${Date.now()}`;
  const starredGamePath = await writeGameFixture({
    id: starredGameId,
    createdTime: new Date().toISOString(),
    favorite: true,
    threeWords: 'starred-choice-game',
    includeSnapshot: true
  });

  try {
    await loginAsAdmin(page);
    await page.goto('/ideas');

    await page.locator('#ideas-base-game-toggle').click();
    const starredOption = page.locator(`.ideas-base-game-option[data-base-game-id="${starredGameId}"]`);
    await expect(starredOption).toBeVisible();
    await expect(starredOption.locator('.ideas-base-game-option-thumbnail')).toHaveAttribute(
      'src',
      `/games/${starredGameId}/snapshots/tile.png`
    );

    await starredOption.click();

    let requestBody: string | null = null;
    await page.route('**/api/ideas/generate', async (route) => {
      requestBody = route.request().postData() ?? null;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          prompt: 'starred idea',
          ideas: [
            {
              prompt: 'starred idea',
              hasBeenBuilt: false,
              baseGame: {
                id: starredGameId,
                label: 'starred choice game',
                tileSnapshotPath: `/games/${starredGameId}/snapshots/tile.png`
              }
            }
          ]
        })
      });
    });

    await page.locator('#ideas-generate-button').click();
    await expect.poll(() => requestBody).not.toBeNull();

    const parsedRequest = JSON.parse(requestBody ?? '{}') as { baseGameId?: string };
    expect(parsedRequest.baseGameId).toBe(starredGameId);

    await expect(page.locator('.idea-row .idea-base-game-thumbnail').first()).toHaveAttribute(
      'src',
      `/games/${starredGameId}/snapshots/tile.png`
    );
  } finally {
    await fs.rm(starredGamePath, { recursive: true, force: true });
  }
});

test('game-page lightbulb trigger generates ideas in fire-and-forget mode for the current game', async ({ page }) => {
  const generatedGameId = `ideas-trigger-${Date.now()}`;
  const generatedGamePath = await writeGameFixture({
    id: generatedGameId,
    createdTime: new Date().toISOString(),
    includeDist: true,
    includeSnapshot: true
  });

  const originalIdeas = await fs.readFile(IDEAS_PATH, 'utf8').catch(() => null);
  await fs.writeFile(IDEAS_PATH, '[]\n', 'utf8');

  try {
    await loginAsAdmin(page);
    await page.goto(`/game/${generatedGameId}`);

    let requestBody: string | null = null;
    await page.route('**/api/ideas/generate', async (route) => {
      requestBody = route.request().postData() ?? null;
      await fs.writeFile(
        IDEAS_PATH,
        `${JSON.stringify(
          [
            {
              prompt: 'fire and forget idea',
              hasBeenBuilt: false,
              baseGame: {
                id: generatedGameId,
                label: generatedGameId,
                tileSnapshotPath: `/games/${generatedGameId}/snapshots/tile.png`
              }
            }
          ],
          null,
          2
        )}\n`,
        'utf8'
      );

      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'ok' })
      });
    });

    await page.locator('#game-tab-edit').click();
    await page.locator('#game-tab-idea-generate').click();

    await expect.poll(() => requestBody).not.toBeNull();
    const parsedRequest = JSON.parse(requestBody ?? '{}') as { baseGameId?: string };
    expect(parsedRequest.baseGameId).toBe(generatedGameId);

    await page.goto('/ideas');
    await expect(page.getByText('fire and forget idea')).toBeVisible();
    await expect(page.locator('.idea-row .idea-base-game-thumbnail').first()).toHaveAttribute(
      'src',
      `/games/${generatedGameId}/snapshots/tile.png`
    );
  } finally {
    if (typeof originalIdeas === 'string') {
      await fs.writeFile(IDEAS_PATH, originalIdeas, 'utf8');
    } else {
      await fs.rm(IDEAS_PATH, { force: true });
    }
    await fs.rm(generatedGamePath, { recursive: true, force: true });
  }
});


test('ideas page surfaces generation server failures without crashing', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/ideas');

  let requestCount = 0;
  await page.route('**/api/ideas/generate', async (route) => {
    requestCount += 1;
    await route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'claude ideation command failed: spawn claude ENOENT' })
    });
  });

  let dialogMessage: string | null = null;
  page.on('dialog', async (dialog) => {
    dialogMessage = dialog.message();
    await dialog.accept();
  });

  await page.locator('#ideas-generate-button').click();

  await expect.poll(() => requestCount).toBe(1);
  await expect.poll(() => dialogMessage).toBe('claude ideation command failed: spawn claude ENOENT');
  await expect(page.getByText('No ideas yet. Generate one to get started.')).toBeVisible();
});


test('ideas page surfaces codex fallback generation failures without crashing', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/ideas');

  let requestCount = 0;
  await page.route('**/api/ideas/generate', async (route) => {
    requestCount += 1;
    await route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'codex ideation command failed with exit code 1: missing auth' })
    });
  });

  let dialogMessage: string | null = null;
  page.on('dialog', async (dialog) => {
    dialogMessage = dialog.message();
    await dialog.accept();
  });

  await page.locator('#ideas-generate-button').click();

  await expect.poll(() => requestCount).toBe(1);
  await expect.poll(() => dialogMessage).toBe('codex ideation command failed with exit code 1: missing auth');
  await expect(page.getByText('No ideas yet. Generate one to get started.')).toBeVisible();
});
