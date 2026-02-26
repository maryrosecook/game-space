import { defineConfig } from '@playwright/test';

const captureVideo = process.env.PLAYWRIGHT_CAPTURE_VIDEO === '1';
const testAdminPasswordHash =
  'scrypt$ASNFZ4mrze8BI0VniavN7w==$M+OVA7qtmUR3CHE87sPzm7h2MpJU1PXNk9qSpl2YPwHyaL8eByBbvuCTXEVTUVc/mwL9EhXgQ14qdOIyRUXu1Q==';
const testAdminSessionSecret = 'session-secret-for-tests-must-be-long';
const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_SERVER === '1' && !process.env.CI;
const e2ePort = 3100;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${e2ePort}`,
    headless: true,
    video: captureVideo ? 'on' : 'off'
  },
  webServer: {
    command: 'npm run build && node dist/server.js',
    env: {
      ...process.env,
      PORT: String(e2ePort),
      GAME_SPACE_ADMIN_PASSWORD_HASH: testAdminPasswordHash,
      GAME_SPACE_ADMIN_SESSION_SECRET: testAdminSessionSecret
    },
    url: `http://127.0.0.1:${e2ePort}`,
    reuseExistingServer,
    timeout: 120_000
  }
});
