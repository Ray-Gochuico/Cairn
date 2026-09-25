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
import { answerKey } from '@/types/interview';
import { evaluateThread } from '@/domain/interview/evaluate';
import { MARKET_STRESS_THREAD } from '@/domain/interview/threads/market-stress';
import { computeMarketStress } from '@/lib/interview/market-stress';
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
import { reimbursementStatusLine } from '@/components/dialogs/TransactionEditDialog';
import { HoldingsRepo } from '@/domain/holdings';
import { HousingPaymentsRepo } from '@/domain/housing-payments';
import { VehicleLeasesRepo } from '@/domain/vehicle-leases';
import { PropertiesRepo } from '@/domain/properties';
import { VehiclesRepo } from '@/domain/vehicles';
import { AssetValueSnapshotsRepo } from '@/domain/asset-value-snapshots';
import { SettingsRepo } from '@/domain/app-settings';
import { AccountSnapshotSchema } from '@/types/schema';
import { captureRealState, projectScenario, detectMilestones, emptyLeverPayload, effectiveSwr, type MonthlyState, type RealState } from '@/lib/scenarios';
import { projectionSpending } from '@/lib/scenarios/milestones';
import type { Scenario } from '@/types/scenario';
import type { HousingPayment, VehicleLease } from '@/types/schema';
import { createHash } from 'node:crypto';

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

  it('R2 (review MINOR 3): a typed STATE holds the filing-status guard closed — the tuple is the COMPLETE 0001 row', async () => {
    // 0001 writes the singleton as (name NULL, filing_status 'SINGLE',
    // state 'CA', city NULL, monthly_expense_baseline 0). A household in New
    // York that left the filing status on SINGLE is no longer that row, so
    // the status is theirs: the guard names all five columns, not three.
    await db.execute("UPDATE household SET state = 'NY' WHERE id = 1");
    await seedSampleProfile(db, { todayISO: '2026-07-08' });
    const rows = await db.select<{ fs: string; state: string }>(
      'SELECT filing_status AS fs, state FROM household WHERE id = 1',
    );
    expect(rows[0]).toEqual({ fs: 'SINGLE', state: 'NY' });
  });

  it('R2 (review MINOR 3): a typed CITY holds it closed too — the fifth column of the tuple', async () => {
    // Unreachable through the shipped CA form today (no 'CA_*' CITY rule —
    // D-R2-2), which is exactly why it is pinned: if a CA city rule ever
    // lands, the guard already refuses to flip a row someone touched.
    await db.execute("UPDATE household SET city = 'NY_NYC' WHERE id = 1");
    await seedSampleProfile(db, { todayISO: '2026-07-08' });
    const rows = await db.select<{ fs: string; city: string | null }>(
      'SELECT filing_status AS fs, city FROM household WHERE id = 1',
    );
    expect(rows[0]).toEqual({ fs: 'SINGLE', city: 'NY_NYC' });
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

  it('R2 (review MINOR 1): the SEEDED rows render the editor status line — Appendix A.5 through the production mapper', async () => {
    // A.5 says the tour's Skyline row reads 'Reimbursed $132.40 on Jun 25,
    // 2026.' at todayISO 2026-07-08, but only a hand-typed dialog fixture
    // proved it: a drift in the seed's `monthDay(today, 1, 25)` or in its
    // reimbursed amount would leave every other R2 test green while the line
    // the tour actually shows moved. This joins the seed to the shipped
    // helper the way the tax anchors join it to computePaycheck.
    await seedSampleProfile(db, { todayISO: '2026-07-08' });
    const rows = await new TransactionsRepo(db).list();
    const skyline = rows.find((t) => t.merchant === 'Skyline Bistro');
    const harborCab = rows.find((t) => t.merchant === 'Harbor Cab Co');
    expect(skyline).toBeDefined();
    expect(harborCab).toBeDefined();
    expect(reimbursementStatusLine(skyline!)).toBe('Reimbursed $132.40 on Jun 25, 2026.');
    expect(reimbursementStatusLine(harborCab!)).toBe('Awaiting reimbursement.');
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
    // Review MINOR 2/5 — three more discriminating rows (weekdays derived
    // from Jan 1 2026 = Thursday, Appendix A.4 style):
    ['2028-03-01', '2028-02-29'], // leap February: Jan 1 2028 = Sat (2026, 2027 are
                                  // common years, +365 ≡ 1 each); Feb 1 = +31 ≡ 3 → Tue;
                                  // Feb 29 = +28 ≡ 0 → Tue, a business day and the 29th
                                  // exists — an off-by-one in `Date.UTC(y, m, 0)` reads
                                  // Feb 28 or Mar 1 here
    ['2027-01-31', '2026-12-31'], // a 31st as the SEED day + the December rollover:
                                  // Dec 1 2026 = +334 ≡ 5 → Tue, Dec 31 = +30 ≡ 2 → Thu
    ['2026-11-01', '2026-10-30'], // weekend month-end #2 (so the business-day rule keeps a
                                  // killer in every run month): Oct 1 2026 = +273 ≡ 0 → Thu,
                                  // Oct 31 = +30 ≡ 2 → Sat → step back to Fri Oct 30
  ])('seed %s → prior-month close %s (business-day + rollover arithmetic, no clock)', async (todayISO, close) => {
    await seedSampleProfile(db, { todayISO });
    const rows = await db.select<{ d: string }>(
      'SELECT DISTINCT snapshot_date AS d FROM account_snapshots ORDER BY d',
    );
    expect(rows.map((r) => r.d)).toEqual([close, todayISO]);
  });

  it.each(['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Pacific/Pago_Pago', 'America/Santiago'])(
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

  it('a seed day whose LOCAL midnight does not exist still closes the prior month — TZ=America/Santiago, 2026-09-06 (review MINOR 2)', async () => {
    // Chile's DST begins at local midnight on Sunday 2026-09-06 (the first
    // Sunday of September: Sep 1 2026 = Jan 1 + 243 ≡ 5 → Tue), so 00:00
    // does not exist that day and `dateFromLocalISO` relies on the engine
    // rolling a gap FORWARD (to 01:00, still Sept 6). A roll BACKWARD would
    // read September 5 — same month here, but the same gap on the 1st of a
    // month would read the previous month and move the close a month early.
    // The close is the last business day of August: Aug 1 2026 = Jan 1 + 212
    // ≡ 2 → Sat, Aug 31 = +30 ≡ 2 → Mon, a business day.
    const prevTZ = process.env.TZ;
    process.env.TZ = 'America/Santiago';
    try {
      await seedSampleProfile(db, { todayISO: '2026-09-06' });
      const rows = await db.select<{ d: string }>(
        'SELECT DISTINCT snapshot_date AS d FROM account_snapshots ORDER BY d',
      );
      expect(rows.map((r) => r.d)).toEqual(['2026-08-31', '2026-09-06']);
    } finally {
      if (prevTZ === undefined) delete process.env.TZ;
      else process.env.TZ = prevTZ;
    }
  });

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

/** The What-If RealState from the SEEDED DB through the production mappers —
 *  useRealState's exact recipe (snapshots via the store's own SQL; tax rules =
 *  the most recent seeded year, as loadAvailableYears resolves; loanPayments
 *  []; startISO = the seed day's month). Never inline SQL semantics. */
async function seededReal(db: SqliteAdapter, todayISO: string): Promise<RealState> {
  const household = (await new HouseholdRepo(db).get())!;
  const snapRows = await db.select<Record<string, unknown>>('SELECT * FROM account_snapshots ORDER BY snapshot_date ASC, id ASC');
  const accountSnapshots = snapRows.map((r) => AccountSnapshotSchema.parse({
    id: r.id, accountId: r.account_id, snapshotDate: r.snapshot_date, totalValue: r.total_value, source: r.source,
  }));
  const taxRepo = new TaxRulesRepo(db);
  const years = await taxRepo.listDistinctYears();
  const settings = await new SettingsRepo(db).get();
  return captureRealState({
    accounts: await new AccountsRepo(db).list(),
    accountSnapshots,
    holdings: await new HoldingsRepo(db).listAll(),
    loans: await new LoansRepo(db).list(),
    loanPayments: [],
    transactions: await new TransactionsRepo(db).list(),
    categories: await new CategoriesRepo(db).list(),
    household,
    persons: await new PersonsRepo(db).list(),
    appSettings: {
      defaultInflation: settings?.defaultInflation ?? 0.025,
      defaultReturnRate: settings?.defaultReturnRate ?? 0.07,
      defaultCashApy: settings?.defaultCashApy ?? null,
      defaultDrawdownTaxRate: settings?.defaultDrawdownTaxRate ?? null,
    },
    startISO: todayISO.slice(0, 7),
    taxRules: years.length ? await taxRepo.listForYear(Math.max(...years)) : [],
    housingPayments: await new HousingPaymentsRepo(db).list(),
    vehicleLeases: await new VehicleLeasesRepo(db).list(),
    properties: await new PropertiesRepo(db).list(),
    vehicles: await new VehiclesRepo(db).list(),
    assetValueSnapshots: await new AssetValueSnapshotsRepo(db).list(),
  });
}

describe('C2 historical anchors — the seeded Baseline through the production mappers (Appendix A; seed day 2026-07-08 → startISO 2026-07)', () => {
  let db: SqliteAdapter;
  const SEED_DAY = '2026-07-08';
  beforeEach(async () => {
    db = await freshDb();
    await seedSampleProfile(db, { todayISO: SEED_DAY });
  });
  /** Both gates (household M2 + the C2 per-month authored gate) when c2Gate is true; M2 alone otherwise.
   *  The C2 gate reads the ENGINE's own per-month stamp (MonthlyState.authoredExpenses) — exactly what
   *  the page's detectMilestones call sees. c2Gate false = the pre-C2 engine's states: the same states
   *  without the stamp (every other field byte-identical — the matrix pin below). */
  const milestonesOf = (real: RealState, payload: ReturnType<typeof emptyLeverPayload>, c2Gate: boolean) => {
    const scenario = { id: 1, leverPayload: payload } as unknown as Scenario;
    const projected = projectScenario(real, payload, { startISO: real.startISO, months: 360 });
    const states = c2Gate ? projected : projected.map(withoutStamp);
    return detectMilestones(states, {
      withdrawalRate: effectiveSwr(scenario, real.household),
      monthlyExpenseBaseline: real.household.monthlyExpenseBaseline,
    });
  };
  // The pre-C2 factory default, spelled out — the anti-pin's payload.
  const CUSTOM_ZERO = () => ({ ...emptyLeverPayload(), expenseSource: 'custom' as const, customMonthly: 0 });

  it('captures the spending average the Roadmap states: $5,911.12 from 3 complete months (MFJ, baseline $6,000, 2.4% inflation)', async () => {
    const real = await seededReal(db, SEED_DAY);
    expect(real.household.filingStatus).toBe('MFJ');
    expect(real.household.monthlyExpenseBaseline).toBe(6000);
    expect(real.household.inflationAssumption).toBeCloseTo(0.024, 6);
    expect(real.expenseBasis.rolling12m).toBeCloseTo(5911.12, 2);
    expect(real.expenseBasis.rolling12mMonths).toBe(3);
    expect(real.expenseBasis.latestMonth).toBeCloseTo(5911.12, 2);
    expect((real.housingPayments ?? []).length).toBe(0);
  });

  it('the factory Baseline (rolling12m) spends $5,911.12 in month 1 (inflated) and reaches FI 2033-03; NW30y $9,072,583.18', async () => {
    const real = await seededReal(db, SEED_DAY);
    const p = emptyLeverPayload();
    const states = projectScenario(real, p, { startISO: real.startISO, months: 360 });
    expect(states[1].expenses).toBeCloseTo(5923.30, 2);                 // 5,911.12 × one month of 2.4%/yr
    // C2 review: the engine stamps the AUTHORED share of that month's spending — the whole of it here
    // (no rent or lease on file), in the same nominal dollars.
    expect(states[1].authoredExpenses).toBe(states[1].expenses);
    const m = milestonesOf(real, p, true);                               // FI 2033-03 holds under the C2 gate
    expect(m.financialIndependenceISO).toBe('2033-03');
    expect(m.debtFreeISO).toBe('2046-01');
    expect(m.retirementISO).toBe('2052-10');
    expect(m.netWorth30y).toBeCloseTo(9_072_583.18, 2);
  });

  it('ANTI-PIN — the pre-C2 custom/0 Baseline spent $0 and read FI undefined while its NW30y was $12,216,365.93 (the silent $0)', async () => {
    const real = await seededReal(db, SEED_DAY);
    const states = projectScenario(real, CUSTOM_ZERO(), { startISO: real.startISO, months: 360 });
    expect(states[1].expenses).toBe(0);
    const legacy = milestonesOf(real, CUSTOM_ZERO(), false);
    expect(legacy.financialIndependenceISO).toBeUndefined();               // `s.expenses > 0` never held
    expect(legacy.netWorth30y).toBeCloseTo(12_216_365.93, 2);
    expect(milestonesOf(real, CUSTOM_ZERO(), true).financialIndependenceISO).toBeUndefined();
  });

  it('the household-baseline scenario (custom/$6,000 — what an untouched Send now carries) reads FI 2033-07; NW30y $9,025,313.05', async () => {
    const real = await seededReal(db, SEED_DAY);
    const p = { ...emptyLeverPayload(), expenseSource: 'custom' as const, customMonthly: 6000 };
    const m = milestonesOf(real, p, false);
    expect(m.financialIndependenceISO).toBe('2033-07');
    expect(m.netWorth30y).toBeCloseTo(9_025_313.05, 2);
  });

  it('THE HAZARD (investigation §E): transactions deleted + one $2,500 rent → the shipped gate read FI 2026-08 from rent alone for BOTH defaults', async () => {
    await db.execute('DELETE FROM transactions');
    await db.execute(
      `INSERT INTO housing_payments (household_id, name, monthly_amount, start_date, end_date) VALUES (1, 'Rent', 2500, '2026-01-01', NULL)`,
    );
    const real = await seededReal(db, SEED_DAY);
    expect(real.expenseBasis.rolling12m).toBe(0);
    expect(real.expenseBasis.rolling12mMonths).toBe(0);
    const states = projectScenario(real, emptyLeverPayload(), { startISO: real.startISO, months: 360 });
    expect(states[1].expenses).toBeCloseTo(2505.15, 2);                 // rent alone, inflated one month
    const withBaseline = { ...emptyLeverPayload(), expenseSource: 'custom' as const, customMonthly: 6000 };
    // rolling12m resolves 0 with no complete month — the SAME false date the custom/0 default gave.
    expect(milestonesOf(real, emptyLeverPayload(), false).financialIndependenceISO).toBe('2026-08');
    expect(milestonesOf(real, CUSTOM_ZERO(), false).financialIndependenceISO).toBe('2026-08');
    // … and the C2 gate (the engine's per-month authored stamp is $0 in every month) reads none for both — the G11 row says why.
    expect(milestonesOf(real, emptyLeverPayload(), true).financialIndependenceISO).toBeUndefined();
    expect(milestonesOf(real, CUSTOM_ZERO(), true).financialIndependenceISO).toBeUndefined();
    // A scenario WITH an authored expense keeps its date under both gates.
    expect(milestonesOf(real, withBaseline, true).financialIndependenceISO).toBe('2045-01');
    expect(milestonesOf(real, CUSTOM_ZERO(), false).netWorth30y).toBeCloseTo(10_886_760.56, 2);
    expect(milestonesOf(real, withBaseline, false).financialIndependenceISO).toBe('2045-01');
    expect(milestonesOf(real, withBaseline, false).netWorth30y).toBeCloseTo(7_693_055.21, 2);
  });

  // ── C2 review (UPHELD 0/1/2, MINOR 0/4): the FI gate holds PER MONTH, on the engine's own stamp ──
  // Every figure below is HEAD-derived (b253d2ff) for the ungated dates; the gated ones are the fix's.
  /** The hazard seed (investigation §E; the plan's A.3): transactions deleted + one $2,500 rent. */
  const hazardReal = async () => {
    await db.execute('DELETE FROM transactions');
    await db.execute(
      `INSERT INTO housing_payments (household_id, name, monthly_amount, start_date, end_date) VALUES (1, 'Rent', 2500, '2026-01-01', NULL)`,
    );
    return seededReal(db, SEED_DAY);
  };
  type Payload = ReturnType<typeof emptyLeverPayload>;
  const withPeriods = (p: Payload, expensePeriods: Payload['expensePeriods']): Payload => ({ ...p, expensePeriods });
  const statesOf = (real: RealState, p: Payload) => projectScenario(real, p, { startISO: real.startISO, months: 360 });
  const P4 = () => withPeriods(CUSTOM_ZERO(), [{ start: '2026-07-01', monthlyDelta: 20_000, durationMonths: 3 }]);
  const P5 = () => withPeriods(CUSTOM_ZERO(), [{ start: '2026-07-01', monthlyDelta: 3_000, durationMonths: 6 }]);
  const P6 = () => withPeriods(emptyLeverPayload(), [{ start: '2026-07-01', monthlyDelta: 500, durationMonths: 1 }]);
  const B5 = () => withPeriods(CUSTOM_ZERO(), [{ start: '2026-07-01', monthlyDelta: 3_000, durationMonths: 480 }]);
  // The '+ Add period' default: a start on today's full date, mid-month in the start month.
  const MID = () => withPeriods(CUSTOM_ZERO(), [{ start: '2026-07-15', monthlyDelta: 3_000, durationMonths: 480 }]);
  // Permanent spending that begins 12 months out.
  const FUTURE = () => withPeriods(CUSTOM_ZERO(), [{ start: '2027-07-01', monthlyDelta: 3_000, durationMonths: 480 }]);

  it('ANTI-PIN (UPHELD 0; P4/P5/P6) — a period that ENDS on a $0 base no longer buys an FI date from rent alone', async () => {
    const real = await hazardReal();
    // Ungated (the pre-C2 engine; HEAD's month-0 gate read the same dates): FI once the period ends.
    expect(milestonesOf(real, P4(), false).financialIndependenceISO).toBe('2026-10');
    expect(milestonesOf(real, P5(), false).financialIndependenceISO).toBe('2027-01');
    expect(milestonesOf(real, P6(), false).financialIndependenceISO).toBe('2026-08');   // the shipped defect's exact date
    // … where the month's spending is the rent alone and the scenario authors none of it.
    const at = statesOf(real, P4()).find((s) => s.monthISO === '2026-10')!;
    expect(at.expenses).toBeCloseTo(2515.48, 2);
    expect(at.authoredExpenses).toBe(0);
    // Gated per month: no FI date for any of the three.
    for (const p of [P4(), P5(), P6()]) expect(milestonesOf(real, p, true).financialIndependenceISO).toBeUndefined();
    // The other milestones are untouched by the gate.
    expect(milestonesOf(real, P4(), true).netWorth30y).toBeCloseTo(10_846_636.89, 2);
    expect(milestonesOf(real, P6(), true).netWorth30y).toBeCloseTo(10_886_760.56, 2);
  });

  it('G11 facts on the hazard seed: $0 authored in every month → named (rent is spent); a period the engine spends keeps it silent', async () => {
    const real = await hazardReal();
    // P6's one-month period covers only the start month, which the engine seeds and never spends.
    for (const p of [CUSTOM_ZERO(), emptyLeverPayload(), P6()]) {
      expect(projectionSpending(statesOf(real, p))).toEqual({ authorsSpending: false, spendsAnything: true });
    }
    for (const p of [P4(), P5(), B5(), MID(), FUTURE()]) {
      expect(projectionSpending(statesOf(real, p)).authorsSpending).toBe(true);
    }
  });

  it('UPHELD 1 — a period starting mid-month in the start month is judged as the engine spends it: the B5 date, not "FI —"', async () => {
    const real = await hazardReal();
    // The engine spends a 2026-07-15 start from 2026-08 — exactly as it spends a 2026-07-01 start (month 0 is the seed).
    expect(statesOf(real, MID()).map((s) => s.expenses)).toEqual(statesOf(real, B5()).map((s) => s.expenses));
    expect(milestonesOf(real, MID(), true).financialIndependenceISO).toBe('2031-12');
    expect(milestonesOf(real, B5(), true).financialIndependenceISO).toBe('2031-12');     // B5 control: unchanged from HEAD
    expect(milestonesOf(real, B5(), true).netWorth30y).toBeCloseTo(9_291_234.12, 2);
  });

  it('MINOR 0 — a future-start period: FI can land only on/after its start (never on rent alone before it)', async () => {
    const real = await hazardReal();
    expect(milestonesOf(real, FUTURE(), false).financialIndependenceISO).toBe('2026-08');  // ungated: rent alone
    const states = statesOf(real, FUTURE());
    const gated = milestonesOf(real, FUTURE(), true).financialIndependenceISO;
    expect(gated).toBeDefined();
    expect(gated! >= '2027-07').toBe(true);
    // Engine-consistent: the gated date IS the ungated scan restricted to the months the scenario authors spending.
    const fromStart = detectMilestones(states.filter((s) => s.monthISO >= '2027-07').map(withoutStamp), {
      withdrawalRate: 0.04, monthlyExpenseBaseline: real.household.monthlyExpenseBaseline,
    }).financialIndependenceISO;
    expect(gated).toBe(fromStart);
    expect(gated).toBe(FUTURE_HAZARD_FI);
  });

  it('the untouched seed (no rent): B5 keeps 2026-08; the mid-month and future-start shapes read their true dates', async () => {
    const real = await seededReal(db, SEED_DAY);
    expect(milestonesOf(real, B5(), true).financialIndependenceISO).toBe('2026-08');
    expect(milestonesOf(real, B5(), true).netWorth30y).toBeCloseTo(10_620_839.49, 2);
    expect(milestonesOf(real, MID(), true).financialIndependenceISO).toBe('2026-08');   // HEAD hid it (UPHELD 1)
    expect(milestonesOf(real, FUTURE(), true).financialIndependenceISO).toBe('2027-07'); // HEAD hid it (MINOR 0)
    // A $0 base with nothing on file spends nothing at all → G11's "nothing is spent" variant.
    expect(projectionSpending(statesOf(real, CUSTOM_ZERO()))).toEqual({ authorsSpending: false, spendsAnything: false });
    expect(milestonesOf(real, CUSTOM_ZERO(), true).financialIndependenceISO).toBeUndefined();
  });

  it('BYTE-IDENTITY — the authored stamp is additive: every pre-existing MonthlyState field is unchanged for every stored payload shape (digests recorded at b253d2ff, 480 months)', async () => {
    const real = await seededReal(db, SEED_DAY);
    const RENT: HousingPayment = { id: 901, householdId: 1, ownerPersonId: null, name: 'Rent', monthlyAmount: 2_500, startDate: '2026-01-01', endDate: null };
    const LEASE: VehicleLease = { id: 902, householdId: 1, ownerPersonId: null, name: 'Lease', monthlyAmount: 450, startDate: '2026-01-01', endDate: '2028-06-30' };
    const FROM_START = [{ start: '2026-07-01', monthlyDelta: 3_000, durationMonths: 480 }];
    const MIXED = [
      { start: '2026-07-01', monthlyDelta: 20_000, durationMonths: 3 },   // temporary, from the start month
      { start: '2026-09-24', monthlyDelta: 1_200, durationMonths: 18 },   // mid-month start
      { start: '2027-07-01', monthlyDelta: 3_000, durationMonths: 480 },  // future-start, permanent
      { start: '2028-01-01', monthlyDelta: -400, durationMonths: 12 },    // a reduction
    ];
    const withoutKeys = (p: Payload): Payload => {
      const q: Partial<Payload> = { ...p };
      delete q.expenseSource;
      delete q.customMonthly;
      return q as Payload;
    };
    const noBasis = { ...real, expenseBasis: undefined } as unknown as RealState;
    const owing: RealState = { ...real, housingPayments: [RENT], vehicleLeases: [LEASE] };
    const MATRIX: Array<[string, Payload, RealState, string]> = [
      ['custom/0', CUSTOM_ZERO(), real, 'd072df6276ab133eb2673d2a0a7719c61cca9a2da08fc9470cc713178baef92a'],
      ['custom/4000', { ...CUSTOM_ZERO(), customMonthly: 4_000 }, real, '4e2c6706c802fad4e876579f4703681225e6c081960cac33d3ee2900451ed5cc'],
      ['rolling12m, basis captured', emptyLeverPayload(), real, '054e3d529df40175976f52675f01fd0dce8b3d775e7c349a9860f02b099827c0'],
      ['rolling12m, RealState without expenseBasis', emptyLeverPayload(), noBasis, 'd072df6276ab133eb2673d2a0a7719c61cca9a2da08fc9470cc713178baef92a'],
      ['latestMonth', { ...emptyLeverPayload(), expenseSource: 'latestMonth' }, real, '054e3d529df40175976f52675f01fd0dce8b3d775e7c349a9860f02b099827c0'],
      ['periods-only from the start month (B5)', withPeriods(CUSTOM_ZERO(), FROM_START), real, '0c3d91db8854c0c6973fedb2c769d7554ec855c0cf49c7ac8aa12006b04d6f83'],
      ['pre-Feature-B row (no expenseSource / customMonthly keys)', withoutKeys(withPeriods(emptyLeverPayload(), FROM_START)), real, '0c3d91db8854c0c6973fedb2c769d7554ec855c0cf49c7ac8aa12006b04d6f83'],
      ['pre-Feature-B row, RealState without expenseBasis', withoutKeys(withPeriods(emptyLeverPayload(), MIXED)), noBasis, 'f6dfeccf6d98023e8231008c7bbf1b0a0bc2ac1d31d8d2a3759c8da6914ff8a6'],
      ['obligations present (rent + an ending lease), rolling12m + mixed periods', withPeriods(emptyLeverPayload(), MIXED), owing, '52f15dda759e1950d27c8d6feff81d6d0e8f800feeedc4db3f7f000bd576d03c'],
      ['obligations present, custom/0 (the hazard shape)', CUSTOM_ZERO(), owing, '3f06fbf6d97bc6f48a17e6cc6a3c85336b60661a81dfcf1394fcae0ab2e47fc6'],
      ['custom/1,500 + mixed periods, sequential drawdown at 20%', { ...withPeriods(CUSTOM_ZERO(), MIXED), customMonthly: 1_500, withdrawalStrategy: 'sequential', effectiveDrawdownTaxRate: 0.2 }, real, 'e592d146ab98e33f04e4065f8b2924e44acced552f292cfd46eafbc90f5fe77a'],
    ];
    for (const [name, p, r, recorded] of MATRIX) {
      const states = projectScenario(r, p, { startISO: r.startISO, months: 480 });
      expect(states).toHaveLength(480);
      expect(stateDigest(states), name).toBe(recorded);
    }
  });
});

// C2 review — FUTURE on the hazard seed: the first month on/after 2027-07 whose liquid covers rent + $3,000
// at the 4% rule (the engine-consistent scan in the test above derives the same month independently) —
// three months before the B5 control's 2031-12: the year spent on rent alone saved the $3,000 a month.
const FUTURE_HAZARD_FI = '2031-09';

/** The pre-C2 engine's states: the same states without the C2 per-month authored stamp. */
function withoutStamp(s: MonthlyState): MonthlyState {
  const out = { ...s };
  delete out.authoredExpenses;
  return out;
}

/** Canonical, lossless serialization (sorted keys; String(n) round-trips every double; -0 kept distinct). */
function canonical(v: unknown): string {
  if (typeof v === 'number') return Object.is(v, -0) ? '-0' : String(v);
  if (v === null || v === undefined || typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}

/** sha256 over every MonthlyState field EXCEPT the additive C2 stamp — so the digest recorded before the
 *  stamp existed must still match after it lands. */
function stateDigest(states: MonthlyState[]): string {
  const pre = states.map((s) => Object.fromEntries(Object.entries(s).filter(([k]) => k !== 'authoredExpenses')));
  return createHash('sha256').update(canonical(pre)).digest('hex');
}

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

describe('R4 seeded market-stress anchors — the shipped seed through the production mappers (Appendix A of the R4 plan)', () => {
  let db: SqliteAdapter;
  beforeEach(async () => { db = await freshDb(); });

  const withMix = (ctx: InterviewContext, mix: string): InterviewContext => ({
    ...ctx,
    interviewAnswers: new Map([[
      answerKey('market_stress', 'q_mix', ''),
      { id: 1, householdId: 1, threadId: 'market_stress', questionId: 'q_mix', subjectKey: '', valueJson: JSON.stringify(mix), questionVersion: 1, answeredAt: '2026-07-01T12:00:00.000Z', basisJson: '{"branch":"has-portfolio"}' },
    ]]),
  });

  it('seed 2026-07-08 at stocks-75: pv $935,000 (the 529 is out), Avery 38 caps the search, target $1,800,000, real 3.515625%', async () => {
    await seedSampleProfile(db, { todayISO: '2026-07-08' });
    const res = computeMarketStress(await seededCtx(db, '2026-07-08'), 'stocks-75');
    expect(res).toMatchObject({ pv: 935_000, pmt: 0, targetFv: 1_800_000, ageNow: 38, olderName: SAMPLE_PROFILE.personName, personCount: 2, fiState: 'ok' });
    expect(res.realRate).toBeCloseTo(0.03515625, 12);
    expect(res.windows.map((w) => w.delay)).toEqual([17, 21, 12, 9, 7]);
  });

  it('the six seeded strings, byte-exact, in registry order — and the assumes name the household basis', async () => {
    await seedSampleProfile(db, { todayISO: '2026-07-08' });
    const r = evaluateThread(MARKET_STRESS_THREAD, withMix(await seededCtx(db, '2026-07-08'), 'stocks-75'), '');
    if (r.state !== 'reply' || r.reply.kind !== 'plan') throw new Error('expected the plan reply');
    expect(r.reply.lines).toEqual([
      "Your $935,000 portfolio — from your latest account snapshots — replayed through five historical windows at a 75% stocks / 25% bonds mix, in today's dollars.",
      "The 1929 crash (1929–1931): $592,050 at the deepest year-end, −36.7% from today; back at today's value by 1935. FI target about 17 years later than on your assumed path.",
      "The 1970s inflation run (1973–1981): $576,821 at the deepest year-end (1974), −38.3% from today, and $629,774 at the end of 1981; back at today's value by 1984. FI target about 21 years later than on your assumed path.",
      "The dot-com crash (2000–2002): $705,575 at the deepest year-end, −24.5% from today; back at today's value by 2006. FI target about 12 years later than on your assumed path.",
      "The 2008 crash (2008): $719,455 at the deepest year-end, −23.1% from today; back at today's value by 2010. FI target about 9 years later than on your assumed path.",
      "The 2022 inflation shock (2022): $773,401 at the deepest year-end, −17.3% from today; not back at today's value by 2022, where the bundled data ends. FI target about 7 years later than on your assumed path.",
    ]);
    expect(r.reply.assumes).toContain("FI target $1,800,000 = 12 × $6,000/mo (from Household) ÷ 4% SWR — two identical whole-year solves from each window's last year, one from the replayed balance and one from your assumed path's balance; the search ends where Avery Sample reaches 90, counting from today's age.");
    expect(r.reply.assumes).toContain('Contributions: no contributions in the last 12 months.');
  });
});
