import { defineConfig, devices } from '@playwright/test';

const APP_PORT = 4300;
const API_PORT = 4400;

/**
 * End-to-end tests run against the PRODUCTION build (`npm run build`), served the way a static host would,
 * plus a mock API (e2e/support/mock-api.mjs). Browsers other than Chromium are opt-in:
 *   npx playwright install firefox webkit      (WebKit also needs system libraries: npx playwright install-deps)
 *   npm run e2e -- --project=firefox
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 1000 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 1000 } } },
  ],
  webServer: [
    {
      command: 'node e2e/support/mock-api.mjs',
      port: API_PORT,
      reuseExistingServer: !process.env['CI'],
    },
    {
      command: 'npm run build && node e2e/support/static-server.mjs',
      port: APP_PORT,
      timeout: 240_000,
      reuseExistingServer: !process.env['CI'],
    },
  ],
});
