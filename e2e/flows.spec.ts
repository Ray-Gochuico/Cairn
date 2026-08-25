import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectErrors } from './console-guard';

// ESM spec (no __dirname) — derive the fixtures dir from this module's URL.
const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Flow coverage past boot smoke (wave-7 W7): each test drives a real store
 * mutation through the sql.js shim — a scenario-lever write, a CSV import
 * commit batch, and a Monthly confirm-all upsert. Fresh browser context per
 * test ⇒ fresh IndexedDB ⇒ the demo seed re-runs deterministically.
 * Anything Tauri-IPC-only (native dialogs, plugin-http market refresh,
 * notifications) stays off-limits in the shim — none is touched here.
 */

test('what-if: seeded scenario renders; the Loans lever applies an extra payment end-to-end', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/what-if');
  // Scenarios store seeds a Baseline on empty — the page must not be in the
  // "No active scenario" state.
  await expect(page.getByTestId('whatif-projection-chart-wrap')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('whatif-fi-cards-wrap')).toBeVisible();

  await page.getByRole('button', { name: 'Loans' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // First row = seeded Mortgage ($540k @ 6.25%, $4,001/mo — healthy, so the
  // classic preview line renders, not the wave-7 never-pays-off note).
  await dialog.getByLabel(/extra \/ mo/i).first().fill('200');
  await expect(dialog.getByText(/Payoff:/).first()).toBeVisible();
  await dialog.getByRole('button', { name: 'Apply' }).click();

  // The lever persisted through the shim DB: the pill re-renders with its
  // count badge (accessible name stays 'Loans' via aria-label).
  await expect(page.getByRole('button', { name: 'Loans' })).toContainText('Loans · 1');
  expect(errors.join('\n')).not.toContain('Maximum update depth');
});

test('spending: CSV import round-trips — file in, preview commit, transactions on the page', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/spending');
  // Native <input type="file"> (no Tauri dialog in the CSV path) — visible
  // or not, setInputFiles targets it directly.
  await page
    .locator('input[type="file"][aria-label="Transactions PDF or CSV"]')
    .setInputFiles(path.resolve(HERE, 'fixtures', 'transactions.csv'));
  await page.getByRole('button', { name: /^Commit \(2 rows\)$/ }).click();

  // Committed rows land in the Recent-transactions table (cell role scopes
  // away the Top-merchants chart, which renders the same strings in SVG;
  // exact:true scopes away the row's "Edit <merchant>" button cell).
  await expect(page.getByRole('cell', { name: 'Blue Bottle Coffee', exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('cell', { name: 'Trader Joes', exact: true })).toBeVisible();
  expect(errors.join('\n')).not.toContain('Maximum update depth');
});

test('monthly check-in: Confirm all ratifies the seeded last-month values', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/monthly');
  // The Wave-A seed's derived confirm cards: Taxable Brokerage, Roth IRA,
  // 401(k) (Demo Investor) + Partner Brokerage (Demo Partner) = 4. The
  // cash/savings accounts are MANUAL_BALANCE_TYPES and create no derived card.
  const confirmAll = page.getByRole('button', { name: /^Confirm all \(4\)$/ });
  await expect(confirmAll).toBeVisible({ timeout: 30_000 });
  await confirmAll.click();
  // The section's pre-mounted live region announces the batch result.
  await expect(page.getByText('Confirmed 4 account values.')).toBeVisible({ timeout: 30_000 });
  // Pending set is empty → the batch button unmounts.
  await expect(page.getByRole('button', { name: /^Confirm all/ })).toHaveCount(0);
  expect(errors.join('\n')).not.toContain('Maximum update depth');
});

test('monthly check-in: a scoped Confirm all never ratifies hidden persons’ snapshots', async ({ page }) => {
  const errors = collectErrors(page);
  // Wave-A seed: 3 derived cards owned by Demo Investor (p1), 1 by Demo Partner (p2).
  await page.goto('/monthly?view=p1');
  const confirmP1 = page.getByRole('button', { name: /^Confirm all \(3\)$/ });
  await expect(confirmP1).toBeVisible({ timeout: 30_000 });
  await confirmP1.click();
  await expect(page.getByText('Confirmed 3 account values.')).toBeVisible({ timeout: 30_000 });
  // The partner's pending snapshot MUST survive the scoped batch. Switch the
  // view via the SPA dropdown: the shim persists to IndexedDB on a debounced
  // (250ms) flush, so an immediate goto() can race the flush, load a DB
  // without the writes, and re-seed — the SPA switch stays in the same
  // in-memory DB session.
  await page.getByRole('combobox', { name: 'Filter view by person' }).selectOption('household');
  await expect(page.getByRole('button', { name: /^Confirm all \(1\)$/ })).toBeVisible({ timeout: 30_000 });
  expect(errors.join('\n')).not.toContain('Maximum update depth');
});

test('calculators: the page scope honors ?view= — scoped FI figures + caption, flip via the bar control', async ({ page }) => {
  const errors = collectErrors(page);
  // Cold deep-link in P2 scope (Demo Partner). FI-eligible P2 portfolio =
  // Partner Brokerage 118,000 + Partner Savings 22,000; Joint Checking (8,000)
  // is excluded and declared.
  await page.goto('/calculators?view=p2');
  // exact:true — the Backtest card's "Backtest your portfolio" trigger name
  // also substring-matches 'Portfolio'.
  const portfolio = page.getByLabel('Portfolio', { exact: true });
  await expect(portfolio).toHaveValue('140000', { timeout: 30_000 });
  await expect(
    page.getByText("from Demo Partner's account snapshots — joint accounts not included"),
  ).toBeVisible();
  // 0051: Demo Partner's durable baseline (2600, seeded) replaces the even
  // split, with the upgraded provenance:
  await expect(page.getByLabel('Monthly expenses')).toHaveValue('2600');
  await expect(page.getByText("from Demo Partner's Inputs")).toBeVisible();
  // The FI waymark re-scopes (its meaning names the person):
  await expect(page.getByTestId('path-to-fi-meaning')).toContainText('Demo Partner');
  // Open the card: the exclusions caption carries the counted joint total.
  await page.getByTestId('path-to-fi-trigger').click();
  await expect(page.getByTestId('path-to-fi-scope-exclusions')).toContainText('joint accounts ($8,000)');
  // The header copy is deduped on the grid; the BAR control flips the scope.
  // Demo Investor's baseline stays NULL, so P1 scope keeps the labeled even
  // split of the $6,000 household baseline (CB4 unchanged — 0051 receipt):
  await expect(page.getByRole('combobox', { name: 'Filter view by person' })).toHaveCount(0);
  await page
    .getByRole('group', { name: 'Calculator scope' })
    .getByRole('button', { name: 'Demo Investor' })
    .click();
  await expect(page.getByLabel('Monthly expenses')).toHaveValue('3000');
  await expect(page.getByText('half your household baseline — even split')).toBeVisible();
  await page
    .getByRole('group', { name: 'Calculator scope' })
    .getByRole('button', { name: 'Household' })
    .click();
  await expect(portfolio).toHaveValue('935000');
  expect(errors.join('\n')).not.toContain('Maximum update depth');
});

test('setup honesty: saved data renders cards not gates; abandonment surfaces the briefing resume row', async ({ page }) => {
  const errors = collectErrors(page);
  // Finished-user re-entry repro (OB-Q1): the seed has persons/accounts but NO
  // wizard progress key — exactly the post-Finish wiped state. The seeded
  // disclosure acceptance bypasses Step 0.
  await page.goto('/setup');
  // The worded flow is the /setup default now; this pin covers the FORM view.
  await page.getByRole('button', { name: 'Switch to form view' }).click();
  await expect(page.getByTestId('person-chips')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('person-chips')).toContainText('Demo Investor');
  await expect(page.getByRole('button', { name: 'Start this section' })).toHaveCount(0);
  // C3: sections with saved data but no completion carry the neutral marker.
  await expect(page.getByText('has saved data').first()).toBeVisible();

  // Abandonment (OB-Q2): persist a half-done run, then land on the Dashboard —
  // the shipped "Continue setup" row must finally fire (C4).
  await page.evaluate(() => {
    localStorage.setItem(
      'setupWizard.progress.v1',
      JSON.stringify({
        currentSection: 3,
        sectionStatus: { 1: 'completed', 2: 'completed', 3: 'pending', 4: 'pending' },
        startedAt: new Date().toISOString(),
      }),
    );
    localStorage.removeItem('setupWizard.dismissed.v1');
  });
  // A fresh profile's root visit inside the new-month grace window
  // auto-routes to /monthly?from=new-month at bootstrap (main.tsx), so the
  // briefing never renders on a hard '/' load. Reach the Dashboard through
  // the app's own sidebar — a client-side navigation that skips bootstrap —
  // which is also the path a real user takes from the monthly nudge.
  await page.goto('/');
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.getByText('Suggested next step: finish setting up.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('link', { name: 'Continue setup' })).toBeVisible();
  expect(errors.join('\n')).not.toContain('Maximum update depth');
});

test('re-entrant finish with Tailor done lands on the Dashboard, not /welcome', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    localStorage.setItem('onboarding.tailor.done.v1', new Date().toISOString());
  });
  await page.goto('/setup?section=4');            // ?section= always opens the form view
  await page.getByRole('button', { name: /finish setup/i }).click();
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /you're set up/i })).toHaveCount(0);
});

test('roadmap interview: the $X bar answers with three framework cards on the seeded profile', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/roadmap');
  // Gate 1 — the roadmap disclosure (seed accepts only app_wide):
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Open Roadmap' }).click();
  // The hero phrase is intact and the bar sits below it:
  await expect(page.getByText('Suggested next step').first()).toBeVisible({ timeout: 30_000 });
  // Submit $10,000 one-time. Scoped to the bar region: since T3 the strip's
  // college card carries its own 'Amount' input on the seeded profile.
  await page.getByRole('region', { name: "What's next question bar" })
    .getByLabel('Amount').fill('10000');
  await page.getByRole('button', { name: 'Show me' }).click();
  // Gate 2 — the interview disclosure, first submission only:
  await expect(page.getByText('About the Frameworks')).toBeVisible();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Continue' }).click();
  // Three cards with the seed-derived split (hand-computed pins):
  const conservative = page.getByTestId('framework-conservative');
  await expect(conservative).toContainText('Emergency fund — to 6× expenses');
  await expect(conservative).toContainText('$6,000');
  await expect(conservative).toContainText('$4,000'); // mid-rate remainder → Mortgage
  await expect(conservative).toContainText('up from 5.0'); // 30,000/6,000 → 36,000/6,000
  const moderate = page.getByTestId('framework-moderate');
  await expect(moderate).toContainText('$2,000'); // 50/50 of the $4,000 remainder
  const aggressive = page.getByTestId('framework-aggressive');
  await expect(aggressive).toContainText('$10,000'); // 3× covered → all invest
  await aggressive.getByText('What this assumes').click();
  await expect(aggressive).toContainText('Debt between 5–8% stays at minimum payments in this framework.');
  // Fixed footer on every card:
  await expect(page.getByText('One mechanical framework applied to your numbers — not advice, not a recommendation.')).toHaveCount(3);
  expect(errors.join('\n')).not.toContain('Maximum update depth');
});

test('investments at the 1024×700 window floor: no horizontal body pan', async ({ page }) => {
  // Wave A item 5b (D-WA9): permanent ratchet — CSS grid items default to
  // min-width:auto, so a donut card's min-content width can force `main`
  // wider than the viewport at the 1024px floor.
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.goto('/investments');
  // Settle: the compact donut row and the wide card are both painted.
  await expect(page.getByText('Allocation & positions')).toBeVisible();
  await expect(page.getByText('Per-company exposure', { exact: false }).first()).toBeVisible();
  const overflow = await page.evaluate(() => {
    const main = document.getElementById('main')!;
    return {
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      main: main.scrollWidth - main.clientWidth,
    };
  });
  expect(overflow.doc).toBe(0);
  expect(overflow.main).toBe(0);
  // Review m2: the page-level assertion alone is vacuous for the min-w-0
  // class (it passed pre-fix in this seed). Structural ratchet: every
  // compact-grid item wrapper must compute min-width 0px — a min-w-0 revert
  // goes RED here regardless of what the seed data happens to render.
  const wrapperMinWidths = await page.evaluate(() =>
    [...document.querySelectorAll('#main [class*="lg:grid-cols-3"] > div')].map(
      (el) => getComputedStyle(el).minWidth,
    ),
  );
  expect(wrapperMinWidths.length).toBeGreaterThan(0); // never vacuously green
  for (const mw of wrapperMinWidths) expect(mw).toBe('0px');
});

test('roadmap interview: home-purchase — hidden for the owner, asks once the home is removed, plans, and tracks a goal', async ({ page }) => {
  const errors = collectErrors(page);
  // 1 — Owner state: the seed owns 'Demo Home' (PRIMARY_RESIDENCE) → the
  //     house question must NOT surface (D-HP1 receipt).
  await page.goto('/roadmap');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Open Roadmap' }).click();
  await expect(page.getByText('Suggested next step').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Are there plans to buy a home?')).toHaveCount(0);
  // 2 — Remove the property (test-local mutation: fresh context ⇒ fresh
  //     IndexedDB). Verified against Property.tsx at execution: the editor
  //     opens via the card's 'Edit details for Demo Home' button (clicking
  //     the name text opens nothing); 'Delete property' lives in that
  //     drawer; the confirm dialog's destructive button defaults 'Delete'.
  //     Navigation is CLIENT-SIDE (sidebar links, the setup-honesty test's
  //     idiom): the sql.js shim debounces IndexedDB persistence 250ms after
  //     each write, so a hard page.goto right after a write races the flush
  //     and can reload a pre-write DB (acceptance + delete both lost).
  //     SPA navigation keeps the in-memory DB — no race, and it is the
  //     path a real user takes.
  await page.getByRole('link', { name: 'Property' }).click();
  await page.getByRole('button', { name: 'Edit details for Demo Home' }).click();
  await page.getByRole('button', { name: 'Delete property' }).click();
  await page.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Demo Home')).toHaveCount(0); // the delete landed
  // 3 — Back on /roadmap (no re-gate — acceptance held in-store): the ask.
  await page.getByRole('link', { name: 'Roadmap' }).click();
  await expect(page.getByText('Are there plans to buy a home?')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Within 5 years' }).click();
  // 4 — The compound target: $60,000 by June two years out (run-date-relative).
  const card = page.getByTestId('thread-home_purchase-');
  const year = String(new Date().getFullYear() + 2);
  await card.getByLabel('Amount').fill('60000');   // scoped: the bar has its own 'Amount'
  await card.getByLabel('Month').selectOption('06');
  await card.getByLabel('Year').selectOption(year);
  await card.getByRole('button', { name: 'Save' }).click();
  // 5 — The plan reply (monthly figures vary with run date → pattern pins;
  //     the reserve is a seed literal → exact).
  await expect(card).toContainText('Cash and savings on hand: $30,000');
  await expect(card).toContainText(new RegExp(`reaches \\$60,000 by June ${year}`));
  await expect(card).toContainText('The target is your number, not a suggestion.');
  // 6 — CTA → a real DOWN_PAYMENT goal; the tracked state reads back from
  //     the reloaded goals store (proves the write landed).
  await card.getByRole('button', { name: 'Track this as a Goal' }).click();
  await expect(card).toContainText('Tracked as a Goal — Home down payment.');
  expect(errors.join('\n')).not.toContain('Maximum update depth');
});

test('roadmap interview: college vs. retirement reaches its two-sided card on the seeded profile', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/roadmap');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Open Roadmap' }).click();
  // Dependent + 529 seeded → the strip asks the monthly amount (q_target_year skipped):
  const card = page.getByTestId('thread-college_vs_retirement-');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText('About how much goes toward college savings each month?');
  await card.getByLabel('Amount').fill('300');
  await card.getByRole('button', { name: 'Save' }).click();
  // The two-sided card. Structure pins only — target and FV move with the run
  // date (today → months-to-2034 shrinks monthly); 'May 2034' is time-stable.
  await expect(card).toContainText('College for Demo Kid');
  await expect(card).toContainText('starting May 2034');
  await expect(card).toContainText("in today's dollars");
  await expect(card).toContainText('moderate scenario, inflation-adjusted');
  await expect(card).toContainText('These dollars count toward exactly one side.');
  await expect(card).toContainText('No state deduction encoded for CA.');
  await expect(card).toContainText('Published 2025-26 prices — verify with the school.');
  await expect(card).toContainText(/years sooner to your FI target|retirement side/);
  // Ask me again clears back to the question (kernel machinery, no re-gate):
  await card.getByRole('button', { name: /Ask me again/ }).click();
  await expect(card).toContainText('About how much goes toward college savings each month?');
  expect(errors.join('\n')).not.toContain('Maximum update depth');
});
