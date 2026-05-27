import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { HouseholdRepo } from '@/domain/household';
import { FilingStatus } from '@/types/enums';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const MIGRATIONS_DIR = resolve(__dirname, '../../src/db/migrations');

const loadInitialMigration = () =>
  readFileSync(resolve(MIGRATIONS_DIR, '0001_initial.sql'), 'utf-8');

/**
 * Load every migration file from src/db/migrations (in lexicographic order)
 * so repo round-trip tests see the latest schema, not just 0001. Required to
 * catch UPDATE-SQL-vs-migration column drift (W7-R1).
 */
function loadAllMigrationsSync(): { version: string; sql: string }[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({
      version: f.replace(/\.sql$/, ''),
      sql: readFileSync(resolve(MIGRATIONS_DIR, f), 'utf-8'),
    }));
}

describe('HouseholdRepo', () => {
  let db: SqliteAdapter;
  let repo: HouseholdRepo;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    // Load the full migration chain so UPDATE statements that reference
    // columns added in later migrations (e.g. 0018 roadmap rule-engine)
    // don't fail with "no such column" — see W7-R1.
    await runMigrations(db, loadAllMigrationsSync());
    repo = new HouseholdRepo(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('reads the seeded singleton household with defaults', async () => {
    const h = await repo.get();
    expect(h).not.toBeNull();
    expect(h!.id).toBe(1);
    expect(h!.filingStatus).toBe(FilingStatus.SINGLE);
    expect(h!.state).toBe('CA');
    expect(h!.withdrawalRate).toBe(0.04);
    expect(h!.growthScenarios).toHaveLength(4);
  });

  it('updates household fields', async () => {
    await repo.update({
      filingStatus: FilingStatus.MFJ,
      state: 'WA',
      city: 'Seattle',
      monthlyExpenseBaseline: 6500,
      withdrawalRate: 0.035,
      inflationAssumption: 0.03,
      growthScenarios: [{ label: 'Test', rate: 0.06 }],
    });

    const h = await repo.get();
    expect(h!.filingStatus).toBe(FilingStatus.MFJ);
    expect(h!.state).toBe('WA');
    expect(h!.city).toBe('Seattle');
    expect(h!.monthlyExpenseBaseline).toBe(6500);
    expect(h!.withdrawalRate).toBe(0.035);
    expect(h!.growthScenarios).toEqual([{ label: 'Test', rate: 0.06 }]);
  });

  it('round-trips growth_scenarios JSON correctly', async () => {
    const scenarios = [
      { label: 'Bearish', rate: 0.03 },
      { label: 'Base', rate: 0.06 },
      { label: 'Bull', rate: 0.09 },
    ];
    await repo.update({ growthScenarios: scenarios });
    const h = await repo.get();
    expect(h!.growthScenarios).toEqual(scenarios);
  });

  it('throws if update field is invalid', async () => {
    await expect(
      repo.update({ withdrawalRate: 1.5 } as any)
    ).rejects.toThrow();
  });
});

// W7-R1: The repo UPDATE SQL must list every column added by later migrations
// (0017 disclosure, 0018 roadmap rule engine). When columns are added to the
// schema but missing from UPDATE, the user-visible bug is that decision-node
// answers (e.g. "Yes I'm on an HDHP") revert on next read. Running against
// the FULL migration chain catches the drift.
describe('HouseholdRepo — W7-R1 roadmap rule-engine columns round-trip', () => {
  let db: SqliteAdapter;
  let repo: HouseholdRepo;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, loadAllMigrationsSync());
    repo = new HouseholdRepo(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('round-trips hasHsaQualifiedHdhp=true (Roadmap HDHP decision node)', async () => {
    await repo.update({ hasHsaQualifiedHdhp: true });
    const h = await repo.get();
    expect(h!.hasHsaQualifiedHdhp).toBe(true);
  });

  it('round-trips hasHsaQualifiedHdhp=false', async () => {
    await repo.update({ hasHsaQualifiedHdhp: false });
    const h = await repo.get();
    expect(h!.hasHsaQualifiedHdhp).toBe(false);
  });

  it('round-trips hasHsaQualifiedHdhp=null after being set', async () => {
    await repo.update({ hasHsaQualifiedHdhp: true });
    await repo.update({ hasHsaQualifiedHdhp: null });
    const h = await repo.get();
    expect(h!.hasHsaQualifiedHdhp).toBeNull();
  });

  it('round-trips hasWrittenIps boolean', async () => {
    await repo.update({ hasWrittenIps: true });
    expect((await repo.get())!.hasWrittenIps).toBe(true);
    await repo.update({ hasWrittenIps: false });
    expect((await repo.get())!.hasWrittenIps).toBe(false);
  });

  it('round-trips makesCharitableGifts boolean', async () => {
    await repo.update({ makesCharitableGifts: true });
    expect((await repo.get())!.makesCharitableGifts).toBe(true);
  });

  it('round-trips upcomingLargePurchase boolean', async () => {
    await repo.update({ upcomingLargePurchase: true });
    expect((await repo.get())!.upcomingLargePurchase).toBe(true);
  });

  it('round-trips upcomingPurchaseAmount and upcomingPurchaseMonths (REAL/INTEGER)', async () => {
    await repo.update({
      upcomingPurchaseAmount: 35000,
      upcomingPurchaseMonths: 18,
    });
    const h = await repo.get();
    expect(h!.upcomingPurchaseAmount).toBe(35000);
    expect(h!.upcomingPurchaseMonths).toBe(18);
  });

  it('round-trips interestThresholdLowPct and interestThresholdHighPct (REAL)', async () => {
    await repo.update({
      interestThresholdLowPct: 4.5,
      interestThresholdHighPct: 8.0,
    });
    const h = await repo.get();
    expect(h!.interestThresholdLowPct).toBe(4.5);
    expect(h!.interestThresholdHighPct).toBe(8.0);
  });

  it('does not overwrite disclosure columns on a regular update()', async () => {
    // The 4 disclosure columns are owned by updateDisclosure(); a plain update()
    // call must leave them alone.
    await repo.updateDisclosure('app_wide', 'v1', '2026-05-27T00:00:00Z');
    await repo.update({ hasHsaQualifiedHdhp: true });
    const h = await repo.get();
    expect(h!.disclaimerVersionAccepted).toBe('v1');
    expect(h!.disclaimerAcceptedAt).toBe('2026-05-27T00:00:00Z');
  });
});
