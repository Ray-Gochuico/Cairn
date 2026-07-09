import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { seedDemoData, DEMO_SEED } from '@/dev/seed-demo-data';

async function freshDb(): Promise<SqliteAdapter> {
  const db = new SqliteAdapter(':memory:');
  setDatabase(db);
  const migrations = await loadAllMigrations();
  await runMigrations(db, migrations);
  return db;
}

describe('seedDemoData', () => {
  let db: SqliteAdapter;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('creates exactly one household, one person, and the expected accounts', async () => {
    await seedDemoData(db);
    const hh = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM household');
    expect(hh[0].n).toBe(1);
    const persons = await db.select<{ name: string }>('SELECT name FROM persons');
    expect(persons).toHaveLength(1);
    expect(persons[0].name).toBe(DEMO_SEED.personName);
    const accts = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM accounts');
    expect(accts[0].n).toBe(DEMO_SEED.accountCount);
  });

  it('writes a positive account_snapshot for every seeded account (drives all value donuts)', async () => {
    await seedDemoData(db);
    const rows = await db.select<{ account_id: number; total_value: number; snapshot_date: string }>(
      'SELECT account_id, total_value, snapshot_date FROM account_snapshots',
    );
    expect(rows.length).toBe(DEMO_SEED.accountCount * 2);
    for (const r of rows) expect(r.total_value).toBeGreaterThan(0);
    // All snapshots dated <= today so latestSnapshotForAccount picks them up.
    const today = new Date().toISOString().slice(0, 10);
    for (const r of rows) expect(r.snapshot_date <= today).toBe(true);
  });

  it('writes loans with positive balances (drives LiabilitiesDonut)', async () => {
    await seedDemoData(db);
    const loans = await db.select<{ current_balance: number }>('SELECT current_balance FROM loans');
    expect(loans.length).toBeGreaterThanOrEqual(1);
    for (const l of loans) expect(l.current_balance).toBeGreaterThan(0);
  });

  it('writes fund_holdings and fund_sectors so look-through populates Per-company/Sector donuts', async () => {
    await seedDemoData(db);
    const fh = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM fund_holdings');
    const fs = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM fund_sectors');
    expect(fh[0].n).toBeGreaterThan(0);
    expect(fs[0].n).toBeGreaterThan(0);
    // Fund-holding weights and sector weights are valid fractions in (0, 1].
    const weights = await db.select<{ weight: number }>('SELECT weight FROM fund_holdings');
    for (const w of weights) {
      expect(w.weight).toBeGreaterThan(0);
      expect(w.weight).toBeLessThanOrEqual(1);
    }
  });

  it('inserts an app_wide disclosure acceptance at the current version', async () => {
    await seedDemoData(db);
    const rows = await db.select<{ document_id: string; version: string }>(
      "SELECT document_id, version FROM disclosure_acceptances WHERE document_id = 'app_wide'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe(DEMO_SEED.appWideVersion);
  });

  it('is idempotent: a second seed does not duplicate rows', async () => {
    await seedDemoData(db);
    await seedDemoData(db);
    const persons = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM persons');
    const accts = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM accounts');
    const snaps = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM account_snapshots');
    const loans = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM loans');
    expect(persons[0].n).toBe(1);
    expect(accts[0].n).toBe(DEMO_SEED.accountCount);
    expect(snaps[0].n).toBe(DEMO_SEED.accountCount * 2);
    expect(loans[0].n).toBe(DEMO_SEED.loanCount);
  });

  it('produces non-empty holding value end-to-end (the donut precondition)', async () => {
    // valueHoldings is the shared computation PerTicker/Sector/Assets donuts read.
    // Re-derive its inputs exactly as use-concentration.ts does, but straight from
    // the DB, to prove seeded rows yield real per-holding dollar value.
    await seedDemoData(db);
    const { valueHoldings } = await import('@/lib/holdings-value');
    const accounts = await db.select<{ id: number; name: string }>('SELECT id, name FROM accounts');
    const holdings = await db.select<{ account_id: number; ticker: string; share_count: number }>(
      'SELECT account_id, ticker, share_count FROM holdings',
    );
    const snaps = await db.select<{ account_id: number; total_value: number; snapshot_date: string }>(
      'SELECT account_id, total_value, snapshot_date FROM account_snapshots',
    );
    const tickers = await db.select<{ ticker: string; asset_class: string }>(
      'SELECT ticker, asset_class FROM tickers',
    );
    const latestPerAccount = new Map<number, number>();
    for (const s of snaps) latestPerAccount.set(s.account_id, s.total_value);
    const assetClassByTicker = new Map(tickers.map((t) => [t.ticker, t.asset_class as never]));
    const accountObjs = accounts.map((a) => ({ id: a.id, name: a.name })) as never[];
    const holdingObjs = holdings.map((h) => ({
      accountId: h.account_id,
      ticker: h.ticker,
      shareCount: h.share_count,
    })) as never[];
    const valued = valueHoldings(accountObjs, holdingObjs, latestPerAccount, assetClassByTicker);
    const total = valued.reduce((a, v) => a + v.value, 0);
    expect(total).toBeGreaterThan(0);
  });

  it('seeds an AUTO_DERIVED last-month-close snapshot per account (Monthly confirm has work)', async () => {
    await seedDemoData(db);
    const { lastBusinessDayOfMonth } = await import('@/lib/business-days');
    const { lastMonthYyyymm } = await import('@/lib/input-pending');
    const close = lastBusinessDayOfMonth(lastMonthYyyymm(new Date()));
    const rows = await db.select<{ n: number }>(
      `SELECT COUNT(*) AS n FROM account_snapshots WHERE snapshot_date = ? AND source = 'AUTO_DERIVED'`,
      [close],
    );
    expect(rows[0].n).toBe(DEMO_SEED.accountCount);
  });

  it('backfills sector/industry for directly-held single names (Sector donut demo coverage)', async () => {
    await seedDemoData(db);
    const rows = await db.select<{ ticker: string; sector: string | null; industry: string | null }>(
      "SELECT ticker, sector, industry FROM tickers WHERE ticker IN ('AAPL', 'MSFT', 'NVDA') ORDER BY ticker",
    );
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      // Real-world GICS sector for all three; Title-Case matches
      // snakeToTitleSector's fund-weight vocabulary so wedges merge.
      expect(r.sector).toBe('Technology');
      expect(r.industry).not.toBeNull();
    }
    // BND deliberately stays sector-NULL: assetClassToPseudoSector maps
    // US_BONDS → 'Fixed Income', which is already the wedge we want.
    const bnd = await db.select<{ sector: string | null }>(
      "SELECT sector FROM tickers WHERE ticker = 'BND'",
    );
    expect(bnd[0].sector).toBeNull();
  });

  it('derives loan first-payment dates from an injectable reference day (Wave 11 T20)', async () => {
    await seedDemoData(db, { todayISO: '2026-07-08' });
    const loans = await db.select<{ name: string; first_payment_date: string }>(
      'SELECT name, first_payment_date FROM loans',
    );
    const byName = new Map(loans.map((l) => [l.name, l.first_payment_date]));
    // Mortgage: exactly 54 months before 2026-07 → 2022-01-01.
    expect(byName.get('Mortgage')).toBe('2022-01-01');
    // Car loan: exactly 18 months before → 2025-01-01.
    expect(byName.get('Car Loan')).toBe('2025-01-01');
  });
});
