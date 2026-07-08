import { test, expect } from '@playwright/test';
import { collectErrors } from './console-guard';

test('boot completes into the app shell; dashboard renders with a clean console', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/');
  // Seeded demo data accepts disclosures + creates persons, so boot must NOT
  // bounce to /setup or the disclaimer gate. It may legitimately land on
  // /monthly instead of the dashboard: the shim's DB is fresh per page load,
  // so within the first 7 days of any month the designed new-month ritual
  // redirect fires (main.tsx maybeRedirectToMonthly, grace day 7). The
  // date-INDEPENDENT boot landmark is PageShell's primary nav…
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible({ timeout: 30_000 });
  // …and an in-app navigation then reaches the dashboard deterministically
  // (SPA navigation does not re-run the boot seam). The pill grid is the
  // dashboard's stable landmark (src/pages/Dashboard.tsx data-testid).
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.getByTestId('dashboard-pill-grid')).toBeVisible({ timeout: 30_000 });
  expect(errors.join('\n')).not.toContain('Maximum update depth');
  expect(errors).toEqual([]);
});

test('net-worth page renders the asset-value chart hero with a currency value', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/net-worth');
  const headerValue = page.getByTestId('asset-chart-header-value');
  await expect(headerValue).toBeVisible({ timeout: 30_000 });
  // Seeded accounts guarantee a real dollar figure, not an empty state.
  await expect(headerValue).toContainText('$');
  expect(errors.join('\n')).not.toContain('Maximum update depth');
});
