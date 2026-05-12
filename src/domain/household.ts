import type { Database } from '@/db/db';
import { HouseholdSchema, type Household, type GrowthScenario } from '@/types/schema';

interface HouseholdRow {
  id: number;
  name: string | null;
  filing_status: string;
  state: string;
  city: string | null;
  monthly_expense_baseline: number;
  withdrawal_rate: number;
  inflation_assumption: number;
  growth_scenarios: string;
}

function rowToHousehold(row: HouseholdRow): Household {
  const growthScenarios: GrowthScenario[] = JSON.parse(row.growth_scenarios);
  return HouseholdSchema.parse({
    id: row.id,
    name: row.name,
    filingStatus: row.filing_status,
    state: row.state,
    city: row.city,
    monthlyExpenseBaseline: row.monthly_expense_baseline,
    withdrawalRate: row.withdrawal_rate,
    inflationAssumption: row.inflation_assumption,
    growthScenarios,
  });
}

export class HouseholdRepo {
  constructor(private db: Database) {}

  async get(): Promise<Household | null> {
    const rows = await this.db.select<HouseholdRow>(
      'SELECT * FROM household WHERE id = 1'
    );
    if (rows.length === 0) return null;
    return rowToHousehold(rows[0]);
  }

  async update(patch: Partial<Omit<Household, 'id'>>): Promise<void> {
    const current = await this.get();
    if (!current) {
      throw new Error('Household singleton row missing — migration may not have run');
    }
    const merged = { ...current, ...patch };
    HouseholdSchema.parse(merged);

    await this.db.execute(
      `UPDATE household SET
        name = ?,
        filing_status = ?,
        state = ?,
        city = ?,
        monthly_expense_baseline = ?,
        withdrawal_rate = ?,
        inflation_assumption = ?,
        growth_scenarios = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = 1`,
      [
        merged.name ?? null,
        merged.filingStatus,
        merged.state,
        merged.city,
        merged.monthlyExpenseBaseline,
        merged.withdrawalRate,
        merged.inflationAssumption,
        JSON.stringify(merged.growthScenarios),
      ]
    );
  }
}
