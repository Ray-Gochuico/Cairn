import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { EquityGrantsRepo } from '@/domain/equity-grants';
import { PersonsRepo } from '@/domain/persons';
import { commitEquityGrantImport } from '@/lib/import/commit/equity-grant';
import type { EquityGrantResolved } from '@/lib/import/validators/equity-grant';
import type { PreviewRow } from '@/lib/import/types';

function makeRow(
  rowId: number,
  status: PreviewRow['status'],
  resolved: EquityGrantResolved,
  existingId?: number,
): PreviewRow<EquityGrantResolved> {
  return { rowId, raw: {}, resolved, status, errors: [], existingId };
}

describe('commitEquityGrantImport', () => {
  let db: SqliteAdapter;
  let grantsRepo: EquityGrantsRepo;
  let personId: number;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    grantsRepo = new EquityGrantsRepo(db);
    const personsRepo = new PersonsRepo(db);
    personId = await personsRepo.create({
      householdId: 1,
      name: 'Alice',
      dateOfBirth: '1990-01-01',
      targetRetirementAge: 65,
      annualSalaryPretax: 100000,
      expectedBonus: 0,
      expectedBonusFrequency: 'ANNUAL',
      bonusIsConsistent: true,
      expectedCommission: 0,
      expectedCommissionFrequency: 'MONTHLY',
      employmentType: 'SALARY_NO_OT',
      hourlyRate: null,
      regularHoursPerWeek: 40,
      otThresholdHoursPerWeek: null,
      pretax401kPct: 0,
      healthInsuranceMonthlyPremium: 0,
      dependentCareFsaMonthly: 0,
      hsaMonthlyContribution: 0,
      hsaEligible: false,
      jobStability: null,
      expectsHigherFutureIncome: null,
      onParentHealthInsurance: null,
      isRelativelyHealthy: null,
    });
  });

  afterEach(async () => {
    await db.close();
  });

  function baseResolved(name: string): EquityGrantResolved {
    return {
      householdId: 1,
      ownerPersonId: personId,
      name,
      companyName: 'Startup Inc',
      grantDate: '2025-01-01',
      strikePrice: 0,
      totalShares: 1000,
      vestingSchedule: [
        { date: '2026-01-01', cumulativePct: 0.25 },
        { date: '2029-01-01', cumulativePct: 1.0 },
      ],
      currentFmv: 10,
      companyValuation: null,
      companyOutstandingShares: null,
      companyTotalDebt: null,
    };
  }

  it('inserts a new grant', async () => {
    const res = await commitEquityGrantImport(
      [makeRow(0, 'new', baseResolved('Series B'))],
      { db, equityGrants: grantsRepo, householdId: 1 },
    );
    expect(res.inserted).toBe(1);
    const all = await grantsRepo.list();
    expect(all).toHaveLength(1);
    expect(all[0].vestingSchedule).toHaveLength(2);
  });

  it('updates an existing grant on status=update', async () => {
    const id = await grantsRepo.create(baseResolved('Series B'));
    const next = baseResolved('Series B');
    next.totalShares = 2000;
    const res = await commitEquityGrantImport(
      [makeRow(0, 'update', next, id)],
      { db, equityGrants: grantsRepo, householdId: 1 },
    );
    expect(res.updated).toBe(1);
    const found = await grantsRepo.findById(id);
    expect(found?.totalShares).toBe(2000);
  });

  it('round-trips the vesting schedule through the schema parse', async () => {
    const res = await commitEquityGrantImport(
      [makeRow(0, 'new', baseResolved('Series B'))],
      { db, equityGrants: grantsRepo, householdId: 1 },
    );
    expect(res.inserted).toBe(1);
    const all = await grantsRepo.list();
    expect(all[0].vestingSchedule[1].cumulativePct).toBe(1.0);
  });
});
