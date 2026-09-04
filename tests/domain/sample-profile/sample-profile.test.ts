import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { seedSampleProfile, SAMPLE_PROFILE } from '@/domain/sample-profile/sample-profile';

async function freshDb(): Promise<SqliteAdapter> {
  const db = new SqliteAdapter(':memory:');
  setDatabase(db);
  const migrations = await loadAllMigrations();
  await runMigrations(db, migrations);
  return db;
}

describe('seedSampleProfile', () => {
  let db: SqliteAdapter;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('creates exactly one household, two persons, and the expected accounts', async () => {
    await seedSampleProfile(db);
    const hh = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM household');
    expect(hh[0].n).toBe(1);
    const persons = await db.select<{ name: string }>('SELECT name FROM persons');
    expect(persons).toHaveLength(2);
    expect(persons.map((p) => p.name).sort()).toEqual(
      [SAMPLE_PROFILE.personName, SAMPLE_PROFILE.partnerName].sort(),
    );
    const accts = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM accounts');
    expect(accts[0].n).toBe(SAMPLE_PROFILE.accountCount);
  });

  it('backfills the migration-default $0 expense baseline (round-3 M2 fallout)', async () => {
    // The 0001 migration inserts the household singleton with baseline 0
    // BEFORE the seed's INSERT OR IGNORE — the demo household kept a $0
    // baseline, which What-If now honestly reports as a missing input.
    await seedSampleProfile(db);
    const rows = await db.select<{ b: number }>(
      'SELECT monthly_expense_baseline AS b FROM household WHERE id = 1',
    );
    expect(rows[0].b).toBe(6000);
  });

  it('never clobbers a user-set expense baseline', async () => {
    await db.execute('UPDATE household SET monthly_expense_baseline = 4321 WHERE id = 1');
    await seedSampleProfile(db);
    const rows = await db.select<{ b: number }>(
      'SELECT monthly_expense_baseline AS b FROM household WHERE id = 1',
    );
    expect(rows[0].b).toBe(4321);
  });

  it('names the household `Sample Household` (SE-N4) over the migration default', async () => {
    // W4 smoke D2 — the SAME fallout as the $0 baseline above: 0001 inserts
    // the household singleton (name column omitted ⇒ NULL) BEFORE this seed's
    // INSERT OR IGNORE, so the contract name never landed and the sample tour
    // showed an EMPTY "Household name (optional)" field on Inputs → Household.
    // SE-N4 is a contract string: pinned byte-exact, not just "non-null".
    await seedSampleProfile(db);
    const rows = await db.select<{ name: string | null }>(
      'SELECT name FROM household WHERE id = 1',
    );
    expect(rows[0].name).toBe('Sample Household');
  });

  it('never clobbers a user-set household name', async () => {
    await db.execute("UPDATE household SET name = 'The Riveras' WHERE id = 1");
    await seedSampleProfile(db);
    const rows = await db.select<{ name: string | null }>(
      'SELECT name FROM household WHERE id = 1',
    );
    expect(rows[0].name).toBe('The Riveras');
  });

  it('writes a positive account_snapshot for every seeded account (drives all value donuts)', async () => {
    await seedSampleProfile(db);
    const rows = await db.select<{ account_id: number; total_value: number; snapshot_date: string }>(
      'SELECT account_id, total_value, snapshot_date FROM account_snapshots',
    );
    expect(rows.length).toBe(SAMPLE_PROFILE.accountCount * 2);
    for (const r of rows) expect(r.total_value).toBeGreaterThan(0);
    // All snapshots dated <= today so latestSnapshotForAccount picks them up.
    const today = new Date().toISOString().slice(0, 10);
    for (const r of rows) expect(r.snapshot_date <= today).toBe(true);
  });

  it('writes loans with positive balances (drives LiabilitiesDonut)', async () => {
    await seedSampleProfile(db);
    const loans = await db.select<{ current_balance: number }>('SELECT current_balance FROM loans');
    expect(loans.length).toBeGreaterThanOrEqual(1);
    for (const l of loans) expect(l.current_balance).toBeGreaterThan(0);
  });

  it('writes fund_holdings and fund_sectors so look-through populates Per-company/Sector donuts', async () => {
    await seedSampleProfile(db);
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
    await seedSampleProfile(db);
    const rows = await db.select<{ document_id: string; version: string }>(
      "SELECT document_id, version FROM disclosure_acceptances WHERE document_id = 'app_wide'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].version).toBe(SAMPLE_PROFILE.appWideVersion);
  });

  it('is idempotent: a second seed does not duplicate rows', async () => {
    await seedSampleProfile(db);
    await seedSampleProfile(db);
    const persons = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM persons');
    const accts = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM accounts');
    const snaps = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM account_snapshots');
    const loans = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM loans');
    expect(persons[0].n).toBe(2);
    expect(accts[0].n).toBe(SAMPLE_PROFILE.accountCount);
    expect(snaps[0].n).toBe(SAMPLE_PROFILE.accountCount * 2);
    expect(loans[0].n).toBe(SAMPLE_PROFILE.loanCount);
  });

  it('Wave A: seeds a two-person household with joint items (ownership map)', async () => {
    await seedSampleProfile(db);
    const partner = await db.select<{ id: number }>(
      'SELECT id FROM persons WHERE name = ?', [SAMPLE_PROFILE.partnerName],
    );
    expect(partner).toHaveLength(1);
    const partnerAccts = await db.select<{ n: number }>(
      'SELECT COUNT(*) AS n FROM accounts WHERE owner_person_id = ?', [partner[0].id],
    );
    expect(partnerAccts[0].n).toBe(2); // Partner Brokerage + Partner Savings
    const jointAccts = await db.select<{ name: string }>(
      'SELECT name FROM accounts WHERE owner_person_id IS NULL',
    );
    expect(jointAccts.map((a) => a.name)).toEqual(['Joint Checking']);
    const loans = await db.select<{ name: string; obligor_person_id: number | null }>(
      'SELECT name, obligor_person_id FROM loans ORDER BY name',
    );
    expect(loans.find((l) => l.name === 'Mortgage')?.obligor_person_id).toBeNull();      // joint
    expect(loans.find((l) => l.name === 'Car Loan')?.obligor_person_id).not.toBeNull();  // P1's
    const jointProps = await db.select<{ n: number }>(
      'SELECT COUNT(*) AS n FROM properties WHERE owner_person_id IS NULL',
    );
    expect(jointProps[0].n).toBe(1); // Sample Home
    // Review fix: Sample Home is linked to the (joint) Mortgage so the wave's
    // full-lien property surfaces are demonstrable in the shim.
    const mortgage = await db.select<{ id: number }>(
      "SELECT id FROM loans WHERE name = 'Mortgage'",
    );
    const home = await db.select<{ linked_loan_id: number | null }>(
      "SELECT linked_loan_id FROM properties WHERE name = 'Sample Home'",
    );
    expect(home[0].linked_loan_id).toBe(mortgage[0].id);
    const partnerVehicles = await db.select<{ n: number }>(
      'SELECT COUNT(*) AS n FROM vehicles WHERE owner_person_id = ?', [partner[0].id],
    );
    expect(partnerVehicles[0].n).toBe(1); // Partner Car
  });

  it('Wave A: the partner slice is independently idempotent (stale dev DBs converge)', async () => {
    await seedSampleProfile(db); // full seed
    await seedSampleProfile(db); // second run: both sentinels short-circuit
    const persons = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM persons');
    expect(persons[0].n).toBe(2);
  });

  it('produces non-empty holding value end-to-end (the donut precondition)', async () => {
    // valueHoldings is the shared computation PerTicker/Sector/Assets donuts read.
    // Re-derive its inputs exactly as use-concentration.ts does, but straight from
    // the DB, to prove seeded rows yield real per-holding dollar value.
    await seedSampleProfile(db);
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
    await seedSampleProfile(db);
    const { lastBusinessDayOfMonth } = await import('@/lib/business-days');
    const { lastMonthYyyymm } = await import('@/lib/input-pending');
    const close = lastBusinessDayOfMonth(lastMonthYyyymm(new Date()));
    const rows = await db.select<{ n: number }>(
      `SELECT COUNT(*) AS n FROM account_snapshots WHERE snapshot_date = ? AND source = 'AUTO_DERIVED'`,
      [close],
    );
    // T3: the 529's close snapshot is MANUAL by design (the college slice
    // stays out of the Monthly confirm flow), so it is accountCount − 1.
    expect(rows[0].n).toBe(SAMPLE_PROFILE.accountCount - 1);
  });

  it('backfills sector/industry for directly-held single names (Sector donut demo coverage)', async () => {
    await seedSampleProfile(db);
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

  it('dates the default "today" snapshots on the LOCAL calendar day, never the UTC day', async () => {
    // 23:30 Pacific = 06:30 UTC next day. The app's as-of pipelines run on
    // useLocalToday(), so a UTC-dated snapshot sits in the local FUTURE all
    // evening west of UTC and every latest-value surface silently excludes
    // it (the briefing's net-worth row vanished in evening e2e runs).
    // Review fix: pin the TZ for this test — on a UTC runner the local and
    // UTC calendar days coincide and the assertion below would be inert.
    const prevTZ = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    vi.useFakeTimers();
    try {
      const instant = new Date('2026-07-29T23:30:00-07:00');
      vi.setSystemTime(instant);
      const { localTodayISO } = await import('@/lib/dates');
      // Guard: the chosen instant must actually split the two
      // implementations, so this test self-fails if it stops discriminating.
      expect(localTodayISO(instant)).not.toBe(instant.toISOString().slice(0, 10));
      await seedSampleProfile(db);
      const expected = localTodayISO(instant);
      const rows = await db.select<{ d: string }>(
        'SELECT MAX(snapshot_date) AS d FROM account_snapshots',
      );
      expect(rows[0].d).toBe(expected);
    } finally {
      vi.useRealTimers();
      if (prevTZ === undefined) delete process.env.TZ;
      else process.env.TZ = prevTZ;
    }
  });

  it('derives loan first-payment dates from an injectable reference day (Wave 11 T20)', async () => {
    await seedSampleProfile(db, { todayISO: '2026-07-08' });
    const loans = await db.select<{ name: string; first_payment_date: string }>(
      'SELECT name, first_payment_date FROM loans',
    );
    const byName = new Map(loans.map((l) => [l.name, l.first_payment_date]));
    // Mortgage: exactly 54 months before 2026-07 → 2022-01-01.
    expect(byName.get('Mortgage')).toBe('2022-01-01');
    // Car loan: exactly 18 months before → 2025-01-01.
    expect(byName.get('Car Loan')).toBe('2025-01-01');
  });

  it("0051: Jordan Sample gets a durable monthly_expense_baseline; Avery Sample stays NULL (both provenance paths smokable)", async () => {
    await seedSampleProfile(db);
    const rows = await db.select<{ name: string; b: number | null }>(
      'SELECT name, monthly_expense_baseline AS b FROM persons ORDER BY name',
    );
    const byName = new Map(rows.map((r) => [r.name, r.b]));
    // Partner set → the scoped bar's \"from Jordan Sample's Inputs\" path;
    // Investor NULL → the labeled even-split path stays demonstrable too.
    expect(byName.get(SAMPLE_PROFILE.partnerName)).toBe(2600);
    expect(byName.get(SAMPLE_PROFILE.personName)).toBeNull();
  });

  it('Wave B: seeds one RSU grant per person (the exact card is smokable) — idempotently', async () => {
    const todayISO = '2026-07-08';
    await seedSampleProfile(db, { todayISO });
    await seedSampleProfile(db, { todayISO });
    const grants = await db.select<{ owner_person_id: number; grant_type: string }>(
      'SELECT owner_person_id, grant_type FROM equity_grants ORDER BY id',
    );
    expect(grants).toHaveLength(2);
    expect(new Set(grants.map((g) => g.owner_person_id)).size).toBe(2);
    expect(grants.every((g) => g.grant_type === 'RSU')).toBe(true);
  });

  it('seeds Positions price pairs: two recent dates per priced ticker, none for MSFT', async () => {
    await seedSampleProfile(db);
    const counts = await db.select<{ ticker: string; n: number }>(
      'SELECT ticker, COUNT(*) AS n FROM price_cache GROUP BY ticker ORDER BY ticker',
    );
    expect(counts).toEqual([
      { ticker: 'AAPL', n: 2 },
      { ticker: 'BND', n: 2 },
      { ticker: 'FXAIX', n: 2 },
      { ticker: 'NVDA', n: 2 },
      { ticker: 'VTI', n: 2 },
      // no MSFT rows — the demo's "excludes 1 without a price" account total
    ]);
  });

  it('seeds 52-week fields on the fund trio only (AAPL/NVDA stay null → "—")', async () => {
    await seedSampleProfile(db);
    const rows = await db.select<{ ticker: string; lo: number | null; hi: number | null }>(
      'SELECT ticker, fifty_two_week_low AS lo, fifty_two_week_high AS hi FROM tickers WHERE ticker IN (?,?,?,?,?) ORDER BY ticker',
      ['AAPL', 'BND', 'FXAIX', 'NVDA', 'VTI'],
    );
    expect(rows).toEqual([
      { ticker: 'AAPL', lo: null, hi: null },
      { ticker: 'BND', lo: 66.5, hi: 74.9 },
      { ticker: 'FXAIX', lo: 133.2, hi: 159.1 },
      { ticker: 'NVDA', lo: null, hi: null },
      { ticker: 'VTI', lo: 206.4, hi: 246.6 },
    ]);
  });

  it('seeds day-change facts on the fund trio only, coherent with the latest cached price (AAPL/NVDA stay null → "—")', async () => {
    await seedSampleProfile(db);
    const rows = await db.select<{ ticker: string; chg: number | null; prev: number | null }>(
      'SELECT ticker, regular_market_change AS chg, regular_market_previous_close AS prev FROM tickers WHERE ticker IN (?,?,?,?,?) ORDER BY ticker',
      ['AAPL', 'BND', 'FXAIX', 'NVDA', 'VTI'],
    );
    expect(rows).toEqual([
      { ticker: 'AAPL', chg: null, prev: null },
      { ticker: 'BND', chg: 0.12, prev: 71.52 },
      { ticker: 'FXAIX', chg: -0.57, prev: 154.8 },
      { ticker: 'NVDA', chg: null, prev: null },
      { ticker: 'VTI', chg: 1.2, prev: 237.6 },
    ]);
    // Coherence (D-WB13): previous_close + change ≈ the latest seeded cached
    // price — what a real refresh produces. toBeCloseTo, NEVER exact float
    // sums (237.6 + 1.2 === 238.79999999999998 in doubles).
    const latest = await db.select<{ ticker: string; price: number }>(
      `SELECT ticker, price FROM price_cache pc
       WHERE ticker IN (?,?,?)
         AND date = (SELECT MAX(date) FROM price_cache p2 WHERE p2.ticker = pc.ticker)
       ORDER BY ticker`,
      ['BND', 'FXAIX', 'VTI'],
    );
    const byTicker = new Map(latest.map((r) => [r.ticker, r.price]));
    expect(71.52 + 0.12).toBeCloseTo(byTicker.get('BND')!, 2);    // 71.64
    expect(154.8 + -0.57).toBeCloseTo(byTicker.get('FXAIX')!, 2); // 154.23
    expect(237.6 + 1.2).toBeCloseTo(byTicker.get('VTI')!, 2);     // 238.80
  });

  it('Wave T3: seeds Riley Sample + a MANUAL-source 529 (college thread smokable; Monthly confirm untouched) — idempotently', async () => {
    await seedSampleProfile(db);
    await seedSampleProfile(db); // college sentinel short-circuits: no duplicates
    const kids = await db.select<{ name: string; date_of_birth: string; type: string }>(
      'SELECT name, date_of_birth, type FROM dependents',
    );
    // dob is load-bearing: 2016-05 + 216 months = May 2034 — the e2e pins
    // the 'starting May 2034' label.
    expect(kids).toEqual([{ name: 'Riley Sample', date_of_birth: '2016-05-12', type: 'CHILD' }]);
    const accts = await db.select<{ id: number; beneficiary_dependent_id: number | null; owner_person_id: number | null }>(
      "SELECT id, beneficiary_dependent_id, owner_person_id FROM accounts WHERE type = 'ACCOUNT_529'",
    );
    expect(accts).toHaveLength(1);
    expect(accts[0].beneficiary_dependent_id).not.toBeNull();
    expect(accts[0].owner_person_id).not.toBeNull();
    // BOTH snapshots are MANUAL: the Monthly confirm flow keys on
    // AUTO_DERIVED close-dated rows (the e2e's 'Confirm all (4)' pin) —
    // the college slice stays out of that flow by design.
    const snaps = await db.select<{ total_value: number; source: string }>(
      'SELECT total_value, source FROM account_snapshots WHERE account_id = ? ORDER BY snapshot_date',
      [accts[0].id],
    );
    expect(snaps).toEqual([
      { total_value: 11800, source: 'MANUAL' },
      { total_value: 12000, source: 'MANUAL' },
    ]);
  });

  it('seeds cost basis on all holdings except BND (its gain honestly renders "—")', async () => {
    await seedSampleProfile(db);
    const rows = await db.select<{ ticker: string; cost_basis: number | null }>(
      'SELECT ticker, cost_basis FROM holdings ORDER BY id',
    );
    expect(rows.filter((r) => r.cost_basis === null).map((r) => r.ticker)).toEqual(['BND']);
    expect(rows.find((r) => r.ticker === 'VTI')?.cost_basis).toBe(24_000);
  });

  it('W4: converges a profile seeded under the legacy names without double-seeding', async () => {
    await seedSampleProfile(db);
    await db.execute(`UPDATE persons SET name = 'Demo Investor' WHERE name = 'Avery Sample'`);
    await db.execute(`UPDATE persons SET name = 'Demo Partner' WHERE name = 'Jordan Sample'`);
    await db.execute(`UPDATE dependents SET name = 'Demo Kid' WHERE name = 'Riley Sample'`);
    await seedSampleProfile(db); // legacy-name sentinels must short-circuit every slice
    const persons = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM persons');
    const accts = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM accounts');
    const deps = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM dependents');
    expect(persons[0].n).toBe(2);
    expect(accts[0].n).toBe(SAMPLE_PROFILE.accountCount);
    expect(deps[0].n).toBe(1);
  });

  it('W4: seeds the spending slice — 44 categorized transactions behind an empty-table sentinel', async () => {
    await seedSampleProfile(db, { todayISO: '2026-07-08' });
    await seedSampleProfile(db, { todayISO: '2026-07-08' }); // sentinel short-circuits
    const n = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM transactions');
    expect(n[0].n).toBe(44);
    // Every row lands on a real category and the Joint Checking account.
    const dangling = await db.select<{ n: number }>(
      `SELECT COUNT(*) AS n FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE c.id IS NULL`,
    );
    expect(dangling[0].n).toBe(0);
    const src = await db.select<{ n: number }>(
      `SELECT COUNT(*) AS n FROM transactions t
       JOIN accounts a ON a.id = t.source_account_id
       WHERE a.name = 'Joint Checking'`,
    );
    expect(src[0].n).toBe(44);
    // The SEED never writes a recurring flag (the Spending page's own
    // detector may promote monthly merchants later — that is the app's
    // behavior on any real data, not something the seed pre-bakes).
    const rec = await db.select<{ n: number }>(
      'SELECT COUNT(*) AS n FROM transactions WHERE is_recurring = 1',
    );
    expect(rec[0].n).toBe(0);
  });

  it('W4: loan payments route through the system-managed P&I categories, 3 months each', async () => {
    await seedSampleProfile(db, { todayISO: '2026-07-08' });
    const rows = await db.select<{ category_id: number; n: number }>(
      `SELECT category_id, COUNT(*) AS n FROM transactions
       WHERE category_id IN (5, 6, 14, 15) GROUP BY category_id ORDER BY category_id`,
    );
    expect(rows).toEqual([
      { category_id: 5, n: 3 },
      { category_id: 6, n: 3 },
      { category_id: 14, n: 3 },
      { category_id: 15, n: 3 },
    ]);
    // The monthly P&I splits sum to the seeded loan payments ($4,001 / $791).
    const sums = await db.select<{ s: number }>(
      `SELECT SUM(amount) AS s FROM transactions
       WHERE category_id IN (5, 6) AND date LIKE '2026-06%'`,
    );
    expect(sums[0].s).toBeCloseTo(4001, 2);
  });

  it('W4: one reimbursed work dinner nets to zero; one pending reimbursable stays pending', async () => {
    await seedSampleProfile(db, { todayISO: '2026-07-08' });
    const done = await db.select<{ amount: number; reimbursed_amount: number }>(
      `SELECT amount, reimbursed_amount FROM transactions
       WHERE merchant = 'Skyline Bistro' AND reimbursable = 1`,
    );
    expect(done).toHaveLength(1);
    expect(done[0].reimbursed_amount).toBeCloseTo(done[0].amount, 2);
    const pending = await db.select<{ reimbursed_at: string | null }>(
      `SELECT reimbursed_at FROM transactions
       WHERE merchant = 'Harbor Cab Co' AND reimbursable = 1`,
    );
    expect(pending).toEqual([{ reimbursed_at: null }]);
  });

  it('W4: real-spending months are deterministic — $5,911.12 per complete month, $179.01 partial', async () => {
    await seedSampleProfile(db, { todayISO: '2026-07-08' });
    // Net real spending per month, Spending-page semantics expressed in SQL:
    // exclude TRANSFER/INCOME categories; net reimbursements (a pending
    // reimbursable counts $0 until reimbursed; a reimbursed row counts
    // amount − reimbursed_amount). Mirrors isRealSpending/
    // effectiveSpendingAmount (src/lib/spending-analysis.ts) — and even if
    // those semantics drift, this pin still freezes the SEED's arithmetic.
    const months = await db.select<{ m: string; total: number }>(
      `SELECT substr(t.date, 1, 7) AS m,
              ROUND(SUM(CASE
                WHEN t.reimbursable = 1 AND t.reimbursed_at IS NULL THEN 0
                ELSE t.amount - COALESCE(t.reimbursed_amount, 0)
              END), 2) AS total
       FROM transactions t
       JOIN categories c ON c.id = t.category_id
       WHERE c.type NOT IN ('TRANSFER', 'INCOME')
       GROUP BY m ORDER BY m`,
    );
    expect(months).toEqual([
      { m: '2026-04', total: 5911.12 },
      { m: '2026-05', total: 5911.12 },
      { m: '2026-06', total: 5911.12 }, // Skyline Bistro nets $0
      { m: '2026-07', total: 179.01 },  // pending Harbor Cab counts $0
    ]);
    // Consequence (P-W4-6): with real spending present, the Roadmap EF rule's
    // efContext prefers the 12-mo average over the household baseline — that
    // preference is already unit-tested in the roadmap rules suite; the smoke
    // checklist verifies the visible "from 12-mo avg" suffix on /roadmap.
  });

  it('W4: seeds one EMERGENCY_FUND goal linked to the cash accounts, behind its sentinel', async () => {
    await seedSampleProfile(db, { todayISO: '2026-07-08' });
    await seedSampleProfile(db, { todayISO: '2026-07-08' });
    const goals = await db.select<{
      name: string;
      type: string;
      target_amount: number;
      linked_account_ids: string;
    }>('SELECT name, type, target_amount, linked_account_ids FROM goals');
    expect(goals).toHaveLength(1);
    expect(goals[0].name).toBe('Emergency fund');
    expect(goals[0].type).toBe('EMERGENCY_FUND');
    expect(goals[0].target_amount).toBe(36000);
    const linked = JSON.parse(goals[0].linked_account_ids) as number[];
    const cash = await db.select<{ id: number }>(
      `SELECT id FROM accounts WHERE name IN ('Partner Savings', 'Joint Checking') ORDER BY id`,
    );
    expect(linked.sort((a, b) => a - b)).toEqual(cash.map((r) => r.id));
  });
});
