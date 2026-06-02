import type { Database } from '@/db/db';
import { DISCLOSURES } from '@/legal/disclosures';

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
 * Idempotent: early-returns if the demo person already exists, and uses
 * INSERT OR IGNORE / OR REPLACE / pre-DELETE everywhere, so re-running against
 * a persisted IndexedDB DB is a no-op.
 *
 * Tickers (VTI, FXAIX, AAPL, MSFT, NVDA, BND) are already seeded by migrations
 * 0006/0038, so this does not write the `tickers` table.
 */

export const DEMO_SEED = {
  personName: 'Demo Investor',
  accountCount: 3,
  loanCount: 2,
  // Imported from the disclosure registry rather than hardcoded so a future
  // app_wide version bump can't leave the seeded acceptance stale (which would
  // re-gate the smoke behind AppDisclaimerGate).
  appWideVersion: DISCLOSURES.app_wide.version,
} as const;

const TODAY = (): string => new Date().toISOString().slice(0, 10);

export async function seedDemoData(db: Database): Promise<void> {
  // Idempotency sentinel: if the demo person exists, assume already seeded.
  const existing = await db.select<{ n: number }>(
    'SELECT COUNT(*) AS n FROM persons WHERE name = ?',
    [DEMO_SEED.personName],
  );
  if ((existing[0]?.n ?? 0) > 0) return;

  const today = TODAY();

  // 1. Household singleton (id = 1). OR IGNORE: a real household may already
  //    exist; we don't clobber it — the donuts only need accounts/snapshots.
  await db.execute(
    `INSERT OR IGNORE INTO household (id, name, filing_status, state, city, monthly_expense_baseline)
     VALUES (1, 'Demo Household', 'MFJ', 'CA', 'San Francisco', 6000)`,
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

  // 5. account_snapshots — THE critical rows. One per account, dated today,
  //    AUTO_DERIVED. Positive totals so latestSnapshotForAccount() > 0 and the
  //    value split in valueHoldings() yields real per-holding dollars.
  async function addSnapshot(accountId: number, totalValue: number): Promise<void> {
    await db.execute(
      `INSERT OR REPLACE INTO account_snapshots (account_id, snapshot_date, total_value, source)
       VALUES (?, ?, ?, 'AUTO_DERIVED')`,
      [accountId, today, totalValue],
    );
  }
  await addSnapshot(brokerageId, 285000);
  await addSnapshot(rothId, 92000);
  await addSnapshot(k401Id, 410000);

  // 6. Loans — LiabilitiesDonut needs current_balance > 0.
  async function addLoan(
    name: string,
    type: string,
    original: number,
    balance: number,
    rate: number,
    termMonths: number,
    monthly: number,
  ): Promise<void> {
    await db.execute(
      `INSERT INTO loans (household_id, name, type, original_amount, current_balance, interest_rate, term_months, first_payment_date, monthly_payment, extra_payment_default)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [name, type, original, balance, rate, termMonths, '2022-01-01', monthly],
    );
  }
  await addLoan('Mortgage', 'MORTGAGE', 650000, 540000, 0.0625, 360, 4001);
  await addLoan('Car Loan', 'AUTO', 42000, 22000, 0.049, 60, 791);

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

  // 9. Disclosure acceptance so AppDisclaimerGate doesn't block the smoke.
  await db.execute(
    `INSERT OR IGNORE INTO disclosure_acceptances (household_id, document_id, version, accepted_at)
     VALUES (1, 'app_wide', ?, ?)`,
    [DEMO_SEED.appWideVersion, new Date().toISOString()],
  );
}
