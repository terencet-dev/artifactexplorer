import { Page } from '@playwright/test';

/**
 * Wait for the page to be fully loaded and ready for interaction.
 */
export async function waitForPageReady(page: Page): Promise<void> {
  await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: 10000 });
}
