import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { PersonsRepo } from '@/domain/persons';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadInitialMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');
const loadCommissionMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0003_add_commission_columns.sql'), 'utf-8');
const loadEmploymentBonusMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0005_add_employment_and_bonus_columns.sql'), 'utf-8');

describe('PersonsRepo', () => {
  let db: SqliteAdapter;
  let repo: PersonsRepo;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: loadInitialMigration() },
      { version: '0003_add_commission_columns', sql: loadCommissionMigration() },
      { version: '0005_add_employment_and_bonus_columns', sql: loadEmploymentBonusMigration() },
    ]);
    repo = new PersonsRepo(db);
  });

  afterEach(async () => {
    await db.close();
  });

  it('returns empty array when no persons exist', async () => {
    const all = await repo.list();
    expect(all).toEqual([]);
  });

  it('creates a person and assigns an id', async () => {
    const id = await repo.create({
      householdId: 1,
      name: 'Alex',
      dateOfBirth: '1988-03-15',
      targetRetirementAge: 55,
      annualSalaryPretax: 140000,
      expectedCommission: 2000,
      expectedCommissionFrequency: 'MONTHLY',
      pretax401kPct: 0.10,
      healthInsuranceMonthlyPremium: 250,
      dependentCareFsaMonthly: 0,
      hsaMonthlyContribution: 300,
      hsaEligible: true,
    });
    expect(id).toBeGreaterThan(0);

    const all = await repo.list();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('Alex');
    expect(all[0].hsaEligible).toBe(true);
  });

  it('updates an existing person', async () => {
    const id = await repo.create({
      householdId: 1,
      name: 'Alex',
      dateOfBirth: '1988-03-15',
      targetRetirementAge: 55,
      annualSalaryPretax: 140000,
      expectedCommission: 2000,
      expectedCommissionFrequency: 'MONTHLY',
      pretax401kPct: 0.10,
      healthInsuranceMonthlyPremium: 250,
      dependentCareFsaMonthly: 0,
      hsaMonthlyContribution: 300,
      hsaEligible: true,
    });

    await repo.update(id, { annualSalaryPretax: 155000, targetRetirementAge: 50 });

    const all = await repo.list();
    expect(all[0].annualSalaryPretax).toBe(155000);
    expect(all[0].targetRetirementAge).toBe(50);
  });

  it('deletes a person', async () => {
    const id = await repo.create({
      householdId: 1,
      name: 'Alex',
      dateOfBirth: '1988-03-15',
      targetRetirementAge: 55,
      annualSalaryPretax: 140000,
      expectedCommission: 0,
      expectedCommissionFrequency: 'MONTHLY',
      pretax401kPct: 0,
      healthInsuranceMonthlyPremium: 0,
      dependentCareFsaMonthly: 0,
      hsaMonthlyContribution: 0,
      hsaEligible: false,
    });

    await repo.delete(id);
    const all = await repo.list();
    expect(all).toEqual([]);
  });

  it('rejects invalid person on create', async () => {
    await expect(
      repo.create({
        householdId: 1,
        name: 'Alex',
        dateOfBirth: '2050-01-01',
        targetRetirementAge: 55,
        annualSalaryPretax: 140000,
        expectedCommission: 0,
        expectedCommissionFrequency: 'MONTHLY',
        pretax401kPct: 0,
        healthInsuranceMonthlyPremium: 0,
        dependentCareFsaMonthly: 0,
        hsaMonthlyContribution: 0,
        hsaEligible: false,
      })
    ).rejects.toThrow();
  });

  it('reads employment_type, hourly_rate, regular_hours_per_week, ot_threshold_hours_per_week', async () => {
    const id = await repo.create({
      householdId: 1,
      name: 'Bob',
      dateOfBirth: '1990-05-12',
      targetRetirementAge: 60,
      annualSalaryPretax: 80000,
      expectedCommission: 0,
      expectedCommissionFrequency: 'MONTHLY',
      pretax401kPct: 0,
      healthInsuranceMonthlyPremium: 0,
      dependentCareFsaMonthly: 0,
      hsaMonthlyContribution: 0,
      hsaEligible: false,
      employmentType: 'HOURLY',
      hourlyRate: 38.46,
      regularHoursPerWeek: 40,
      otThresholdHoursPerWeek: 8,
    });
    const p = await repo.findById(id);
    expect(p?.employmentType).toBe('HOURLY');
    expect(p?.hourlyRate).toBeCloseTo(38.46, 2);
    expect(p?.regularHoursPerWeek).toBe(40);
    expect(p?.otThresholdHoursPerWeek).toBe(8);
  });

  it('reads expected_bonus, expected_bonus_frequency, bonus_is_consistent', async () => {
    const id = await repo.create({
      householdId: 1,
      name: 'Carol',
      dateOfBirth: '1985-11-03',
      targetRetirementAge: 65,
      annualSalaryPretax: 120000,
      expectedBonus: 15000,
      expectedBonusFrequency: 'QUARTERLY',
      bonusIsConsistent: false,
      expectedCommission: 0,
      expectedCommissionFrequency: 'MONTHLY',
      pretax401kPct: 0,
      healthInsuranceMonthlyPremium: 0,
      dependentCareFsaMonthly: 0,
      hsaMonthlyContribution: 0,
      hsaEligible: false,
    });
    const p = await repo.findById(id);
    expect(p?.expectedBonus).toBe(15000);
    expect(p?.expectedBonusFrequency).toBe('QUARTERLY');
    expect(p?.bonusIsConsistent).toBe(false);
  });

  it('defaults to SALARY_NO_OT, ANNUAL bonus, consistent=true for existing rows', async () => {
    const id = await repo.create({
      householdId: 1,
      name: 'Old',
      dateOfBirth: '1970-01-01',
      targetRetirementAge: 67,
      annualSalaryPretax: 60000,
      expectedCommission: 0,
      expectedCommissionFrequency: 'MONTHLY',
      pretax401kPct: 0,
      healthInsuranceMonthlyPremium: 0,
      dependentCareFsaMonthly: 0,
      hsaMonthlyContribution: 0,
      hsaEligible: false,
    });
    const p = await repo.findById(id);
    expect(p?.employmentType).toBe('SALARY_NO_OT');
    expect(p?.expectedBonusFrequency).toBe('ANNUAL');
    expect(p?.bonusIsConsistent).toBe(true);
  });
});
