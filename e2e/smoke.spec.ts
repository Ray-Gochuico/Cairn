import { test, expect, type Page } from '@playwright/test';

/**
 * Console-error collector. Hard smoke contract:
 *   - zero page crashes (pageerror),
 *   - zero console.error output on a clean boot — most specifically the
 *     "Maximum update depth exceeded" render-loop class (shared-store gate
 *     boot-loop gotcha) that only reproduces in a real browser.
 * KNOWN_NOISE is the escape hatch for environment-structural chatter; extend
 * it with a comment per entry, never wholesale.
 */
const KNOWN_NOISE: RegExp[] = [
  // The browser shim has no Rust HTTP proxy, so the boot market refresh's
  // Yahoo chart fetches are CORS-blocked by the browser (Yahoo sends no
  // Access-Control-Allow-Origin — the very reason the desktop app routes
  // these through plugin-http/Rust; see src/market/yahoo-client.ts docs).
  // Structural to the shim environment, impossible in the packaged app;
  // the refresh degrades to store error state. Matched against
  // "<message> <resource url>" so the bare "Failed to load resource:
  // net::ERR_FAILED" lines for the same requests are covered WITHOUT a
  // broad ERR_FAILED allowance.
  /query[12]\.finance\.yahoo\.com/,
];

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // Resource-load failures carry the URL in location, not in the text.
    const withUrl = `${text} ${msg.location().url ?? ''}`;
    if (KNOWN_NOISE.some((re) => re.test(withUrl))) return;
    errors.push(text);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

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
