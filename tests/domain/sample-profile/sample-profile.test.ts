import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { seedSampleProfile, SAMPLE_PROFILE } from '@/domain/sample-profile/sample-profile';
import { TransactionsRepo } from '@/domain/transactions';
import { CategoriesRepo } from '@/domain/categories';
import { AccountsRepo } from '@/domain/accounts';
import { AccountSnapshotsRepo } from '@/domain/snapshots';
import { HouseholdRepo } from '@/domain/household';
import { LoansRepo } from '@/domain/loans';
import { PersonsRepo } from '@/domain/persons';
import { getInterestThresholds } from '@/domain/roadmap/thresholds';
import { efContext, evaluateSmallEmergencyFund } from '@/domain/roadmap/rules/emergencyFund';
import { splitAmount } from '@/lib/interview/waterfall';
import { dateFromLocalISO } from '@/lib/dates';
import type { InterviewContext } from '@/types/interview';
import { TaxRulesRepo } from '@/domain/tax-rules';
import { JurisdictionType } from '@/types/enums';
import { aggregateHouseholdPretax } from '@/lib/calculators/supplemental-wage';
import { computePaycheck } from '@/lib/calculators/paycheck';
import {
  evaluateBackdoorRoth,
  evaluateIraBand,
  evaluateRothIra,
  evaluateTraditionalIra,
} from '@/domain/roadmap/rules/iraBranch';
import { formatCurrency } from '@/lib/format';

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

  it('R2: backfills filing_status = MFJ over the 0001 default (the INSERT never landed — the name/baseline fallout a third time)', async () => {
    // 0001 inserts the singleton with filing_status 'SINGLE' (NOT NULL, no
    // column default) BEFORE the seed runs, so the seed's 'MFJ' never landed:
    // Avery + Jordan Sample (joint checking, joint mortgage, one dependent)
    // ran every W-2 surface through SINGLE brackets. Appendix A.1.
    await seedSampleProfile(db, { todayISO: '2026-07-08' });
    const rows = await db.select<{ fs: string }>(
      'SELECT filing_status AS fs FROM household WHERE id = 1',
    );
    expect(rows[0].fs).toBe('MFJ');
  });

  it('R2: never clobbers a typed filing status', async () => {
    await db.execute("UPDATE household SET filing_status = 'HOH' WHERE id = 1");
    await seedSampleProfile(db, { todayISO: '2026-07-08' });
    const rows = await db.select<{ fs: string }>(
      'SELECT filing_status AS fs FROM household WHERE id = 1',
    );
    expect(rows[0].fs).toBe('HOH');
  });

  it('R2: a typed SINGLE is indistinguishable from the default — the guard is the migration-default TUPLE (D-R2-1)', async () => {
    // Someone named the household and left SINGLE: the row is no longer as
    // 0001 wrote it, so the filing status is theirs. (The name backfill's own
    // guard keeps the typed name too.)
    await db.execute("UPDATE household SET name = 'The Riveras' WHERE id = 1");
    await seedSampleProfile(db, { todayISO: '2026-07-08' });
    const rows = await db.select<{ fs: string; name: string | null }>(
      'SELECT filing_status AS fs, name FROM household WHERE id = 1',
    );
    expect(rows[0]).toEqual({ fs: 'SINGLE', name: 'The Riveras' });
  });

  it('R2: a typed expense baseline alone also holds the filing-status guard closed', async () => {
    await db.execute('UPDATE household SET monthly_expense_baseline = 4321 WHERE id = 1');
    await seedSampleProfile(db, { todayISO: '2026-07-08' });
    const rows = await db.select<{ fs: string; b: number }>(
      'SELECT filing_status AS fs, monthly_expense_baseline AS b FROM household WHERE id = 1',
    );
    expect(rows[0]).toEqual({ fs: 'SINGLE', b: 4321 });
  });

  it('R2: city stays NULL — the column is a CITY tax-jurisdiction code and CA has none (D-R2-2)', async () => {
    // The chip asked for `city = 'San Francisco'`. HouseholdForm's city
    // field is a select over the seeded CITY rules ('AL_BIRMINGHAM'-shaped
    // codes); no 'CA_*' rule exists (no California city levies an income
    // tax), so a display string would look up NULL for tax, render an EMPTY
    // ScenarioBar chip (prettifyCityCode drops everything before the first
    // '_') and be cleared by the wizard's `${state}_` check. NULL is honest.
    await seedSampleProfile(db, { todayISO: '2026-07-08' });
    const rows = await db.select<{ city: string | null; state: string }>(
      'SELECT city, state FROM household WHERE id = 1',
    );
    expect(rows[0]).toEqual({ city: null, state: 'CA' });
    // The premise, pinned: if a CA city rule ever lands, revisit D-R2-2.
    const caCity = await db.select<{ n: number }>(
      "SELECT COUNT(*) AS n FROM tax_rules WHERE jurisdiction_type = 'CITY' AND jurisdiction_code LIKE 'CA\\_%' ESCAPE '\\'",
    );
    expect(caCity[0].n).toBe(0);
  });

  it('R2: the seed never INSERTs the household row — 0001 owns the singleton; every intended value is a guarded backfill (D-R2-3)', () => {
    // Structural pin (the plugin-sql-close.test.ts idiom): the dead INSERT
    // OR IGNORE read as if it landed and hid the same fallout three waves
    // running. No INSERT into household, no display-string city, no stale
    // "12-mo average" claim anywhere in the seed source.
    const src = readFileSync(
      resolve(__dirname, '../../../src/domain/sample-profile/sample-profile.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/INSERT\s+(OR\s+\w+\s+)?INTO\s+household\b/i);
    expect(src).not.toMatch(/San Francisco/);
    expect(src).not.toMatch(/12-mo average/);
  });

  it('writes a positive account_snapshot for every seeded account (drives all value donuts)', async () => {
    await seedSampleProfile(db, { todayISO: '2026-07-08' });
    const rows = await db.select<{ account_id: number; total_value: number; snapshot_date: string }>(
      'SELECT account_id, total_value, snapshot_date FROM account_snapshots',
    );
    expect(rows.length).toBe(SAMPLE_PROFILE.accountCount * 2);
    for (const r of rows) expect(r.total_value).toBeGreaterThan(0);
    // All snapshots dated <= the seed day so latestSnapshotForAccount picks
    // them up. R2 (D-R2-11): compared against the INJECTED local day, not
    // `new Date().toISOString()` — the UTC day, which is YESTERDAY's local
    // day east of UTC each morning (the seed suite's TZ=Pacific/Kiritimati
    // failure the R1 review recorded).
    for (const r of rows) expect(r.snapshot_date <= '2026-07-08').toBe(true);
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
    await seedSampleProfile(db, { todayISO: '2026-07-08' });
    // R2 (D-R2-11): the close is the last business day of the month before
    // the SEED day — June 30, 2026 (a Tuesday) — not the run date's.
    const rows = await db.select<{ n: number }>(
      `SELECT COUNT(*) AS n FROM account_snapshots WHERE snapshot_date = '2026-06-30' AND source = 'AUTO_DERIVED'`,
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
    // Consequence (R1): with three complete months of real spending, efContext
    // prefers the complete-month average — pinned through the production
    // mappers in 'R1 historical anchors' below; the smoke checklist verifies
    // the visible "from 3 months of spending" suffix on /roadmap.
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

describe('R2: the seed is pure over its todayISO option — no real-clock read at the close sites', () => {
  let db: SqliteAdapter;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('close-dated snapshots derive from todayISO: seed 2026-07-08 → every close row is 2026-06-30, every today row 2026-07-08 (Appendix A.4)', async () => {
    // Before R2 the three close sites read `lastMonthYyyymm(new Date())` —
    // the real clock — so seeding a PAST day wrote close rows dated AFTER it
    // (on a September run: 2026-08-31 > 2026-07-08) and `latestSnapshotValue`
    // read the close values (cash $29,400) instead of the seed-day values
    // ($30,000). R1's anchors had to pin Date to stay stable (dropped in R2).
    await seedSampleProfile(db, { todayISO: '2026-07-08' });
    const dates = await db.select<{ d: string; n: number }>(
      'SELECT snapshot_date AS d, COUNT(*) AS n FROM account_snapshots GROUP BY snapshot_date ORDER BY d',
    );
    // 2026-06-30 is a Tuesday — the last business day of June 2026 is June 30 itself.
    expect(dates).toEqual([
      { d: '2026-06-30', n: SAMPLE_PROFILE.accountCount },
      { d: '2026-07-08', n: SAMPLE_PROFILE.accountCount },
    ]);
  });

  it.each([
    ['2026-07-01', '2026-06-30'], // Tue — a seed on the 1st still closes the PRIOR month
    ['2026-08-01', '2026-07-31'], // Fri
    ['2026-09-01', '2026-08-31'], // Mon
    ['2027-01-15', '2026-12-31'], // Thu — the December rollover
    ['2026-03-01', '2026-02-27'], // Sat Feb 28 → Fri Feb 27
  ])('seed %s → prior-month close %s (business-day + rollover arithmetic, no clock)', async (todayISO, close) => {
    await seedSampleProfile(db, { todayISO });
    const rows = await db.select<{ d: string }>(
      'SELECT DISTINCT snapshot_date AS d FROM account_snapshots ORDER BY d',
    );
    expect(rows.map((r) => r.d)).toEqual([close, todayISO]);
  });

  it.each(['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'])(
    'identical snapshot dates under TZ=%s — string-pure over todayISO on a month boundary (D-R2-5)',
    async (tz) => {
      // The discriminating case: a UTC parse of '2026-07-01' (`new Date(iso)`)
      // is June 30 in Los Angeles and would put the close row in MAY; the
      // local-midnight inverse (dateFromLocalISO) keeps July → June 30 under
      // every zone. Same process.env.TZ idiom as the local-vs-UTC pin above.
      const prevTZ = process.env.TZ;
      process.env.TZ = tz;
      try {
        await seedSampleProfile(db, { todayISO: '2026-07-01' });
        const rows = await db.select<{ d: string }>(
          'SELECT DISTINCT snapshot_date AS d FROM account_snapshots ORDER BY d',
        );
        expect(rows.map((r) => r.d)).toEqual(['2026-06-30', '2026-07-01']);
      } finally {
        if (prevTZ === undefined) delete process.env.TZ;
        else process.env.TZ = prevTZ;
      }
    },
  );

  it('the seed reads the real clock exactly once — the app-wide acceptance INSTANT (D-R2-6)', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../src/domain/sample-profile/sample-profile.ts'),
      'utf8',
    );
    // Strip // line comments and docblock lines so prose never counts.
    const stripped = src
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, ''))
      .join('\n');
    expect(stripped.match(/new Date\(\)/g)).toHaveLength(1);
    expect(stripped).not.toMatch(/lastMonthYyyymm\(new Date\(\)\)/);
  });
});

/** RoadmapContext/InterviewContext from the SEEDED DB through the production
 *  row mappers — never inline SQL semantics (the anchor pins the app's
 *  arithmetic, not the test's).
 *
 *  Harness note (plan Task 3 Step 1): `useSnapshotsStore.load` reads every
 *  account_snapshots row via raw SQL; `AccountSnapshotsRepo` exposes no
 *  `list()`, and `latestSnapshotValue` is max-date-per-account either way, so
 *  `listLatestPerAccount()` produces an identical `totalCashReserve`. */
async function seededCtx(db: SqliteAdapter, asOfLocalISO: string): Promise<InterviewContext> {
  const household = (await new HouseholdRepo(db).get())!;
  return {
    household,
    persons: await new PersonsRepo(db).list(),
    accounts: await new AccountsRepo(db).list(),
    loans: await new LoansRepo(db).list(),
    contributions: [],
    snapshots: await new AccountSnapshotsRepo(db).listLatestPerAccount(),
    transactions: await new TransactionsRepo(db).list(),
    categories: await new CategoriesRepo(db).list(),
    overrides: new Map(),
    thresholds: getInterestThresholds(household),
    taxYear: 2026,
    today: dateFromLocalISO(asOfLocalISO),
    vehicles: [], assetValueSnapshots: [], settings: null, holdings: [], tickers: [],
    dependents: [], properties: [], housingPayments: [], interviewAnswers: new Map(),
  } as InterviewContext;
}

describe('R1 historical anchors — the shipped seed through the production mappers', () => {
  let db: SqliteAdapter;
  beforeEach(async () => {
    db = await freshDb();
  });

  /** R2 made the seed pure over `todayISO` (sample-profile.ts `priorMonthClose`,
   *  D-R2-5), so no clock pin is needed: seeding 2026-07-08 writes close rows
   *  on 2026-06-30 on ANY run date. If a real-clock read ever returns to a
   *  close site these anchors go RED on cash ($29,400 from the close rows
   *  instead of $30,000) — that is the point; do not re-add
   *  `vi.useFakeTimers` here (D-R2-4). */
  async function seedAt(todayISO: string): Promise<void> {
    await seedSampleProfile(db, { todayISO });
  }

  // Seed month July 2026: complete months Apr/May/Jun at $5,911.12; four July
  // rows ($179.01 real) clamped to the 1st. Under the complete-month rule the
  // figure is $5,911.12 on EVERY day of July; the recorded bug read
  // (3 × 5,911.12 + 179.01) / 4 = $4,478.09 on every one of them.
  // Review MINOR 10: the dollar SIGNS are out of this title on purpose. Vitest
  // reads a bare `$5` / `$3` in an it.each title as object-path interpolation
  // and printed `undefined,911.12` / `undefined,000` in the reporter (and `$$`
  // is not unescaped here either — it prints two dollar signs). The figures are
  // unchanged and the assertions below carry them with their `$`.
  it.each(['2026-07-01', '2026-07-08', '2026-07-31'])('seed 2026-07-08, as of %s → 5,911.12 from 3 months, cash 30,000', async (asOf) => {
    await seedAt('2026-07-08');
    const ctx = await seededCtx(db, asOf);
    const ef = efContext(ctx);
    expect(ef.baseline).toBeCloseTo(5911.12, 2);
    expect(ef).toMatchObject({ cash: 30_000, baselineSource: 'transactions', monthsObserved: 3 });
    expect(evaluateSmallEmergencyFund(ctx).evidence).toBe('$30,000 cash ≥ $5,911 target from 3 months of spending');
  });

  it('seed on the 1st (rows clamp onto 2026-07-01) reads the same figure', async () => {
    await seedAt('2026-07-01');
    const ef = efContext(await seededCtx(db, '2026-07-01'));
    expect(ef.baseline).toBeCloseTo(5911.12, 2);
    expect(ef.monthsObserved).toBe(3);
  });

  it('DOCUMENTATION PIN (D-R1-P9, R2 chip): across a session boundary the July stub becomes a thin complete month', async () => {
    // The explore DB is rebuilt on every boot (init.ts initExploreDatabase), so
    // this state is reachable only by holding one session across a local
    // month-end. It is the R1-F6 class on the LAST month, which the guard does
    // not cover (the seed's first real row is on the 1st).
    // R2 made the close date follow todayISO; the seed's MONTHS are unchanged (m−3 … m−1 + the current-month stubs), so this pin stands as written — the stub-month class itself remains a chip (R2 plan Task 9 Step 6).
    await seedAt('2026-07-08');
    const ctx = await seededCtx(db, '2026-08-01');
    expect(efContext(ctx).baseline).toBeCloseTo(4478.09, 2); // (3 × 5,911.12 + 179.01) / 4
    expect(evaluateSmallEmergencyFund(ctx).evidence).toBe('$30,000 cash ≥ $4,478 target from 4 months of spending');
  });

  it('$10,000 one-time on the seed: the three-card split under the complete-month baseline', async () => {
    await seedAt('2026-07-08');
    const ctx = await seededCtx(db, '2026-07-08');
    const input = { amountCents: 1_000_000, cadence: 'one-time' as const };
    // 6× = $35,466.72 → gap $5,466.72 = 546,672¢; remainder 453,328¢ to the 5–8% band (Mortgage 6.25%).
    const conservative = splitAmount(input, 'conservative', ctx);
    expect(conservative.rows).toEqual([{ bucket: 'ef_target', amountCents: 546_672 }, { bucket: 'mid_rate_debt', amountCents: 453_328 }]);
    // Moderate (6× assumed — no job-stability answer in the seed): 50/50 of the post-B4 remainder.
    const moderate = splitAmount(input, 'moderate', ctx);
    expect(moderate.rows).toEqual([
      { bucket: 'ef_target', amountCents: 546_672 }, { bucket: 'mid_rate_debt', amountCents: 226_664 }, { bucket: 'invest', amountCents: 226_664 },
    ]);
    expect(moderate.efAssumed).toBe(true);
    // Aggressive (3× = $17,733.36 ≤ $30,000): EF covered → everything invests.
    const aggressive = splitAmount(input, 'aggressive', ctx);
    expect(aggressive.rows).toEqual([{ bucket: 'invest', amountCents: 1_000_000 }]);
    // CI-10 is unchanged kernel copy; the multiple is now the honest 5.1× (30,000 / 5,911.12 = 5.075).
    const floorSkip = 'Emergency fund already at 5.1× monthly expenses — skipped.';
    for (const s of [conservative, moderate, aggressive]) {
      expect(s.skipped.find((k) => k.bucket === 'ef_floor')?.reason).toBe(floorSkip);
    }
    expect(aggressive.skipped.find((k) => k.bucket === 'ef_target')?.reason).toBe(floorSkip);
  });
});

/** PaycheckCard.tsx's own `annual` assembly, off the SEEDED rows: FEDERAL/US
 *  + STATE/CA at the household's filing status, no city (city NULL →
 *  cityBrackets null, SD 0), the per-return pretax aggregate. The card is a
 *  summary of exactly this engine call (Wave 15 D1). */
async function seededPaycheck(db: SqliteAdapter) {
  const household = (await new HouseholdRepo(db).get())!;
  const persons = await new PersonsRepo(db).list();
  const dependents = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM dependents');
  const rules = new TaxRulesRepo(db);
  const federal = (await rules.lookup(2026, JurisdictionType.FEDERAL, 'US', household.filingStatus))!;
  const state = (await rules.lookup(2026, JurisdictionType.STATE, household.state, household.filingStatus))!;
  const { totalSalary, pretax } = aggregateHouseholdPretax(persons, {
    filingStatus: household.filingStatus,
    personCount: persons.length,
    dependentCount: dependents[0].n,
  });
  return computePaycheck({
    gross: totalSalary,
    perPersonGross: persons.map((p) => p.annualSalaryPretax),
    filingStatus: household.filingStatus,
    federalBrackets: federal.brackets,
    stateBrackets: state.brackets,
    cityBrackets: null,
    standardDeduction: {
      federal: federal.standardDeduction,
      state: state.standardDeduction,
      city: 0,
    },
    pretax,
  });
}

describe('R2 tax anchors — the MFJ seed through the production W-2 engine and the IRA-band rule (Appendix A.2 / A.3)', () => {
  let db: SqliteAdapter;
  beforeEach(async () => {
    db = await freshDb();
    await seedSampleProfile(db, { todayISO: '2026-07-08' });
  });

  it('Paycheck (household, annual): $202,179.46 take-home under MFJ — SINGLE read $179,492.63', async () => {
    const r = await seededPaycheck(db);
    expect(r.gross).toBe(325_000);                        // 180,000 + 145,000
    expect(r.pretax401k).toBe(29_600);                    // 18,000 (10%) + 11,600 (8%), both under the $24,500 cap
    expect(r.pretaxTotal).toBe(29_600);                   // health / DCFSA / HSA are 0001 defaults (0)
    expect(r.federal).toBeCloseTo(48_364, 2);             // taxable 263,200 through the 2026 MFJ schedule (0031)
    expect(r.ss).toBeCloseTo(20_150, 2);                  // 11,160 + 8,990 — per-earner bases, both under $184,500
    expect(r.medicare).toBeCloseTo(4_712.5, 2);           // 325,000 × 1.45%
    expect(r.additionalMedicare).toBeCloseTo(675, 2);     // (325,000 − 250,000) × 0.9% — SINGLE's $200k threshold read 1,125
    expect(r.fica).toBeCloseTo(25_537.5, 2);
    expect(r.stateTax).toBeCloseTo(19_319.036, 2);        // CA MFJ (0002), SD 11,080, taxable 284,320
    expect(r.cityTax).toBe(0);
    expect(r.hasCity).toBe(false);
    expect(r.hasStateTax).toBe(true);
    expect(r.takeHome).toBeCloseTo(202_179.464, 2);       // 325,000 − 29,600 − (48,364 + 25,537.5 + 19,319.036)
    // The card's Monthly strings (formatCurrency, whole dollars, halfExpand):
    expect(formatCurrency(r.takeHome / 12)).toBe('$16,848');
    expect(formatCurrency(r.federal / 12)).toBe('$4,030');
    expect(formatCurrency(r.fica / 12)).toBe('$2,128');
    expect(formatCurrency(r.stateTax / 12)).toBe('$1,610');
  });

  it('IRA band on the seed: MAGI $325,000 sits above the MFJ Roth phase-out start ($242,000) — every node states the MFJ band', async () => {
    // The seed writes no contributions rows, so MAGI = salary (computeMagi).
    const contributions = await db.select<{ n: number }>('SELECT COUNT(*) AS n FROM contributions');
    expect(contributions[0].n).toBe(0);
    const ctx = await seededCtx(db, '2026-07-08');
    expect(evaluateIraBand(ctx).evidence).toBe(
      'MAGI $325,000 is above the Roth phase-out start ($242,000). Backdoor Roth applies.',
    );
    expect(evaluateBackdoorRoth(ctx)).toMatchObject({
      status: 'active',
      evidence: 'MAGI $325,000 ≥ $242,000 (Roth phase-out start) — direct Roth contribution restricted. Be aware of the IRS pro-rata rule on any pre-tax IRA balance.',
    });
    expect(evaluateRothIra(ctx).evidence).toBe('MAGI $325,000 above $242,000 — backdoor Roth path instead.');
    expect(evaluateTraditionalIra(ctx).evidence).toBe('MAGI $325,000 above $129,000 — Roth or backdoor path applies instead.');
  });
});
