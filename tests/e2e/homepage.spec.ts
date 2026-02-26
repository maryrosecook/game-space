import { expect, test } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ONE_BY_ONE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ0QAAAAASUVORK5CYII=';

test.describe.configure({ mode: 'serial' });

test('homepage renders game index shell', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Fountain');
  await expect(page.getByRole('heading', { level: 1, name: 'Fountain' })).toBeVisible();
});

test('homepage does not render removed legacy game tiles', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.game-tile[data-version-id="v1-bounce"]')).toHaveCount(0);
  await expect(
    page.locator('.game-tile[data-version-id="d0cf7658-3371-4f01-99e2-ca90fc1899cf"]'),
  ).toHaveCount(0);
});

test('homepage renders 9:16 tile snapshots when available', async ({ page }) => {
  const snapshotDirectoryPath = path.resolve('games/starter/snapshots');
  const snapshotPath = path.join(snapshotDirectoryPath, 'tile.png');
  const starterMetadataPath = path.resolve('games/starter/metadata.json');
  const starterMetadataRaw = await fs.readFile(starterMetadataPath, 'utf8');
  const starterMetadata = JSON.parse(starterMetadataRaw) as Record<string, unknown>;
  await fs.mkdir(snapshotDirectoryPath, { recursive: true });
  await fs.writeFile(snapshotPath, Buffer.from(ONE_BY_ONE_PNG_BASE64, 'base64'));
  await fs.writeFile(
    starterMetadataPath,
    JSON.stringify({ ...starterMetadata, favorite: true }, null, 2) + '\n',
  );

  try {
    await page.goto('/');
    const starterTile = page.locator('.game-tile[data-version-id="starter"]');
    await expect(starterTile).toBeVisible();
    await expect(starterTile).toHaveCSS('aspect-ratio', '9 / 16');
    await expect(starterTile.locator('.tile-image')).toHaveAttribute('src', '/games/starter/snapshots/tile.png');
  } finally {
    await fs.writeFile(starterMetadataPath, starterMetadataRaw);
    await fs.rm(snapshotPath, { force: true });
  }
});

test('homepage shows tile image for a game that just finished generating', async ({ page }) => {
  const generatedVersionId = `e2e-gen-${Date.now()}`;
  const generatedGamePath = path.resolve('games', generatedVersionId);
  const generatedSnapshotDirectoryPath = path.join(generatedGamePath, 'snapshots');
  const generatedSnapshotPath = path.join(generatedSnapshotDirectoryPath, 'tile.png');
  const generatedMetadataPath = path.join(generatedGamePath, 'metadata.json');

  await fs.mkdir(generatedSnapshotDirectoryPath, { recursive: true });
  await fs.writeFile(generatedSnapshotPath, Buffer.from(ONE_BY_ONE_PNG_BASE64, 'base64'));
  await fs.writeFile(
    generatedMetadataPath,
    JSON.stringify(
      {
        id: generatedVersionId,
        threeWords: 'fresh tile game',
        parentId: 'starter',
        createdTime: new Date().toISOString(),
        favorite: true,
        codexSessionId: 'e2e-session-id',
        codexSessionStatus: 'stopped',
      },
      null,
      2,
    ) + '\n',
  );

  try {
    await page.goto('/');
    const generatedTile = page.locator(`.game-tile[data-version-id="${generatedVersionId}"]`);
    await expect(generatedTile).toBeVisible();
    await expect(generatedTile.locator('.tile-image')).toHaveAttribute(
      'src',
      `/games/${generatedVersionId}/snapshots/tile.png`,
    );
  } finally {
    await fs.rm(generatedGamePath, { recursive: true, force: true });
  }
});
