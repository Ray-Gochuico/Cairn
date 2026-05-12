import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { HouseholdRepo } from '@/domain/household';
import { FilingStatus } from '@/types/enums';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadInitialMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');

describe('HouseholdRepo', () => {
  let db: SqliteAdapter;
  let repo: HouseholdRepo;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [{ version: '0001_initial', sql: loadInitialMigration() }]);
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
