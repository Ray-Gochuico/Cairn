import type { Database } from '@/db/db';
import { PersonSchema, type Person } from '@/types/schema';

interface PersonRow {
  id: number;
  household_id: number;
  name: string;
  date_of_birth: string;
  target_retirement_age: number;
  annual_salary_pretax: number;
  expected_bonus: number;
  expected_bonus_frequency: string;
  bonus_is_consistent: number;
  expected_commission: number;
  expected_commission_frequency: string;
  employment_type: string;
  hourly_rate: number | null;
  regular_hours_per_week: number | null;
  ot_threshold_hours_per_week: number | null;
  pretax_401k_pct: number;
  health_insurance_monthly_premium: number;
  dependent_care_fsa_monthly: number;
  hsa_monthly_contribution: number;
  hsa_eligible: number;
  job_stability: string | null;
  expects_higher_future_income: number | null;
  on_parent_health_insurance: number | null;
  is_relatively_healthy: number | null;
}

function nullableBool(v: number | null | undefined): boolean | null {
  if (v === null || v === undefined) return null;
  return v === 1;
}

function rowToPerson(row: PersonRow): Person {
  return PersonSchema.parse({
    id: row.id,
    householdId: row.household_id,
    name: row.name,
    dateOfBirth: row.date_of_birth,
    targetRetirementAge: row.target_retirement_age,
    annualSalaryPretax: row.annual_salary_pretax,
    expectedBonus: row.expected_bonus,
    expectedBonusFrequency: row.expected_bonus_frequency ?? 'ANNUAL',
    bonusIsConsistent: !!row.bonus_is_consistent,
    expectedCommission: row.expected_commission ?? 0,
    expectedCommissionFrequency: row.expected_commission_frequency ?? 'MONTHLY',
    employmentType: row.employment_type ?? 'SALARY_NO_OT',
    hourlyRate: row.hourly_rate,
    regularHoursPerWeek: row.regular_hours_per_week ?? 40,
    otThresholdHoursPerWeek: row.ot_threshold_hours_per_week,
    pretax401kPct: row.pretax_401k_pct,
    healthInsuranceMonthlyPremium: row.health_insurance_monthly_premium,
    dependentCareFsaMonthly: row.dependent_care_fsa_monthly,
    hsaMonthlyContribution: row.hsa_monthly_contribution,
    hsaEligible: row.hsa_eligible === 1,
    jobStability: row.job_stability as 'stable' | 'unstable' | null,
    expectsHigherFutureIncome: nullableBool(row.expects_higher_future_income),
    onParentHealthInsurance: nullableBool(row.on_parent_health_insurance),
    isRelativelyHealthy: nullableBool(row.is_relatively_healthy),
  });
}

export class PersonsRepo {
  constructor(private db: Database) {}

  async list(): Promise<Person[]> {
    const rows = await this.db.select<PersonRow>(
      'SELECT * FROM persons ORDER BY id ASC'
    );
    return rows.map(rowToPerson);
  }

  async create(person: Omit<Person, 'id'>): Promise<number> {
    const parsed = PersonSchema.omit({ id: true }).parse(person);
    const result = await this.db.execute(
      `INSERT INTO persons (
        household_id, name, date_of_birth, target_retirement_age,
        annual_salary_pretax, expected_bonus, expected_bonus_frequency, bonus_is_consistent,
        expected_commission, expected_commission_frequency,
        employment_type, hourly_rate, regular_hours_per_week, ot_threshold_hours_per_week,
        pretax_401k_pct, health_insurance_monthly_premium, dependent_care_fsa_monthly,
        hsa_monthly_contribution, hsa_eligible
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        parsed.householdId,
        parsed.name,
        parsed.dateOfBirth,
        parsed.targetRetirementAge,
        parsed.annualSalaryPretax,
        parsed.expectedBonus ?? 0,
        parsed.expectedBonusFrequency,
        Number(parsed.bonusIsConsistent),
        parsed.expectedCommission,
        parsed.expectedCommissionFrequency,
        parsed.employmentType,
        parsed.hourlyRate,
        parsed.regularHoursPerWeek,
        parsed.otThresholdHoursPerWeek,
        parsed.pretax401kPct,
        parsed.healthInsuranceMonthlyPremium,
        parsed.dependentCareFsaMonthly,
        parsed.hsaMonthlyContribution,
        parsed.hsaEligible ? 1 : 0,
      ]
    );
    if (!result.lastInsertId) {
      throw new Error('Failed to create person: no lastInsertId returned');
    }
    return result.lastInsertId;
  }

  async update(id: number, patch: Partial<Omit<Person, 'id' | 'householdId'>>): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`Person ${id} not found`);
    const merged = { ...existing, ...patch };
    PersonSchema.parse(merged);

    await this.db.execute(
      `UPDATE persons SET
        name = ?,
        date_of_birth = ?,
        target_retirement_age = ?,
        annual_salary_pretax = ?,
        expected_bonus = ?,
        expected_bonus_frequency = ?,
        bonus_is_consistent = ?,
        expected_commission = ?,
        expected_commission_frequency = ?,
        employment_type = ?,
        hourly_rate = ?,
        regular_hours_per_week = ?,
        ot_threshold_hours_per_week = ?,
        pretax_401k_pct = ?,
        health_insurance_monthly_premium = ?,
        dependent_care_fsa_monthly = ?,
        hsa_monthly_contribution = ?,
        hsa_eligible = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        merged.name,
        merged.dateOfBirth,
        merged.targetRetirementAge,
        merged.annualSalaryPretax,
        merged.expectedBonus ?? 0,
        merged.expectedBonusFrequency,
        Number(merged.bonusIsConsistent),
        merged.expectedCommission,
        merged.expectedCommissionFrequency,
        merged.employmentType,
        merged.hourlyRate,
        merged.regularHoursPerWeek,
        merged.otThresholdHoursPerWeek,
        merged.pretax401kPct,
        merged.healthInsuranceMonthlyPremium,
        merged.dependentCareFsaMonthly,
        merged.hsaMonthlyContribution,
        merged.hsaEligible ? 1 : 0,
        id,
      ]
    );
  }

  async delete(id: number): Promise<void> {
    await this.db.execute('DELETE FROM persons WHERE id = ?', [id]);
  }

  async findById(id: number): Promise<Person | null> {
    const rows = await this.db.select<PersonRow>(
      'SELECT * FROM persons WHERE id = ?', [id]
    );
    if (rows.length === 0) return null;
    return rowToPerson(rows[0]);
  }
}
