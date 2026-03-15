import { expect, test, type Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { createForkedGameVersion } from '../../src/services/forkGameVersion';
import { readMetadataFile } from '../../src/services/gameVersions';
import { submitPromptForVersion } from '../../src/services/promptSubmission';
import { createGameFixture } from '../testHelpers';
import { loginAsAdmin } from './helpers/auth';

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
    grid.innerHTML = `<a class="game-tile" href="/game/starter" aria-label="starter" data-version-id="starter" data-tile-color="#1D3557" style="--tile-color: #1D3557;">
      <img class="tile-image" src="${imageDataUrl}" alt="" />
    </a>`;
    shell.appendChild(grid);
  }, ONE_BY_ONE_PNG_DATA_URL);
}

async function waitForTileSnapshotPath(metadataPath: string): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const metadata = await readMetadataFile(metadataPath);
    if (typeof metadata?.tileSnapshotPath === 'string' && metadata.tileSnapshotPath.length > 0) {
      return metadata.tileSnapshotPath;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }

  throw new Error(`Timed out waiting for tile snapshot path in ${metadataPath}`);
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
  const starterDisplayNameSource =
    typeof starterMetadata.threeWords === 'string' && starterMetadata.threeWords.length > 0
      ? starterMetadata.threeWords
      : typeof starterMetadata.id === 'string' && starterMetadata.id.length > 0
        ? starterMetadata.id
        : 'starter';
  const starterDisplayName = starterDisplayNameSource.replaceAll('-', ' ');
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
    await expect(starterTile).toHaveAttribute('aria-label', starterDisplayName);
    await expect(starterTile.locator('.tile-id')).toHaveCount(0);
    await expect(page.getByRole('link', { name: starterDisplayName })).toBeVisible();
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

test('homepage shows the generated tile image after a successful prompt run even without completionDetected', async ({ page }) => {
  const sourceVersionId = `e2e-submit-source-${Date.now()}`;
  const sourceGamePath = path.resolve('games', sourceVersionId);
  await createGameFixture({
    gamesRootPath: path.resolve('games'),
    metadata: {
      id: sourceVersionId,
      threeWords: 'submit source game',
      parentId: null,
      createdTime: new Date().toISOString(),
      favorite: true,
      codexSessionId: null,
      codexSessionStatus: 'none',
    },
  });

  let forkId: string | null = null;
  const loggedErrors: string[] = [];
  try {
    const submitResult = await submitPromptForVersion({
      gamesRootPath: path.resolve('games'),
      buildPromptPath: path.resolve('game-build-prompt.md'),
      codegenProvider: 'codex',
      versionId: sourceVersionId,
      promptInput: 'make it blue',
      codexRunner: {
        run: async () => ({
          sessionId: 'session-123',
          success: true,
          failureMessage: null,
          completionDetected: false,
        }),
      },
      captureTileSnapshot: async (forkDirectoryPath) => {
        const tileSnapshotPath = path.join(forkDirectoryPath, 'snapshots', 'tile.png');
        await fs.mkdir(path.dirname(tileSnapshotPath), { recursive: true });
        await fs.writeFile(tileSnapshotPath, Buffer.from(ONE_BY_ONE_PNG_BASE64, 'base64'));
      },
      logError: (message) => {
        loggedErrors.push(message);
      },
    });
    forkId = submitResult.forkId;

    const tileSnapshotPath = await waitForTileSnapshotPath(
      path.resolve('games', forkId, 'metadata.json'),
    );
    expect(loggedErrors).toEqual([]);

    await loginAsAdmin(page);
    await page.goto('/');

    const forkTile = page.locator(`.game-tile[data-version-id="${forkId}"]`);
    await expect(forkTile).toBeVisible();
    await expect(forkTile.locator('img.tile-image')).toHaveAttribute('src', tileSnapshotPath);
  } finally {
    await fs.rm(sourceGamePath, { recursive: true, force: true });
    if (forkId) {
      await fs.rm(path.resolve('games', forkId), { recursive: true, force: true });
    }
  }
});

test('homepage does not reuse a source game tile snapshot for a newly forked clone', async ({ page }) => {
  const sourceVersionId = `e2e-clone-source-${Date.now()}`;
  const sourceGamePath = path.resolve('games', sourceVersionId);
  const sourceSnapshotDirectoryPath = path.join(sourceGamePath, 'snapshots');
  const sourceSnapshotPath = path.join(sourceSnapshotDirectoryPath, 'tile.png');
  await createGameFixture({
    gamesRootPath: path.resolve('games'),
    metadata: {
      id: sourceVersionId,
      threeWords: 'source tile game',
      parentId: null,
      createdTime: new Date().toISOString(),
      favorite: true,
      tileSnapshotPath: `/games/${sourceVersionId}/snapshots/tile.png?v=source-cache`,
      codexSessionId: null,
      codexSessionStatus: 'none',
    },
  });
  await fs.mkdir(sourceSnapshotDirectoryPath, { recursive: true });
  await fs.writeFile(sourceSnapshotPath, Buffer.from(ONE_BY_ONE_PNG_BASE64, 'base64'));

  let forkId: string | null = null;
  try {
    const forkMetadata = await createForkedGameVersion({
      gamesRootPath: path.resolve('games'),
      sourceVersionId,
      idFactory: () => `e2e-clone-fork-${Date.now()}`,
      now: () => new Date('2026-03-15T00:00:00.000Z'),
    });
    forkId = forkMetadata.id;

    await loginAsAdmin(page);
    await page.goto('/');

    const sourceTile = page.locator(`.game-tile[data-version-id="${sourceVersionId}"]`);
    await expect(sourceTile.locator('.tile-image')).toHaveAttribute(
      'src',
      `/games/${sourceVersionId}/snapshots/tile.png?v=source-cache`,
    );

    const forkTile = page.locator(`.game-tile[data-version-id="${forkId}"]`);
    await expect(forkTile).toBeVisible();
    await expect(forkTile.locator('img.tile-image')).toHaveCount(0);
    await expect(forkTile.locator('.tile-image--placeholder')).toHaveCount(1);
  } finally {
    await fs.rm(sourceGamePath, { recursive: true, force: true });
    if (forkId) {
      await fs.rm(path.resolve('games', forkId), { recursive: true, force: true });
    }
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

test('homepage tiles render image-only cards with accessible names', async ({ page }) => {
  await injectHomepageTile(page);
  const tile = page.locator('.game-tile[data-version-id="starter"]');
  await expect(tile).toBeVisible();
  await expect(tile).toHaveCSS('padding', '0px');
  await expect(tile.locator('.tile-image')).toHaveCSS('position', 'absolute');
  await expect(tile.locator('.tile-id')).toHaveCount(0);
  await expect(tile).toHaveAttribute('aria-label', 'starter');
  await expect(page.getByRole('link', { name: 'starter' })).toBeVisible();

  const mediaCoverage = await tile.evaluate((tileElement) => {
    const image = tileElement.querySelector('.tile-image');
    if (!(image instanceof HTMLElement)) {
      return null;
    }

    const imageRect = image.getBoundingClientRect();
    return {
      tileInnerWidth: tileElement.clientWidth,
      tileInnerHeight: tileElement.clientHeight,
      imageWidth: imageRect.width,
      imageHeight: imageRect.height,
    };
  });

  expect(mediaCoverage).not.toBeNull();
  if (mediaCoverage === null) {
    throw new Error('Expected homepage tile media metrics');
  }

  expect(Math.abs(mediaCoverage.tileInnerWidth - mediaCoverage.imageWidth)).toBeLessThan(1);
  expect(Math.abs(mediaCoverage.tileInnerHeight - mediaCoverage.imageHeight)).toBeLessThan(1);
});
