import { expect, test, type Page } from '@playwright/test';

import { loginAsAdmin } from './helpers/auth';

type NextOwnedPageExpectation = {
  page: Page;
  path: string;
  reactRootSelector: string;
  forbiddenScriptPaths: string[];
};

async function expectNextOwnedReactPage(expectation: NextOwnedPageExpectation): Promise<void> {
  const { page, path, reactRootSelector, forbiddenScriptPaths } = expectation;
  const response = await page.goto(path);
  expect(response?.status()).toBe(200);
  expect(response?.headers()['x-powered-by']).toBe('Next.js');

  await expect(page.locator(reactRootSelector)).toHaveCount(1);
  for (const forbiddenScriptPath of forbiddenScriptPaths) {
    await expect(page.locator(`script[src="${forbiddenScriptPath}"]`)).toHaveCount(0);
  }

  const nextRuntimeScriptCount = await page.locator('script[src^="/_next/"]').count();
  expect(nextRuntimeScriptCount).toBeGreaterThan(0);
}

test('phase4 cutover routes render through Next without legacy /public hydration script tags', async ({
  page,
}) => {
  await expectNextOwnedReactPage({
    page,
    path: '/game/starter',
    reactRootSelector: '#game-react-root',
    forbiddenScriptPaths: ['/public/react/game.js', '/public/game-view.js', '/public/game-live-reload.js'],
  });

  await loginAsAdmin(page);

  await expectNextOwnedReactPage({
    page,
    path: '/codex',
    reactRootSelector: '#codex-react-root',
    forbiddenScriptPaths: ['/public/react/codex.js'],
  });

  await expectNextOwnedReactPage({
    page,
    path: '/ideas',
    reactRootSelector: '#ideas-react-root',
    forbiddenScriptPaths: ['/public/react/ideas.js'],
  });
});

test('phase4 cutover keeps admin page auth gates and /games denylist behavior', async ({ page }) => {
  const publicCodexResponse = await page.goto('/codex');
  expect(publicCodexResponse?.status()).toBe(404);
  await expect(page.getByText(/could not be found/i)).toBeVisible();

  const publicIdeasResponse = await page.goto('/ideas');
  expect(publicIdeasResponse?.status()).toBe(404);
  await expect(page.getByText(/could not be found/i)).toBeVisible();

  const runtimeBundleResponse = await page.request.get('/games/starter/dist/game.js');
  expect(runtimeBundleResponse.status()).toBe(200);

  const blockedMetadataResponse = await page.request.get('/games/starter/metadata.json');
  expect(blockedMetadataResponse.status()).toBe(404);

  const publicStylesResponse = await page.request.get('/public/styles.css');
  expect(publicStylesResponse.status()).toBe(200);
  expect(publicStylesResponse.headers()['content-type']?.includes('text/css')).toBe(true);

  const legacyCodexClientResponse = await page.request.get('/public/codex-view.js');
  expect(legacyCodexClientResponse.status()).toBe(404);

  const legacyIdeasClientResponse = await page.request.get('/public/ideas-view.js');
  expect(legacyIdeasClientResponse.status()).toBe(404);

  const legacyGameViewClientResponse = await page.request.get('/public/game-view.js');
  expect(legacyGameViewClientResponse.status()).toBe(404);

  const legacyGameLiveReloadClientResponse = await page.request.get('/public/game-live-reload.js');
  expect(legacyGameLiveReloadClientResponse.status()).toBe(404);

  const legacyTranscriptPresenterClientResponse = await page.request.get(
    '/public/codex-transcript-presenter.js',
  );
  expect(legacyTranscriptPresenterClientResponse.status()).toBe(404);

  const legacyAuthHydrationResponse = await page.request.get('/public/react/auth.js');
  expect(legacyAuthHydrationResponse.status()).toBe(404);

  const legacyHomepageHydrationResponse = await page.request.get('/public/react/homepage.js');
  expect(legacyHomepageHydrationResponse.status()).toBe(404);

  const legacyGameHydrationResponse = await page.request.get('/public/react/game.js');
  expect(legacyGameHydrationResponse.status()).toBe(404);

  const legacyCodexHydrationResponse = await page.request.get('/public/react/codex.js');
  expect(legacyCodexHydrationResponse.status()).toBe(404);

  const legacyIdeasHydrationResponse = await page.request.get('/public/react/ideas.js');
  expect(legacyIdeasHydrationResponse.status()).toBe(404);

  const faviconResponse = await page.request.get('/favicon.ico');
  expect(faviconResponse.status()).toBe(204);
});
