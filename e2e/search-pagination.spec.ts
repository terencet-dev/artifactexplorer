import { test, expect } from '@playwright/test';

/**
 * Regression test for: "searching the catalog, then moving to the next page,
 * resets the search" (reported against mcr.microsoft.com with a query like
 * `oss/v2/`).
 *
 * Root cause was a competing effect that recomputed the displayed repositories
 * on every page change WITHOUT re-applying the active search query, so page 2+
 * showed the full, unfiltered catalog. The fix makes the displayed list a pure
 * derivation of (catalog, search, view-mode, page), so the filter is retained
 * across pagination.
 *
 * This test seeds an anonymous Microsoft Container Registry connection in
 * localStorage and loads the catalog directly. It requires network access to
 * mcr.microsoft.com. The query `azure` is used because MCR's `azure` namespace
 * is large enough to span more than one page (pageSize = 20).
 */

// The original report used `oss/v2/`. Any substring that matches >20 repos in
// MCR's catalog reproduces the bug identically; `azure` is plentiful and stable.
const QUERY = 'azure';

// Selector for the repository-name headings inside repository cards.
// RepositoryCard renders <a href="/registry/..."><h3 title="<repo name>">.
const REPO_NAME_HEADINGS = 'a[href^="/registry/"] h3[title]';

async function visibleRepoNames(page: import('@playwright/test').Page): Promise<string[]> {
  return page
    .locator(REPO_NAME_HEADINGS)
    .evaluateAll((els) => els.map((e) => (e.getAttribute('title') || '').toLowerCase()));
}

test.describe('Repository search persists across pagination (regression)', () => {
  test('next page keeps the active search filter', async ({ page }) => {
    // 1. Seed an anonymous MCR connection directly and go straight to the
    //    catalog, bypassing the connect form (a separate, hydration-flaky
    //    surface). A fresh `session-last-active` timestamp is required, otherwise
    //    SessionManager treats it as a new/expired session, clears the seeded
    //    registry, and redirects home.
    await page.addInitScript(() => {
      localStorage.setItem('session-last-active', String(Date.now()));
      localStorage.setItem(
        'registries',
        JSON.stringify([{ type: 'anonymous', server: 'mcr.microsoft.com', id: 'mcr.microsoft.com' }]),
      );
      localStorage.setItem('current-registry-id', 'mcr.microsoft.com');
    });
    await page.goto('/registry');

    // 2. Wait for the catalog to FULLY load and settle before searching. This
    //    matters: a competing effect re-derives the list on any catalog change,
    //    so searching mid-load gets clobbered. The real bug only shows once the
    //    list is settled and you then paginate. Wait for network idle and for
    //    the pagination footer (proves the full catalog loaded into >1 page).
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(/Page 1 of \d+/)).toBeVisible({ timeout: 30000 });

    // Pressing Enter submits the search immediately (SearchBox's form submit
    // bypasses the 300ms debounce).
    const search = page.getByLabel('Search input');
    await expect(search).toBeVisible({ timeout: 30000 });
    await search.fill(QUERY);
    await search.press('Enter');

    // 3. Wait for the filter to actually take effect: poll until every visible
    //    repository name matches the query (and there is at least one result).
    await expect
      .poll(
        async () => {
          const names = await visibleRepoNames(page);
          return names.length > 0 && names.every((n) => n.includes(QUERY));
        },
        { timeout: 20000, message: `search "${QUERY}" never applied to page 1` },
      )
      .toBe(true);

    // 4. The filtered result set must span more than one page for this test to
    //    be meaningful — the Next button only renders when totalPages > 1.
    const nextButton = page.getByLabel('Next page');
    await expect(nextButton, `filtered query "${QUERY}" should yield more than one page on MCR`).toBeVisible({
      timeout: 20000,
    });
    await expect(nextButton).toBeEnabled();

    // 4b. Page 1: every displayed repository name must contain the query.
    const page1Names = await visibleRepoNames(page);
    expect(page1Names.length).toBeGreaterThan(0);
    for (const name of page1Names) {
      expect(name, `page 1 repo "${name}" should match search "${QUERY}"`).toContain(QUERY);
    }

    // 5. Move to the next page.
    await nextButton.click();
    await expect(page.getByText(/Page 2 of/i)).toBeVisible({ timeout: 15000 });

    // 6. THE REGRESSION CHECK: page 2 must STILL be filtered by the query.
    //    On the buggy code, page 2 reverted to the full unfiltered catalog and
    //    these names would NOT all contain the query.
    const page2Names = await visibleRepoNames(page);
    expect(page2Names.length).toBeGreaterThan(0);
    for (const name of page2Names) {
      expect(name, `page 2 repo "${name}" should still match search "${QUERY}"`).toContain(QUERY);
    }

    // 7. And the filtered list must not collapse into a false empty state.
    await expect(page.getByText('No repositories found')).toHaveCount(0);
  });
});
