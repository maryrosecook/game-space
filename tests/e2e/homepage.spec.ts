import { expect, test, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const ONE_BY_ONE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQ0QAAAAASUVORK5CYII=';
const ONE_BY_ONE_PNG_DATA_URL = `data:image/png;base64,${ONE_BY_ONE_PNG_BASE64}`;

async function injectHomepageTile(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate((imageDataUrl: string) => {
    const shell = document.querySelector('.homepage-shell');
    if (!(shell instanceof HTMLElement)) {
      return;
    }

    shell.querySelector('.game-grid')?.remove();
    shell.querySelector('.empty-state')?.remove();

    const grid = document.createElement('div');
    grid.className = 'game-grid';
    grid.setAttribute('role', 'list');
    grid.innerHTML = `<a class="game-tile" href="/game/starter" data-version-id="starter" data-tile-color="#1D3557" style="--tile-color: #1D3557;">
      <img class="tile-image" src="${imageDataUrl}" alt="starter" />
      <span class="tile-id">starter</span>
    </a>`;
    shell.appendChild(grid);
  }, ONE_BY_ONE_PNG_DATA_URL);
}

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

test('homepage keeps at least three tile columns when only one tile is shown', async ({ page }) => {
  await injectHomepageTile(page);
  const gridLayout = await page.locator('.game-grid').evaluate((element) => {
    const templateColumns = getComputedStyle(element).gridTemplateColumns.trim();
    const columnCount = templateColumns.length === 0 ? 0 : templateColumns.split(/\s+/).length;
    const firstTile = element.querySelector('.game-tile');
    const gridWidth = element.getBoundingClientRect().width;
    const firstTileWidth = firstTile?.getBoundingClientRect().width ?? 0;
    return {
      columnCount,
      gridWidth,
      firstTileWidth,
    };
  });

  expect(gridLayout.columnCount).toBeGreaterThanOrEqual(3);
  expect(gridLayout.firstTileWidth).toBeGreaterThan(0);
  expect(gridLayout.firstTileWidth).toBeLessThan(gridLayout.gridWidth / 2);
});

test('homepage tiles render edge-to-edge media with overlaid labels', async ({ page }) => {
  await injectHomepageTile(page);
  const tile = page.locator('.game-tile[data-version-id="starter"]');
  await expect(tile).toBeVisible();
  await expect(tile).toHaveCSS('padding', '0px');
  await expect(tile.locator('.tile-image')).toHaveCSS('position', 'absolute');
  await expect(tile.locator('.tile-id')).toHaveCSS('position', 'absolute');

  const mediaCoverage = await tile.evaluate((tileElement) => {
    const image = tileElement.querySelector('.tile-image');
    const label = tileElement.querySelector('.tile-id');
    if (!(image instanceof HTMLElement) || !(label instanceof HTMLElement)) {
      return null;
    }

    const imageRect = image.getBoundingClientRect();
    const labelRect = label.getBoundingClientRect();
    return {
      tileInnerWidth: tileElement.clientWidth,
      tileInnerHeight: tileElement.clientHeight,
      imageWidth: imageRect.width,
      imageHeight: imageRect.height,
      labelWithinTile:
        labelRect.top >= imageRect.top - 0.5 && labelRect.bottom <= imageRect.bottom + 0.5,
    };
  });

  expect(mediaCoverage).not.toBeNull();
  if (mediaCoverage === null) {
    throw new Error('Expected homepage tile media metrics');
  }

  expect(Math.abs(mediaCoverage.tileInnerWidth - mediaCoverage.imageWidth)).toBeLessThan(1);
  expect(Math.abs(mediaCoverage.tileInnerHeight - mediaCoverage.imageHeight)).toBeLessThan(1);
  expect(mediaCoverage.labelWithinTile).toBe(true);
});
