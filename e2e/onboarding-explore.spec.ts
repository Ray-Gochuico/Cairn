import { test, expect, type Page } from '@playwright/test';
import { collectErrors } from './console-guard';

/**
 * W4 — Explore with sample data (fresh :1423 server, empty IndexedDB).
 *
 * The filename lands this file in the `onboarding` project
 * (testMatch: /onboarding[^/]*\.spec\.ts/), which is the ONLY server whose
 * IndexedDB is unseeded — the precondition for a first-run Step 0
 * (P-W4-8; the spec's `sample-explore.spec.ts` name would have run against
 * the seeded :1422 server, where Step 0 never renders).
 *
 * Scenario 2's persons-count-0 proof is the boot redirect itself:
 * shouldRedirectToSetup fires ONLY at personCount === 0 && !dismissed && '/',
 * so landing on /setup after exit IS the real-DB-empty proof (P-W4-9).
 */

/**
 * The REAL device-local keys D-S7 promises explore never writes. Note that
 * setupWizard.progress.v2 is ALREADY present at Step 0 — the wizard starts its
 * own first-run record the moment it mounts, before any explore click — so the
 * guarantee is "unchanged across the session", not "absent".
 */
async function deviceKeys(page: Page) {
  return page.evaluate(() => ({
    dismissed: localStorage.getItem('setupWizard.dismissed.v1'),
    progressV1: localStorage.getItem('setupWizard.progress.v1'),
    progressV2: localStorage.getItem('setupWizard.progress.v2'),
    tailor: localStorage.getItem('onboarding.tailor.done.v1'),
    tour: localStorage.getItem('onboarding.tour.done.v1'),
  }));
}

async function enterExplore(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 30_000 }); // Step 0
  const explore = page.getByRole('button', { name: 'Explore with sample data first' });
  await expect(explore).toBeDisabled(); // gated on the attestation
  await page.getByRole('checkbox').check();
  await explore.click();
  await expect(page.getByRole('note', { name: 'Sample data notice' })).toBeVisible({
    timeout: 30_000,
  });
}

test('enter: one click from Step 0 lands on a labeled, fully-populated sample', async ({ page }) => {
  const errors = collectErrors(page);
  await enterExplore(page);
  const banner = page.getByRole('note', { name: 'Sample data notice' });
  await expect(banner).toContainText('Sample data — nothing here is yours.');
  await expect(banner).toContainText("changes here aren't saved");
  await expect(page).toHaveTitle(/ — Sample$/);
  // Sample values render across surfaces. Hard gotos are DELIBERATE and safe
  // here: with the flag set every boot rebuilds the pristine sample (D-S2),
  // there are no pending writes to lose, and gotos are immune to sidebar
  // label drift. (Only scenario 3 relies on the rebuild side effect.)
  await page.goto('/investments');
  await expect(page.getByText('Taxable Brokerage').first()).toBeVisible({ timeout: 30_000 });
  await page.goto('/roadmap');
  // The roadmap disclosure gates INSIDE explore (accepted into the throwaway
  // DB) — the same landmark e2e/flows.spec.ts pins for this surface.
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Open Roadmap' }).click();
  await expect(page.getByText('Suggested next step').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('note', { name: 'Sample data notice' })).toBeVisible();
  await page.goto('/monthly');
  await expect(page.getByRole('button', { name: /^Confirm all \(4\)$/ })).toBeVisible({
    timeout: 30_000,
  });
  // The W4 coverage slice: Spending and Goals are no longer empty rooms.
  // "Recent transactions" shows the latest 10 by date, so pin a merchant the
  // seed always places in the CURRENT month (the loan rows sit on the 1st and
  // fall outside that window).
  await page.goto('/spending');
  await expect(
    page.getByRole('cell', { name: 'Green Basket Market', exact: true }).first(),
  ).toBeVisible({ timeout: 30_000 });
  await page.goto('/goals');
  await expect(page.getByText('Emergency fund').first()).toBeVisible({ timeout: 30_000 });
  // One seeded dollar pin (fixed narrative value, run-date-independent) —
  // regex, so $540,000 vs $540,000.00 formatting both match:
  await page.goto('/loans');
  await expect(page.getByText(/\$540,000/).first()).toBeVisible({ timeout: 30_000 });
  expect(errors).toEqual([]);
});

test('exit: a truly clean first-run — wizard at FlowShell, sample record gone, no stray keys', async ({ page }) => {
  const errors = collectErrors(page);
  // Entry is inlined here (not via enterExplore) so the real device-local keys
  // can be snapshotted at Step 0, BEFORE the explore click.
  await page.goto('/');
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 30_000 });
  const explore = page.getByRole('button', { name: 'Explore with sample data first' });
  await expect(explore).toBeDisabled();
  await page.getByRole('checkbox').check();
  const before = await deviceKeys(page);
  expect(before.dismissed).toBeNull();
  expect(before.progressV1).toBeNull();
  expect(before.tailor).toBeNull();
  expect(before.tour).toBeNull();
  await explore.click();
  await expect(page.getByRole('note', { name: 'Sample data notice' })).toBeVisible({
    timeout: 30_000,
  });
  // THE D-S7 proof: a whole explore session wrote NOTHING to the real
  // device-local keys — they are byte-identical to the pre-entry snapshot.
  await page.goto('/investments');
  await page.goto('/settings');
  await page.goto('/');
  await expect(page.getByRole('note', { name: 'Sample data notice' })).toBeVisible({
    timeout: 30_000,
  });
  expect(await deviceKeys(page)).toEqual(before);

  await page
    .getByRole('note', { name: 'Sample data notice' })
    .getByRole('button', { name: 'Start my real setup' })
    .click();
  // Full navigation → real boot → personCount 0 → /setup, with NO Step-0
  // dialog (the app_wide acceptance persisted on the real DB).
  await expect(page).toHaveURL(/\/setup/, { timeout: 30_000 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // FlowShell landmark — the worded wizard's first screen, the same pin
  // e2e/onboarding-worded.spec.ts uses.
  await expect(page.getByRole('heading', { name: 'About you — step 1 of 5' })).toBeVisible({
    timeout: 30_000,
  });
  // Wipe proofs — IDB record + device-local keys:
  const state = await page.evaluate(async () => {
    const keys = await new Promise<unknown[]>((resolve, reject) => {
      const open = indexedDB.open('finance-app-shim', 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('sqlite', 'readonly');
        const req = tx.objectStore('sqlite').getAllKeys();
        req.onsuccess = () => {
          db.close();
          resolve(req.result as unknown[]);
        };
        req.onerror = () => {
          db.close();
          reject(req.error);
        };
      };
    });
    return {
      idbKeys: keys,
      flag: localStorage.getItem('explore.sampleMode.v1'),
      dismissed: localStorage.getItem('setupWizard.dismissed.v1'),
      progressV1: localStorage.getItem('setupWizard.progress.v1'),
      progressV2: localStorage.getItem('setupWizard.progress.v2'),
      tailor: localStorage.getItem('onboarding.tailor.done.v1'),
      tour: localStorage.getItem('onboarding.tour.done.v1'),
    };
  });
  expect(state.idbKeys).not.toContain('sample-explore.db');
  expect(state.flag).toBeNull();
  expect(state.dismissed).toBeNull();
  expect(state.progressV1).toBeNull();
  expect(state.tailor).toBeNull();
  expect(state.tour).toBeNull();
  // progress.v2 is NOT expected to be absent here: the worded wizard we just
  // landed on writes its own record on mount. What must hold is that it is a
  // PRISTINE first-run record — nothing carried over from the sample session.
  const progress = JSON.parse(state.progressV2 ?? '{}') as {
    origin?: string;
    view?: string;
    statuses?: Record<string, unknown>;
    bindings?: Record<string, unknown>;
  };
  expect(progress.origin).toBe('first-run');
  expect(progress.view).toBe('worded');
  expect(progress.statuses).toEqual({});
  expect(progress.bindings).toEqual({});
  expect(errors).toEqual([]);
});

test('relaunch mid-explore: edits are gone, the pristine sample and the banner return', async ({ page }) => {
  const errors = collectErrors(page);
  await enterExplore(page);
  // Mutate the sample through the UI: rename the Roth IRA.
  await page.goto('/investments?manage=accounts');
  await expect(page.getByRole('note', { name: 'Sample data notice' })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Edit Roth IRA' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Renamed IRA');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Renamed IRA').first()).toBeVisible({ timeout: 30_000 });
  // "Relaunch": a hard load with the flag still set → boot wipes + rebuilds.
  await page.goto('/');
  await expect(page.getByRole('note', { name: 'Sample data notice' })).toBeVisible({
    timeout: 30_000,
  });
  await page.goto('/investments?manage=accounts');
  await expect(page.getByText('Roth IRA').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Renamed IRA')).toHaveCount(0); // deterministic reset (D-S2)
  expect(errors).toEqual([]);
});
