import { test, expect } from '@playwright/test';
import { waitForPageReady } from './helpers';

test.describe('Navigation Routing', () => {
  test('privacy page loads', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.getByRole('heading', { name: /Privacy Policy/i })).toBeVisible();
    await expect(page.getByText(/Information We Collect/i)).toBeVisible();
  });

  test('terms page loads', async ({ page }) => {
    await page.goto('/terms');
    await expect(page.getByRole('heading', { name: /Terms of Use/i })).toBeVisible();
    await expect(page.getByText(/Acceptance of Terms/i)).toBeVisible();
  });

  test('→ connect navigation works', async ({ page }) => {
    await page.goto('/connect');
    await expect(page.getByRole('heading', { name: /Registry Authentication/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Authenticated/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Anonymous/i })).toBeVisible();
  });

  test('→ connect-noauth navigation', async ({ page }) => {
    await page.goto('/connect/noauth');
    await expect(page.getByRole('heading', { name: /Connect to Anonymous Registry/i })).toBeVisible();
  });

  test('→ connect-auth navigation', async ({ page }) => {
    await page.goto('/connect/auth');
    await expect(page.getByRole('heading', { name: /Connect to Authenticated Registry|Connect to Registry/i })).toBeVisible();
  });

  test('header logo link navigates to homepage', async ({ page }) => {
    await page.goto('/privacy');
    await waitForPageReady(page);
    await expect(page.getByRole('heading', { name: /Privacy Policy/i })).toBeVisible();
    await page.getByRole('link', { name: 'Artifact Explorer' }).click();
    await expect(page).toHaveURL('/');
    await expect(page.getByText('Welcome to Artifact Explorer')).toBeVisible();
  });

  test('privacy page back link navigates to homepage', async ({ page }) => {
    await page.goto('/privacy');
    await waitForPageReady(page);
    await expect(page.getByRole('heading', { name: /Privacy Policy/i })).toBeVisible({ timeout: 10000 });
    await page.getByRole('link', { name: /Back to Home/i }).click({ timeout: 10000 });
    await expect(page).toHaveURL('/');
  });

  test('terms page back link navigates to homepage', async ({ page }) => {
    await page.goto('/terms');
    await waitForPageReady(page);
    await expect(page.getByRole('heading', { name: /Terms of Use/i })).toBeVisible({ timeout: 10000 });
    await page.getByRole('link', { name: /Back to Home/i }).click({ timeout: 10000 });
    await expect(page).toHaveURL('/');
  });
});
