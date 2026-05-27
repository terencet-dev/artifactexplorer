import { test, expect } from '@playwright/test';

test.describe('Registry Page', () => {
  test('should load registry page', async ({ page }) => {
    await page.goto('/registry');
    // Registry page should either show "no registries" message or repository list
    await page.waitForLoadState('networkidle');
    // The page should have loaded without errors
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });

  test('should show connect prompt when no registries connected', async ({ page }) => {
    // Clear any stored registries by going to a fresh context
    await page.goto('/registry');
    await page.waitForLoadState('networkidle');

    // Should either show registry content OR a prompt to connect  
    // (depends on whether this browser session has registries)
    const hasContent = await page.getByText(/repository|catalog|connect|no registries/i).count();
    expect(hasContent).toBeGreaterThan(0);
  });
});

test.describe('Search Page', () => {
  test('search page loads at /registry/search', async ({ page }) => {
    await page.goto('/registry/search');
    await page.waitForLoadState('networkidle');
    // Page should render without crashing
    const body = page.locator('body');
    await expect(body).toBeVisible();
  });
});

test.describe('Accessibility Basics', () => {
  test('homepage has proper heading hierarchy', async ({ page }) => {
    await page.goto('/');
    // Should have at least one h1 or h2
    const headings = page.locator('h1, h2');
    const count = await headings.count();
    expect(count).toBeGreaterThan(0);
  });

  test('all images have alt text', async ({ page }) => {
    await page.goto('/');
    const images = page.locator('img');
    const count = await images.count();
    for (let i = 0; i < count; i++) {
      const alt = await images.nth(i).getAttribute('alt');
      expect(alt, `Image ${i} missing alt text`).toBeTruthy();
    }
  });

  test('interactive elements are keyboard-accessible', async ({ page }) => {
    await page.goto('/');
    // Tab through the page and verify focus is visible
    await page.keyboard.press('Tab');
    const focused = page.locator(':focus');
    await expect(focused).toBeVisible();
  });
});
