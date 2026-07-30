import type { Database } from '@/db/db';
import { DISCLOSURES } from '@/legal/disclosures';
import { lastBusinessDayOfMonth } from '@/lib/business-days';
import { localTodayISO } from '@/lib/dates';
import { lastMonthYyyymm } from '@/lib/input-pending';

/**
 * DEV-ONLY demo-data seed for browser smoke tests of the Investments donuts.
 *
 * GUARDED OUT OF PROD: only invoked from initDatabase() when
 * `import.meta.env.DEV && VITE_BROWSER_SHIM === '1' && VITE_SEED_DEMO === '1'`
 * (see src/db/init.ts). Those are statically-replaced Vite env reads, so the
 * Tauri prod build (which sets none of them) dead-code-eliminates the call —
 * this module is never reachable in a shipped binary.
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
 * Idempotent: each slice early-returns if its sentinel person already exists
 * (Demo Investor for the primary slice, Demo Partner for the Wave-A partner
 * slice), and uses INSERT OR IGNORE / OR REPLACE / pre-DELETE everywhere, so
 * re-running against a persisted IndexedDB DB is a no-op.
 *
 * Tickers (VTI, FXAIX, AAPL, MSFT, NVDA, BND) are already seeded by migrations
 * 0006/0038; this module only UPDATEs their sector/industry columns (step 8)
 * — it never inserts ticker rows.
 */

export const DEMO_SEED = {
  personName: 'Demo Investor',
  partnerName: 'Demo Partner',
  accountCount: 6, // 3 original + Partner Brokerage + Partner Savings + Joint Checking
  loanCount: 2,
  // Imported from the disclosure registry rather than hardcoded so a future
  // app_wide version bump can't leave the seeded acceptance stale (which would
  // re-gate the smoke behind AppDisclaimerGate).
  appWideVersion: DISCLOSURES.app_wide.version,
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

export async function seedDemoData(
  db: Database,
  opts?: { todayISO?: string },
): Promise<void> {
  const today = opts?.todayISO ?? TODAY();
  // Independent idempotency sentinels (Wave A D13): the primary slice keeps
  // its Demo Investor sentinel for its own rows only, and the partner slice
  // runs behind its own Demo Partner sentinel — so both fresh DBs and dev
  // DBs seeded before Wave A converge to the same two-person household
  // without re-running (or duplicating) the primary slice.
  const primaryExists = await countPersons(db, DEMO_SEED.personName);
  if (!primaryExists) {
    await seedPrimarySlice(db, today);
  }
  const partnerExists = await countPersons(db, DEMO_SEED.partnerName);
  if (!partnerExists) {
    await seedPartnerSlice(db, today);
  }
}

async function countPersons(db: Database, name: string): Promise<boolean> {
  const r = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM persons WHERE name = ?', [name]);
  return (r[0]?.n ?? 0) > 0;
}

async function seedPrimarySlice(db: Database, today: string): Promise<void> {
  // 1. Household singleton (id = 1). OR IGNORE: a real household may already
  //    exist; we don't clobber it — the donuts only need accounts/snapshots.
  await db.execute(
    `INSERT OR IGNORE INTO household (id, name, filing_status, state, city, monthly_expense_baseline)
     VALUES (1, 'Demo Household', 'MFJ', 'CA', 'San Francisco', 6000)`,
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

  // 2. Person. Only NOT-NULL/no-default columns are named; ALTER-added
  //    columns (commission, employment) carry table DEFAULTs.
  const personRes = await db.execute(
    `INSERT INTO persons (household_id, name, date_of_birth, target_retirement_age, annual_salary_pretax, pretax_401k_pct)
     VALUES (1, ?, '1988-04-12', 60, 180000, 0.1)`,
    [DEMO_SEED.personName],
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
  async function addHolding(accountId: number, ticker: string, shareCount: number): Promise<void> {
    await db.execute(
      `INSERT INTO holdings (account_id, ticker, share_count) VALUES (?, ?, ?)`,
      [accountId, ticker, shareCount],
    );
  }
  await addHolding(brokerageId, 'VTI', 120); // US total market fund (look-through)
  await addHolding(brokerageId, 'AAPL', 40);
  await addHolding(brokerageId, 'NVDA', 15);
  await addHolding(rothId, 'FXAIX', 200); // S&P 500 index fund (look-through)
  await addHolding(rothId, 'MSFT', 25);
  await addHolding(k401Id, 'FXAIX', 350);
  await addHolding(k401Id, 'BND', 180); // bond fund

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
  const DEMO_TICKER_PROFILES: ReadonlyArray<readonly [string, string, string]> = [
    ['AAPL', 'Technology', 'Consumer Electronics'],
    ['MSFT', 'Technology', 'Software—Infrastructure'],
    ['NVDA', 'Technology', 'Semiconductors'],
  ];
  for (const [ticker, sector, industry] of DEMO_TICKER_PROFILES) {
    await db.execute(`UPDATE tickers SET sector = ?, industry = ? WHERE ticker = ?`, [
      sector,
      industry,
      ticker,
    ]);
  }

  // 9. Disclosure acceptance so AppDisclaimerGate doesn't block the smoke.
  await db.execute(
    `INSERT OR IGNORE INTO disclosure_acceptances (household_id, document_id, version, accepted_at)
     VALUES (1, 'app_wide', ?, ?)`,
    [DEMO_SEED.appWideVersion, new Date().toISOString()],
  );
}

/**
 * Wave A: second person + joint items so the ?view= filter is exercisable
 * in the browser shim (useViewFilter requires persons.length === 2).
 * Independently sentineled on partnerName so dev DBs seeded before Wave A
 * converge without re-running (or duplicating) the primary slice.
 * Ownership map this creates:
 *   P1 (Demo Investor): Taxable Brokerage, Roth IRA, 401(k) [existing], Car Loan (obligor UPDATE)
 *   P2 (Demo Partner):  Partner Brokerage (derived-snapshot confirm card), Partner Savings (cash card), Partner Car
 *   Joint (owner NULL): Joint Checking, Mortgage (already NULL), Demo Home
 * Monthly Section-1 consequence: derived confirm cards go 3 → 4 (the e2e
 * Confirm-all pin moves in the same commit).
 */
async function seedPartnerSlice(db: Database, today: string): Promise<void> {
  const person = await db.select<{ id: number }>(
    'SELECT id FROM persons WHERE name = ?', [DEMO_SEED.personName],
  );
  const primaryId = person[0]?.id;

  const partnerRes = await db.execute(
    `INSERT INTO persons (household_id, name, date_of_birth, target_retirement_age, annual_salary_pretax, pretax_401k_pct)
     VALUES (1, ?, '1990-09-03', 62, 145000, 0.08)`,
    [DEMO_SEED.partnerName],
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

  await db.execute(`INSERT INTO holdings (account_id, ticker, share_count) VALUES (?, 'VTI', 60)`, [partnerBrokerageId]);
  await db.execute(`INSERT INTO holdings (account_id, ticker, share_count) VALUES (?, 'MSFT', 20)`, [partnerBrokerageId]);

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
  // views have real rows to show and hide. Unlinked (no loan links — keep
  // the graph simple); optional Monthly Section 4 grows by two nudge cards.
  await db.execute(
    `INSERT INTO properties (household_id, owner_person_id, name, type, current_estimated_value)
     VALUES (1, NULL, 'Demo Home', 'PRIMARY_RESIDENCE', 850000)`,
  );
  await db.execute(
    `INSERT INTO vehicles (household_id, owner_person_id, name, year, make, model, current_estimated_value)
     VALUES (1, ?, 'Partner Car', 2022, 'Honda', 'CR-V', 24000)`,
    [partnerId],
  );
}
