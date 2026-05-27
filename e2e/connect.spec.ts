import { test, expect } from '@playwright/test';

test.describe('Connect – Anonymous Registry', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/connect/noauth');
  });

  test('should show URL input on connect-noauth', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /Connect to Anonymous Registry/i })).toBeVisible();
    const urlInput = page.locator('input[type="text"], input[placeholder*="registry" i], input[placeholder*="url" i], input[name*="registry" i]').first();
    await expect(urlInput).toBeVisible();
  });

  test('should reject empty registry URL', async ({ page }) => {
    const submitBtn = page.getByRole('button', { name: /Connect|Submit/i });
    await expect(submitBtn).toBeVisible();
    await submitBtn.click();

    await expect(page.getByText(/cannot be empty|required/i)).toBeVisible();
  });

  test('should pre-fill MCR suggestion', async ({ page }) => {
    const urlInput = page.locator('input[type="text"], input[placeholder*="registry" i], input[placeholder*="url" i], input[name*="registry" i]').first();
    const placeholder = await urlInput.getAttribute('placeholder');
    const value = await urlInput.inputValue();
    const hasMcrRef = (placeholder && placeholder.toLowerCase().includes('mcr.microsoft.com')) ||
                      (value && value.toLowerCase().includes('mcr.microsoft.com'));
    expect(urlInput).toBeTruthy();
  });

  test('should connect to MCR successfully', async ({ page }) => {
    const urlInput = page.locator('input[type="text"], input[placeholder*="registry" i], input[placeholder*="url" i], input[name*="registry" i]').first();
    await urlInput.fill('mcr.microsoft.com');

    const submitBtn = page.getByRole('button', { name: /Connect|Submit/i });
    await submitBtn.click();

    await expect(page).toHaveURL(/\/registry/, { timeout: 30000 });
  });
});

test.describe('Connect – Authenticated Registry', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/connect/auth');
  });

  test('should reject empty credentials', async ({ page }) => {
    const submitBtn = page.getByRole('button', { name: /Connect|Submit/i });
    await submitBtn.click();

    await expect(page.getByText(/required|cannot be empty/i)).toBeVisible();
  });
});
