import { test, expect } from '@playwright/test';
import { waitForPageReady } from './helpers';

test.describe('Homepage', () => {
  test('should load and show welcome message', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Artifact Explorer/);
    await expect(page.getByText('Welcome to Artifact Explorer')).toBeVisible();
  });

  test('should have Connect Registry link', async ({ page }) => {
    await page.goto('/');
    // The CTA is either "Get Started" (no registries) or "View Repository Catalog"
    const cta = page.getByRole('link', { name: /Get Started|View Repository Catalog/ });
    await expect(cta).toBeVisible();
  });

  test('should toggle dark mode', async ({ page }) => {
    await page.goto('/');
    await waitForPageReady(page);
    // Wait for page to fully load
    await expect(page.getByText('Welcome to Artifact Explorer')).toBeVisible();

    const html = page.locator('html');
    // Initially should be light (default) or system preference
    const initialClasses = await html.getAttribute('class');

    // Find and click the theme toggle button
    const themeToggle = page.getByRole('button', { name: /toggle|theme|dark|light|mode/i });
    await expect(themeToggle).toBeVisible();
    await themeToggle.click();

    // The html element's class should change
    const updatedClasses = await html.getAttribute('class');
    expect(updatedClasses).not.toEqual(initialClasses);
  });

  test('should show header with app title', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('header')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Artifact Explorer' })).toBeVisible();
  });

  test('should show footer with version and links', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('footer')).toBeVisible();
    await expect(page.getByRole('link', { name: /Privacy/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /Terms/i })).toBeVisible();
  });
});
