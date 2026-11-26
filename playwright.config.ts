import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  timeout: 60000,
  expect: { timeout: 10000 },
  use: {
    baseURL: process.env.TEST_BASE_URL || 'http://localhost:3000',
    trace: 'retain-on-failure',
    launchOptions: process.env.TEST_BROWSER_PATH
      ? { executablePath: process.env.TEST_BROWSER_PATH }
      : {},
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'mobile',
      use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' },
    },
  ],
  webServer: process.env.TEST_BASE_URL
    ? undefined
    : {
        command: 'npm run start',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
        timeout: 60000,
      },
});
