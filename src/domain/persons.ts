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
  pretax_401k_pct: number;
  health_insurance_monthly_premium: number;
  dependent_care_fsa_monthly: number;
  hsa_monthly_contribution: number;
  hsa_eligible: number;
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
    pretax401kPct: row.pretax_401k_pct,
    healthInsuranceMonthlyPremium: row.health_insurance_monthly_premium,
    dependentCareFsaMonthly: row.dependent_care_fsa_monthly,
    hsaMonthlyContribution: row.hsa_monthly_contribution,
    hsaEligible: row.hsa_eligible === 1,
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
    PersonSchema.omit({ id: true }).parse(person);
    const result = await this.db.execute(
      `INSERT INTO persons (
        household_id, name, date_of_birth, target_retirement_age,
        annual_salary_pretax, expected_bonus, pretax_401k_pct,
        health_insurance_monthly_premium, dependent_care_fsa_monthly,
        hsa_monthly_contribution, hsa_eligible
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        person.householdId,
        person.name,
        person.dateOfBirth,
        person.targetRetirementAge,
        person.annualSalaryPretax,
        person.expectedBonus,
        person.pretax401kPct,
        person.healthInsuranceMonthlyPremium,
        person.dependentCareFsaMonthly,
        person.hsaMonthlyContribution,
        person.hsaEligible ? 1 : 0,
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
        merged.expectedBonus,
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
