import { defineConfig } from '@playwright/test';

const captureVideo = process.env.PLAYWRIGHT_CAPTURE_VIDEO === '1';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    headless: true,
    video: captureVideo ? 'on' : 'off'
  },
  webServer: {
    command: 'npm run build && node dist/server.js',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
