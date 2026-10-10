import { defineConfig, devices } from '@playwright/test';

/**
 * Browser end-to-end tests. They run against the dev servers (API on :4000 with sandbox
 * integrations and sample data, web on :5173). On Windows/macOS the locally installed
 * Microsoft Edge is used, so no browser download is needed (set PW_CHANNEL to override).
 *
 *   npm run dev:api & npm run dev:web
 *   npx playwright test            (from apps/web)
 */
const channel = process.env.PW_CHANNEL ?? 'msedge';
const BLR = { latitude: 12.9716, longitude: 77.5946 };

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    channel,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    geolocation: BLR,
    permissions: ['geolocation'],
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Edge'], channel, viewport: { width: 1366, height: 860 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, channel } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
