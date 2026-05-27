import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Artifact Explorer e2e tests.
 *
 * By default tests run against http://localhost:3000.
 * Override with:  BASE_URL=https://your-deployment.example.com npx playwright test
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 2,
  reporter: [['html', { open: 'never' }], ['list']],

  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* No webServer block — tests run against the deployed site by default.
     To test locally, start the dev server yourself and pass BASE_URL. */
});
