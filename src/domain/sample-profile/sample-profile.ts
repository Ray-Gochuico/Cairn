import type { Database } from '@/db/db';
import { DISCLOSURES } from '@/legal/disclosures';
import { lastBusinessDayOfMonth } from '@/lib/business-days';
import { localTodayISO } from '@/lib/dates';
import { lastMonthYyyymm } from '@/lib/input-pending';

/**
 * The SHIPPED sample profile (W4 D-S6) — the household the "Explore with
 * sample data" tour walks through, and the same graph the dev browser smoke
 * uses. ONE module, two consumers:
 *
 *   1. The explore boot branch (`src/db/init.ts`, unguarded) — builds this
 *      profile into the throwaway `sqlite:sample-explore.db` on every boot
 *      while the explore flag is set. The real DB is never opened there.
 *   2. The dev `VITE_SEED_DEMO` browser-smoke path (`src/db/init.ts`, still
 *      triple-guarded on `import.meta.env.DEV && VITE_BROWSER_SHIM === '1' &&
 *      VITE_SEED_DEMO === '1'`). Those are statically-replaced Vite env
 *      reads, so that call site still dead-code-eliminates from the Tauri
 *      prod build.
 *
 * Because consumer 1 ships, EVERY future change to the values, names and
 * merchant strings below is PRODUCT COPY (D-S6) and is reviewed at the same
 * bar as UI copy: plausible values, calm names, no jokes.
 *
 * Writes a small household graph via raw SQL (the same write surface as seed
 * migrations) so it does NOT depend on Yahoo/network (CORS-blocked in browser
 * mode) and does NOT reconstruct heavy Zod repo inputs. The KEY rows are the
 * per-account `account_snapshots`: every value-/concentration-derived donut
 * (Assets, Per-company, Sector) reads holding value by distributing the latest
 * snapshot total across an account's holdings, so without snapshots the donuts
 * render empty even with holdings present. `fund_holdings` + `fund_sectors`
 * are seeded so fund look-through is exercised (else funds show as "opaque").
 *
 * Idempotent: each slice early-returns if its sentinel row already exists
 * (Avery Sample for the primary slice, Jordan Sample for the partner slice,
 * empty-table sentinels for the equity/spending/goal slices), and uses
 * INSERT OR IGNORE / OR REPLACE / pre-DELETE everywhere, so re-running
 * against a persisted IndexedDB DB is a no-op. The explore boot rebuilds
 * from scratch every time, so the sentinels matter only for the dev path.
 *
 * Tickers (VTI, FXAIX, AAPL, MSFT, NVDA, BND) are already seeded by migrations
 * 0006/0038; this module only UPDATEs their sector/industry columns (step 8)
 * — it never inserts ticker rows.
 */

export const SAMPLE_PROFILE = {
  personName: 'Avery Sample',
  partnerName: 'Jordan Sample',
  dependentName: 'Riley Sample',
  accountCount: 7, // 3 original + Partner Brokerage + Partner Savings + Joint Checking + 529 College Fund (T3)
  loanCount: 2,
  // Imported from the disclosure registry rather than hardcoded so a future
  // app_wide version bump can't leave the seeded acceptance stale (which would
  // re-gate the smoke behind AppDisclaimerGate).
  appWideVersion: DISCLOSURES.app_wide.version,
} as const;

/**
 * Names the seed shipped under before W4's rename — sentinel-only, so
 * already-seeded dev profiles converge instead of double-seeding (persons
 * 2→4, accounts 7→13). Never rendered; never inserted. Wave-A D13 precedent.
 */
const LEGACY_SENTINEL_NAMES = {
  person: 'Demo Investor',
  partner: 'Demo Partner',
  dependent: 'Demo Kid',
} as const;

// LOCAL calendar day, NOT toISOString (UTC): the app's as-of pipelines run on
// useLocalToday(), so a UTC-dated "today" snapshot is invisible (it sits in
// the local future) every evening west of UTC — which silently emptied the
// briefing's net-worth row in evening e2e runs (caught in Wave A Task 2).
const TODAY = (): string => localTodayISO();

/** First of the month `n` months before the reference ISO day, in UTC.
 * Wave 11 T20: loan first-payment dates derive from the seed reference day so
 * the seeded loans don't get more seasoned every real-world day. */
const firstOfMonthMonthsAgo = (iso: string, n: number): string => {
  const [y, m] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return d.toISOString().slice(0, 10);
};

export async function seedSampleProfile(
  db: Database,
  opts?: { todayISO?: string },
): Promise<void> {
  const today = opts?.todayISO ?? TODAY();
  // Independent idempotency sentinels (Wave A D13): the primary slice keeps
  // its Avery Sample sentinel for its own rows only, and the partner slice
  // runs behind its own Jordan Sample sentinel — so both fresh DBs and dev
  // DBs seeded before Wave A converge to the same two-person household
  // without re-running (or duplicating) the primary slice. Each sentinel
  // accepts the LEGACY name too (W4 P-W4-2), so a dev profile seeded before
  // the rename converges instead of double-seeding.
  const primaryExists = await personPresent(
    db,
    SAMPLE_PROFILE.personName,
    LEGACY_SENTINEL_NAMES.person,
  );
  if (!primaryExists) {
    await seedPrimarySlice(db, today);
  }
  const partnerExists = await personPresent(
    db,
    SAMPLE_PROFILE.partnerName,
    LEGACY_SENTINEL_NAMES.partner,
  );
  if (!partnerExists) {
    await seedPartnerSlice(db, today);
  }
  // Wave B: per-person RSU grants so the Equity card's exact person scope is
  // observable. Guarded on the grants table being empty so existing dev DBs
  // converge without duplicating.
  const grantRows = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM equity_grants');
  if ((grantRows[0]?.n ?? 0) === 0) {
    await seedEquityGrantsSlice(db, today);
  }
  // Wave T3: dependent + 529 so the college_vs_retirement thread is smokable.
  // Guarded on its own row so pre-T3 dev DBs converge without duplicating.
  const kidRows = await db.select<{ n: number }>(
    'SELECT COUNT(*) AS n FROM dependents WHERE name IN (?, ?)',
    [SAMPLE_PROFILE.dependentName, LEGACY_SENTINEL_NAMES.dependent],
  );
  if ((kidRows[0]?.n ?? 0) === 0) {
    await seedCollegeSlice(db, today);
  }
  // W4: spending + goal coverage — Spending, Budget, and Goals stop being
  // empty rooms on the sample tour. Each behind its own empty-table sentinel
  // (the equity-slice pattern): user-imported rows block the slice, so stale
  // dev DBs converge without duplication.
  const txnRows = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM transactions');
  if ((txnRows[0]?.n ?? 0) === 0) {
    await seedSpendingSlice(db, today);
  }
  const goalRows = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM goals');
  if ((goalRows[0]?.n ?? 0) === 0) {
    await seedGoalSlice(db, today);
  }
}

/** True when the household already carries this person under EITHER the
 * current name or the pre-W4 legacy name (P-W4-2 convergence). */
async function personPresent(db: Database, current: string, legacy: string): Promise<boolean> {
  const r = await db.select<{ n: number }>(
    'SELECT COUNT(*) AS n FROM persons WHERE name IN (?, ?)',
    [current, legacy],
  );
  return (r[0]?.n ?? 0) > 0;
}

async function seedPrimarySlice(db: Database, today: string): Promise<void> {
  // 1. Household singleton (id = 1). OR IGNORE: a real household may already
  //    exist; we don't clobber it — the donuts only need accounts/snapshots.
  await db.execute(
    `INSERT OR IGNORE INTO household (id, name, filing_status, state, city, monthly_expense_baseline)
     VALUES (1, 'Sample Household', 'MFJ', 'CA', 'San Francisco', 6000)`,
  );
  // Round-3 M2 fallout: the 0001 migration inserts the household singleton
  // (baseline 0) BEFORE this seed runs, so the OR IGNORE above never lands
  // and the demo household kept a $0 expense baseline — which the What-If
  // page now honestly reports as a missing input instead of rendering
  // $0-target FI cards. Fill in the intended demo baseline, but only over
  // the migration default — never clobber a user-set value.
  await db.execute(
    `UPDATE household SET monthly_expense_baseline = 6000
     WHERE id = 1 AND monthly_expense_baseline = 0`,
  );
  // W4 smoke D2: the SAME fallout hit the name (SE-N4). 0001 omits the name
  // column ⇒ NULL, so the INSERT's 'Sample Household' never landed and the
  // sample tour showed an EMPTY "Household name (optional)" on Inputs →
  // Household. Same shape as the baseline backfill: migration default only
  // (NULL), never over a name someone typed.
  await db.execute(
    `UPDATE household SET name = 'Sample Household' WHERE id = 1 AND name IS NULL`,
  );

  // 2. Person. Only NOT-NULL/no-default columns are named; ALTER-added
  //    columns (commission, employment) carry table DEFAULTs.
  const personRes = await db.execute(
    `INSERT INTO persons (household_id, name, date_of_birth, target_retirement_age, annual_salary_pretax, pretax_401k_pct)
     VALUES (1, ?, '1988-04-12', 60, 180000, 0.1)`,
    [SAMPLE_PROFILE.personName],
  );
  const personId = personRes.lastInsertId!;

  // 3. Accounts. `type` is free-text TEXT NOT NULL (enum AccountType values).
  async function addAccount(name: string, type: string, institution: string): Promise<number> {
    const r = await db.execute(
      `INSERT INTO accounts (household_id, owner_person_id, name, institution, type)
       VALUES (1, ?, ?, ?, ?)`,
      [personId, name, institution, type],
    );
    return r.lastInsertId!;
  }
  const brokerageId = await addAccount('Taxable Brokerage', 'ACCOUNT_BROKERAGE', 'Fidelity');
  const rothId = await addAccount('Roth IRA', 'ACCOUNT_ROTH_IRA', 'Vanguard');
  const k401Id = await addAccount('401(k)', 'ACCOUNT_401K', 'Fidelity');

  // 4. Holdings. Mix of funds (VTI, FXAIX → exercise look-through) and single
  //    names (AAPL, MSFT, NVDA, BND). share_count drives the value split.
  //    Cost bases feed the Positions table's Total gain/loss column (D-PT8);
  //    BND deliberately basis-less — the demo needs one honest "—" gain cell.
  async function addHolding(
    accountId: number,
    ticker: string,
    shareCount: number,
    costBasis: number | null = null,
  ): Promise<void> {
    await db.execute(
      `INSERT INTO holdings (account_id, ticker, share_count, cost_basis) VALUES (?, ?, ?, ?)`,
      [accountId, ticker, shareCount, costBasis],
    );
  }
  await addHolding(brokerageId, 'VTI', 120, 24_000); // US total market fund (look-through)
  await addHolding(brokerageId, 'AAPL', 40, 5_200);
  await addHolding(brokerageId, 'NVDA', 15, 1_300);
  await addHolding(rothId, 'FXAIX', 200, 26_500); // S&P 500 index fund (look-through)
  await addHolding(rothId, 'MSFT', 25, 8_100);
  await addHolding(k401Id, 'FXAIX', 350, 46_000);
  await addHolding(k401Id, 'BND', 180); // bond fund — basis left null → Total gain/loss "—"

  // 5. account_snapshots — THE critical rows. Two per account: dated today
  //    (drives every latest-value donut) and dated LAST MONTH'S CLOSE
  //    (wave-7 W7: the Monthly check-in's Section 1 only shows confirm
  //    cards for accounts with an AUTO_DERIVED snapshot at
  //    lastBusinessDayOfMonth(last month) — today-only snapshots left the
  //    demo/e2e Monthly window with nothing to confirm). Last-month values
  //    sit slightly below today's so the month reads as growth.
  async function addSnapshot(accountId: number, snapshotDate: string, totalValue: number): Promise<void> {
    await db.execute(
      `INSERT OR REPLACE INTO account_snapshots (account_id, snapshot_date, total_value, source)
       VALUES (?, ?, ?, 'AUTO_DERIVED')`,
      [accountId, snapshotDate, totalValue],
    );
  }
  const lastMonthClose = lastBusinessDayOfMonth(lastMonthYyyymm(new Date()));
  await addSnapshot(brokerageId, today, 285000);
  await addSnapshot(rothId, today, 92000);
  await addSnapshot(k401Id, today, 410000);
  await addSnapshot(brokerageId, lastMonthClose, 277500);
  await addSnapshot(rothId, lastMonthClose, 89500);
  await addSnapshot(k401Id, lastMonthClose, 402000);

  // 6. Loans — LiabilitiesDonut needs current_balance > 0.
  async function addLoan(
    name: string,
    type: string,
    original: number,
    balance: number,
    rate: number,
    termMonths: number,
    monthly: number,
    firstPaymentDate: string,
  ): Promise<void> {
    await db.execute(
      `INSERT INTO loans (household_id, name, type, original_amount, current_balance, interest_rate, term_months, first_payment_date, monthly_payment, extra_payment_default)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [name, type, original, balance, rate, termMonths, firstPaymentDate, monthly],
    );
  }
  // Mortgage: 4.5y into a 30y note (visibly seasoned). Car: 18mo into 60.
  await addLoan('Mortgage', 'MORTGAGE', 650000, 540000, 0.0625, 360, 4001, firstOfMonthMonthsAgo(today, 54));
  await addLoan('Car Loan', 'AUTO', 42000, 22000, 0.049, 60, 791, firstOfMonthMonthsAgo(today, 18));

  // 7. fund_holdings — top underlyings per fund (weights sum < 1; concentration
  //    attributes the remainder to a shared 'Misc' wedge). holding_name powers
  //    the Per-company legend/tooltip.
  async function seedFundHoldings(
    fundTicker: string,
    rows: { holdingTicker: string; weight: number; name: string }[],
  ): Promise<void> {
    await db.execute('DELETE FROM fund_holdings WHERE fund_ticker = ?', [fundTicker]);
    for (const r of rows) {
      await db.execute(
        `INSERT INTO fund_holdings (fund_ticker, holding_ticker, weight, as_of_date, holding_name)
         VALUES (?, ?, ?, ?, ?)`,
        [fundTicker, r.holdingTicker, r.weight, today, r.name],
      );
    }
  }
  const topUS = [
    { holdingTicker: 'AAPL', weight: 0.07, name: 'Apple Inc' },
    { holdingTicker: 'MSFT', weight: 0.065, name: 'Microsoft Corp' },
    { holdingTicker: 'NVDA', weight: 0.06, name: 'NVIDIA Corp' },
    { holdingTicker: 'AMZN', weight: 0.035, name: 'Amazon.com Inc' },
    { holdingTicker: 'GOOGL', weight: 0.03, name: 'Alphabet Inc Class A' },
  ];
  await seedFundHoldings('VTI', topUS);
  await seedFundHoldings('FXAIX', topUS);

  // 8. fund_sectors — sector weights per fund (must sum to ~1 for a clean
  //    sector donut; small remainder is fine).
  async function seedFundSectors(
    fundTicker: string,
    rows: { sector: string; weight: number }[],
  ): Promise<void> {
    await db.execute('DELETE FROM fund_sectors WHERE fund_ticker = ?', [fundTicker]);
    for (const r of rows) {
      await db.execute(
        `INSERT INTO fund_sectors (fund_ticker, sector, weight, as_of_date)
         VALUES (?, ?, ?, ?)`,
        [fundTicker, r.sector, r.weight, today],
      );
    }
  }
  const usSectors = [
    { sector: 'Technology', weight: 0.3 },
    { sector: 'Financial Services', weight: 0.13 },
    { sector: 'Healthcare', weight: 0.12 },
    { sector: 'Consumer Cyclical', weight: 0.11 },
    { sector: 'Communication Services', weight: 0.09 },
    { sector: 'Industrials', weight: 0.08 },
    { sector: 'Consumer Defensive', weight: 0.06 },
    { sector: 'Energy', weight: 0.05 },
    { sector: 'Real Estate', weight: 0.03 },
    { sector: 'Utilities', weight: 0.03 },
  ];
  await seedFundSectors('VTI', usSectors);
  await seedFundSectors('FXAIX', usSectors);

  // 8b. Sector/industry for the directly-held single names (wave-7 W3). The
  //    ticker-seed migrations (0006/0038) predate the sector columns (0016),
  //    so AAPL/MSFT/NVDA sit at sector NULL and the Sector donut buckets
  //    them as 'Unclassified' in demo mode (no network → the runtime Yahoo
  //    enrichment path never fills them). Mirror what ticker-enrichment.ts
  //    would write, using the exact Title-Case vocabulary
  //    snakeToTitleSector() produces so single-name wedges merge with the
  //    fund-distributed wedges. BND stays sector-NULL on purpose:
  //    assetClassToPseudoSector maps US_BONDS → 'Fixed Income', which is
  //    already the wedge a bond fund should land in.
  const SAMPLE_TICKER_PROFILES: ReadonlyArray<readonly [string, string, string]> = [
    ['AAPL', 'Technology', 'Consumer Electronics'],
    ['MSFT', 'Technology', 'Software—Infrastructure'],
    ['NVDA', 'Technology', 'Semiconductors'],
  ];
  for (const [ticker, sector, industry] of SAMPLE_TICKER_PROFILES) {
    await db.execute(`UPDATE tickers SET sector = ?, industry = ? WHERE ticker = ?`, [
      sector,
      industry,
      ticker,
    ]);
  }

  // 8c. Positions-table demo data (2026-08-09 wave, D-PT8). LOCAL writes only —
  //    no Yahoo; the two-user-controlled-network-calls guarantee is untouched.
  //      price_cache: TWO recent consecutive dates per priced ticker so
  //        "Since last refresh" is a real delta; MSFT gets NO rows (dash row
  //        + the excludes-1 account-total suffix).
  //      tickers.fifty_two_week_*: seeded for the fund trio only — AAPL/NVDA
  //        stay NULL so the fetched-fields "—" state demos honestly (a real
  //        refresh fills them via updateTicker52WeekAndDayChange).
  const round2 = (n: number): number => Math.round(n * 100) / 100;
  const priceBase: Record<string, number> = { VTI: 240, FXAIX: 155, BND: 72, AAPL: 205, NVDA: 118 };
  async function addPrice(ticker: string, daysAgo: number, price: number): Promise<void> {
    const date = new Date(Date.parse(`${today}T00:00:00Z`) - daysAgo * 86_400_000)
      .toISOString().slice(0, 10);
    await db.execute(
      `INSERT OR REPLACE INTO price_cache (ticker, date, price, fetched_at) VALUES (?, ?, ?, ?)`,
      [ticker, date, round2(price), `${date} 20:00:00`],
    );
  }
  for (const ticker of ['VTI', 'FXAIX', 'BND', 'AAPL', 'NVDA'] as const) {
    const base = priceBase[ticker];
    await addPrice(ticker, 2, base * 0.98);   // penultimate cached date
    await addPrice(ticker, 1, base * 0.995);  // latest → a real since-refresh delta
  }
  const week52: Record<string, [number, number]> = {
    VTI: [206.4, 246.6],
    FXAIX: [133.2, 159.1],
    BND: [66.5, 74.9],
  };
  for (const [ticker, [lo, hi]] of Object.entries(week52)) {
    await db.execute(
      'UPDATE tickers SET fifty_two_week_low = ?, fifty_two_week_high = ? WHERE ticker = ?',
      [lo, hi, ticker],
    );
  }
  //      tickers.regular_market_*: day-change facts (Wave B, 0055) for the
  //        fund trio only — AAPL/NVDA stay NULL so the "Day change —" state
  //        demos honestly (a real refresh fills them via
  //        updateTicker52WeekAndDayChange). Values chosen so previous_close
  //        + change equals the seeded LATEST cached price (base × 0.995) at
  //        2 decimals — the coherence a real refresh produces — while
  //        deliberately DIFFERING from the since-refresh delta (latest −
  //        penultimate), so the demo teaches the two columns apart.
  const dayChange: Record<string, [number, number]> = {
    VTI: [1.2, 237.6],     // 237.60 + 1.20 ≈ 238.80 · brokerage 120 sh → +$144.00 (+0.5%)
    FXAIX: [-0.57, 154.8], // 154.80 − 0.57 ≈ 154.23 · Roth 200 sh → −$114.00 · 401k 350 sh → −$199.50 (−0.4%)
    BND: [0.12, 71.52],    // 71.52 + 0.12 ≈ 71.64 · 401k 180 sh → +$21.60 (+0.2%)
  };
  for (const [ticker, [chg, prev]] of Object.entries(dayChange)) {
    await db.execute(
      'UPDATE tickers SET regular_market_change = ?, regular_market_previous_close = ? WHERE ticker = ?',
      [chg, prev, ticker],
    );
  }

  // 9. Disclosure acceptance so AppDisclaimerGate doesn't block the smoke.
  await db.execute(
    `INSERT OR IGNORE INTO disclosure_acceptances (household_id, document_id, version, accepted_at)
     VALUES (1, 'app_wide', ?, ?)`,
    [SAMPLE_PROFILE.appWideVersion, new Date().toISOString()],
  );
}

/**
 * Wave A: second person + joint items so the ?view= filter is exercisable
 * in the browser shim (useViewFilter requires persons.length === 2).
 * Independently sentineled on partnerName so dev DBs seeded before Wave A
 * converge without re-running (or duplicating) the primary slice.
 * Ownership map this creates:
 *   P1 (Avery Sample): Taxable Brokerage, Roth IRA, 401(k) [existing], Car Loan (obligor UPDATE)
 *   P2 (Jordan Sample):  Partner Brokerage (derived-snapshot confirm card), Partner Savings (cash card), Partner Car
 *   Joint (owner NULL): Joint Checking, Mortgage (already NULL), Sample Home
 * Monthly Section-1 consequence: derived confirm cards go 3 → 4 (the e2e
 * Confirm-all pin moves in the same commit).
 */
async function seedPartnerSlice(db: Database, today: string): Promise<void> {
  const person = await db.select<{ id: number }>(
    'SELECT id FROM persons WHERE name = ?', [SAMPLE_PROFILE.personName],
  );
  const primaryId = person[0]?.id;

  // 0051: the partner carries a durable per-person expense baseline so the
  // scoped bar's "from Jordan Sample's Inputs" provenance is smokable; the
  // primary person stays NULL so the labeled even-split path shows too.
  // 2600 ≠ 3000 (half the 6000 household baseline) so the upgrade is visible.
  const partnerRes = await db.execute(
    `INSERT INTO persons (household_id, name, date_of_birth, target_retirement_age, annual_salary_pretax, pretax_401k_pct, monthly_expense_baseline)
     VALUES (1, ?, '1990-09-03', 62, 145000, 0.08, 2600)`,
    [SAMPLE_PROFILE.partnerName],
  );
  const partnerId = partnerRes.lastInsertId!;

  async function addAccount(owner: number | null, name: string, type: string, institution: string): Promise<number> {
    const r = await db.execute(
      `INSERT INTO accounts (household_id, owner_person_id, name, institution, type)
       VALUES (1, ?, ?, ?, ?)`,
      [owner, name, institution, type],
    );
    return r.lastInsertId!;
  }
  const partnerBrokerageId = await addAccount(partnerId, 'Partner Brokerage', 'ACCOUNT_BROKERAGE', 'Schwab');
  const partnerSavingsId = await addAccount(partnerId, 'Partner Savings', 'ACCOUNT_SAVINGS', 'Ally');
  const jointCheckingId = await addAccount(null, 'Joint Checking', 'ACCOUNT_CASH', 'Chase');

  // Cost bases included (D-PT8: every holding except the primary slice's BND
  // carries one, so the Positions gain column demos on partner rows too).
  await db.execute(`INSERT INTO holdings (account_id, ticker, share_count, cost_basis) VALUES (?, 'VTI', 60, 12500)`, [partnerBrokerageId]);
  await db.execute(`INSERT INTO holdings (account_id, ticker, share_count, cost_basis) VALUES (?, 'MSFT', 20, 6800)`, [partnerBrokerageId]);

  const lastMonthClose = lastBusinessDayOfMonth(lastMonthYyyymm(new Date()));
  async function addSnapshot(accountId: number, snapshotDate: string, totalValue: number): Promise<void> {
    await db.execute(
      `INSERT OR REPLACE INTO account_snapshots (account_id, snapshot_date, total_value, source)
       VALUES (?, ?, ?, 'AUTO_DERIVED')`,
      [accountId, snapshotDate, totalValue],
    );
  }
  // EVERY account gets both snapshots — keeps the seed unit suite's
  // `snapshots === accountCount * 2` and close-count invariants intact.
  // Partner Brokerage (non-manual type) → a 4th Monthly derived confirm card;
  // savings/cash are MANUAL_BALANCE_TYPES, so their close snapshots create
  // no confirm cards (they surface as Section-3 balance cards instead).
  await addSnapshot(partnerBrokerageId, today, 118000);
  await addSnapshot(partnerBrokerageId, lastMonthClose, 115500);
  await addSnapshot(partnerSavingsId, today, 22000);
  await addSnapshot(partnerSavingsId, lastMonthClose, 21800);
  await addSnapshot(jointCheckingId, today, 8000);
  await addSnapshot(jointCheckingId, lastMonthClose, 7600);

  // Car Loan becomes P1's; Mortgage stays NULL-obligor (joint).
  if (primaryId != null) {
    await db.execute(`UPDATE loans SET obligor_person_id = ? WHERE name = 'Car Loan'`, [primaryId]);
  }

  // One joint property + one P2 vehicle so Property/Vehicles/NetWorth person
  // views have real rows to show and hide. Sample Home links to the (joint)
  // Mortgage so the full-lien equity surfaces (Wave A C18) are demonstrable
  // in the shim; the Partner Car stays unlinked. Optional Monthly Section 4
  // grows by two nudge cards.
  const mortgage = await db.select<{ id: number }>(
    `SELECT id FROM loans WHERE name = 'Mortgage'`,
  );
  const mortgageId = mortgage[0]?.id ?? null;
  await db.execute(
    `INSERT INTO properties (household_id, owner_person_id, name, type, current_estimated_value, linked_loan_id)
     VALUES (1, NULL, 'Sample Home', 'PRIMARY_RESIDENCE', 850000, ?)`,
    [mortgageId],
  );
  await db.execute(
    `INSERT INTO vehicles (household_id, owner_person_id, name, year, make, model, current_estimated_value)
     VALUES (1, ?, 'Partner Car', 2022, 'Honda', 'CR-V', 24000)`,
    [partnerId],
  );
}

/**
 * Wave B: one RSU grant per person so the Equity card's EXACT person scope
 * is observable in the browser shim. Same company ('Acme') so the single-
 * company FMV what-if stays available household-wide. Guarded on an empty
 * equity_grants table (converges stale dev DBs; never duplicates).
 * Vested today at FMV $25: Avery Sample 2,000 sh = $50,000; Jordan Sample
 * 600 sh = $15,000 (household $65,000).
 */
async function seedEquityGrantsSlice(db: Database, today: string): Promise<void> {
  const monthsFrom = (iso: string, months: number): string => {
    const d = new Date(`${iso}T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + months);
    return d.toISOString().slice(0, 10);
  };
  const schedule = (grantIso: string) =>
    JSON.stringify([
      { date: monthsFrom(grantIso, 12), cumulativePct: 0.25 },
      { date: monthsFrom(grantIso, 24), cumulativePct: 0.5 },
      { date: monthsFrom(grantIso, 36), cumulativePct: 0.75 },
      { date: monthsFrom(grantIso, 48), cumulativePct: 1 },
    ]);
  const personId = async (name: string): Promise<number | null> => {
    const r = await db.select<{ id: number }>('SELECT id FROM persons WHERE name = ?', [name]);
    return r[0]?.id ?? null;
  };
  const investorId = await personId(SAMPLE_PROFILE.personName);
  const partnerId = await personId(SAMPLE_PROFILE.partnerName);
  if (investorId == null || partnerId == null) return;
  const grantDate = monthsFrom(today, -24); // exactly half vested today
  const insert = async (owner: number, name: string, shares: number) =>
    db.execute(
      `INSERT INTO equity_grants (
         household_id, owner_person_id, name, company_name,
         grant_date, strike_price, total_shares, vesting_schedule, current_fmv,
         grant_type, company_valuation, company_outstanding_shares, company_total_debt
       ) VALUES (1, ?, ?, 'Acme', ?, 0, ?, ?, 25, 'RSU', NULL, NULL, NULL)`,
      [owner, name, grantDate, shares, schedule(grantDate)],
    );
  await insert(investorId, 'Investor RSU', 4000);
  await insert(partnerId, 'Partner RSU', 1200);
}

/**
 * Wave T3: one dependent + one 529 with snapshots. 'Riley Sample' turns 18 in
 * May 2034 (2016-05 + 216 months) — the e2e pins that month label, so the
 * date of birth is load-bearing. CA household + MFJ → the deduction hint
 * exercises the CI-C15 null contract ("No state deduction encoded for CA.").
 * Orthogonal to the framework-card e2e pins (no cash/savings/loan/holding
 * rows; FI-eligible portfolio excludes 529s per fi-portfolio.ts). BOTH
 * snapshots are MANUAL-source: the Monthly confirm flow keys on
 * AUTO_DERIVED close-dated rows ('Confirm all (4)') and the college slice
 * stays out of it by design — so the close-count seed pin reads
 * accountCount − 1.
 */
async function seedCollegeSlice(db: Database, today: string): Promise<void> {
  const dep = await db.execute(
    `INSERT INTO dependents (household_id, name, date_of_birth, type)
     VALUES (1, ?, '2016-05-12', 'CHILD')`,
    [SAMPLE_PROFILE.dependentName],
  );
  const person = await db.select<{ id: number }>(
    'SELECT id FROM persons WHERE name = ?', [SAMPLE_PROFILE.personName],
  );
  const acct = await db.execute(
    `INSERT INTO accounts (household_id, owner_person_id, name, institution, type, beneficiary_dependent_id)
     VALUES (1, ?, '529 College Fund', 'Vanguard', 'ACCOUNT_529', ?)`,
    [person[0]?.id ?? null, dep.lastInsertId!],
  );
  const lastMonthClose = lastBusinessDayOfMonth(lastMonthYyyymm(new Date()));
  await db.execute(
    `INSERT OR REPLACE INTO account_snapshots (account_id, snapshot_date, total_value, source)
     VALUES (?, ?, ?, 'MANUAL')`,
    [acct.lastInsertId!, lastMonthClose, 11800],
  );
  await db.execute(
    `INSERT OR REPLACE INTO account_snapshots (account_id, snapshot_date, total_value, source)
     VALUES (?, ?, ?, 'MANUAL')`,
    [acct.lastInsertId!, today, 12000],
  );
}

/** `day` of the month `monthsAgo` before (negative = after) the reference
 * ISO day, in UTC. day ≤ 28 always, so bucketing is run-date-deterministic. */
function monthDay(iso: string, monthsAgo: number, day: number): string {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 - monthsAgo, day)).toISOString().slice(0, 10);
}

/** `daysBack` before the reference day, clamped to the 1st of its month —
 * current-month rows must never leak into a prior (complete, pinned) month. */
function recentWithinMonth(iso: string, daysBack: number): string {
  const t = new Date(`${iso}T12:00:00Z`);
  const first = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1, 12));
  t.setUTCDate(t.getUTCDate() - daysBack);
  return (t < first ? first : t).toISOString().slice(0, 10);
}

/**
 * W4: ~3 months of categorized household spending through Joint Checking.
 * 13 rows per complete month (m-3, m-2, m-1) + 1 reimbursed work dinner (m-1)
 * + 4 current-month rows = 44. Monthly real-spending total $5,911.12 — calm
 * and coherent with the $6,000 household baseline (the Roadmap EF rule
 * prefers this 12-mo average once transactions exist; deliberate).
 * Loan payments route through the system-managed P&I categories and sum to
 * the seeded loan payments: Mortgage $1,190.17 + $2,810.83 = $4,001;
 * Car $701.12 + $89.88 = $791.
 *
 * Every row is written with is_recurring = 0 and person_id NULL (household
 * spending; per-person rows are a filed chip). The seed does NOT pre-flag
 * recurrence: the Spending page's own detector (syncRecurring →
 * detectRecurring) is what promotes the monthly merchants once the page
 * mounts — exactly as it would on a real user's imported statements, and
 * the promotion lands in the throwaway sample DB only.
 */
async function seedSpendingSlice(db: Database, today: string): Promise<void> {
  const checking = await db.select<{ id: number }>(
    `SELECT id FROM accounts WHERE name = 'Joint Checking'`,
  );
  const checkingId = checking[0]?.id ?? null;

  async function addTxn(
    date: string,
    merchant: string,
    amount: number,
    categoryId: number,
    opts?: { reimbursable?: boolean; reimbursedAt?: string; reimbursedAmount?: number },
  ): Promise<void> {
    await db.execute(
      `INSERT INTO transactions
         (household_id, date, merchant, amount, category_id, source_account_id,
          reimbursable, reimbursed_at, reimbursed_amount, is_recurring)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        date,
        merchant,
        amount,
        categoryId,
        checkingId,
        opts?.reimbursable ? 1 : 0,
        opts?.reimbursedAt ?? null,
        opts?.reimbursedAmount ?? null,
      ],
    );
  }

  // One template, three complete months — day-of-month ≤ 28 throughout.
  const MONTHLY: ReadonlyArray<readonly [number, string, number, number]> = [
    [1,  'Harbor Mortgage',        1190.17, 5],  // Mortgage Principal
    [1,  'Harbor Mortgage',        2810.83, 6],  // Mortgage Interest
    [5,  'Westline Auto Finance',   701.12, 14], // Auto Loan Principal
    [5,  'Westline Auto Finance',    89.88, 15], // Auto Loan Interest
    [7,  'Green Basket Market',     243.18, 33], // Groceries
    [21, 'Green Basket Market',     187.62, 33], // Groceries
    [10, 'City Power & Water',      176.55, 10], // Utilities
    [12, 'Bayline Internet',         79.99, 35], // Bills & Utilities
    [14, 'Corner Table Cafe',        64.80, 32], // Food & Drink
    [16, 'Hillcrest Fuel',           58.30, 17], // Gas/Fuel
    [18, 'Evergreen Streaming',      15.99, 39], // Subscriptions
    [24, 'Cedar Pharmacy',           42.75, 38], // Health
    [26, 'Northgate General',       249.94, 37], // Shopping
  ]; // month total: $5,911.12
  for (const monthsAgo of [3, 2, 1]) {
    for (const [day, merchant, amount, cat] of MONTHLY) {
      await addTxn(monthDay(today, monthsAgo, day), merchant, amount, cat);
    }
  }
  // A reimbursed work dinner (m-1): visible on Spending, nets $0 in the
  // real-spending pipeline — the reimbursement flow demos honestly.
  await addTxn(monthDay(today, 1, 15), 'Skyline Bistro', 132.40, 32, {
    reimbursable: true,
    reimbursedAt: monthDay(today, 1, 25),
    reimbursedAmount: 132.40,
  });
  // Current-month rows (clamped to the month start): the tour never lands on
  // an empty "this month". Partial-month real spending: $179.01 (the pending
  // cab is reimbursable and excluded from real spending until reimbursed).
  await addTxn(recentWithinMonth(today, 1), 'Green Basket Market', 96.31, 33);
  await addTxn(recentWithinMonth(today, 3), 'Corner Table Cafe', 28.60, 32);
  await addTxn(recentWithinMonth(today, 5), 'Hillcrest Fuel', 54.10, 17);
  await addTxn(recentWithinMonth(today, 6), 'Harbor Cab Co', 46.00, 34, {
    reimbursable: true,
  });
}

/**
 * W4: one savings goal so /goals demos. EMERGENCY_FUND at $36,000
 * (6 × the $6,000 household baseline), 12 months out, linked to the two cash
 * accounts (Partner Savings $22,000 + Joint Checking $8,000 → 83% progress).
 */
async function seedGoalSlice(db: Database, today: string): Promise<void> {
  const cash = await db.select<{ id: number }>(
    `SELECT id FROM accounts WHERE name IN ('Partner Savings', 'Joint Checking') ORDER BY id`,
  );
  const linked = cash.map((r) => r.id);
  await db.execute(
    `INSERT INTO goals (household_id, for_person_id, name, type, target_amount, target_date, linked_account_ids)
     VALUES (1, NULL, 'Emergency fund', 'EMERGENCY_FUND', 36000, ?, ?)`,
    [monthDay(today, -12, 1), JSON.stringify(linked)],
  );
}
