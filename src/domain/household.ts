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
  disclaimer_accepted_at: string | null;
  disclaimer_version_accepted: string | null;
  roadmap_disclaimer_accepted_at: string | null;
  roadmap_disclaimer_version_accepted: string | null;
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
    disclaimerAcceptedAt: row.disclaimer_accepted_at,
    disclaimerVersionAccepted: row.disclaimer_version_accepted,
    roadmapDisclaimerAcceptedAt: row.roadmap_disclaimer_accepted_at,
    roadmapDisclaimerVersionAccepted: row.roadmap_disclaimer_version_accepted,
  });
}

export type DisclosureDocumentId = 'app_wide' | 'roadmap';

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

  /**
   * Cache the latest accepted disclosure version on the household row.
   * The audit trail in disclosure_acceptances is the source of truth —
   * this is just the fast-path read so AppDisclaimerGate doesn't have to
   * hit the audit table on every render.
   */
  async updateDisclosure(
    documentId: DisclosureDocumentId,
    version: string,
    acceptedAt: string,
  ): Promise<void> {
    const cols = documentId === 'app_wide'
      ? { atCol: 'disclaimer_accepted_at', verCol: 'disclaimer_version_accepted' }
      : { atCol: 'roadmap_disclaimer_accepted_at', verCol: 'roadmap_disclaimer_version_accepted' };
    await this.db.execute(
      `UPDATE household SET ${cols.atCol} = ?, ${cols.verCol} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`,
      [acceptedAt, version],
    );
  }
}
