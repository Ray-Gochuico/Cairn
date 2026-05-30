import type { Database } from '@/db/db';
import { HouseholdSchema, type Household, type GrowthScenario } from '@/types/schema';
import type { DisclosureId } from '@/legal/disclosures';

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
  interest_threshold_low_pct: number | null;
  interest_threshold_high_pct: number | null;
  has_written_ips: number | null;
  has_hsa_qualified_hdhp: number | null;
  makes_charitable_gifts: number | null;
  upcoming_large_purchase: number | null;
  upcoming_purchase_amount: number | null;
  upcoming_purchase_months: number | null;
}

function nullableBool(v: number | null | undefined): boolean | null {
  if (v === null || v === undefined) return null;
  return v === 1;
}

/**
 * Map nullable boolean → SQLite INTEGER (0/1) or NULL for write side.
 * Inverse of {@link nullableBool}.
 */
function boolToInt(v: boolean | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return v ? 1 : 0;
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
    interestThresholdLowPct: row.interest_threshold_low_pct,
    interestThresholdHighPct: row.interest_threshold_high_pct,
    hasWrittenIps: nullableBool(row.has_written_ips),
    hasHsaQualifiedHdhp: nullableBool(row.has_hsa_qualified_hdhp),
    makesCharitableGifts: nullableBool(row.makes_charitable_gifts),
    upcomingLargePurchase: nullableBool(row.upcoming_large_purchase),
    upcomingPurchaseAmount: row.upcoming_purchase_amount,
    upcomingPurchaseMonths: row.upcoming_purchase_months,
  });
}

/**
 * The id a disclosure-acceptance row carries. Derived from the disclosure
 * registry so there is ONE source of truth — registering a new disclosure
 * (its DISCLOSURES entry) is the only edit needed (W3, 2026-05-28 r2 review).
 */
export type DisclosureDocumentId = DisclosureId;

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
        interest_threshold_low_pct = ?,
        interest_threshold_high_pct = ?,
        has_written_ips = ?,
        has_hsa_qualified_hdhp = ?,
        makes_charitable_gifts = ?,
        upcoming_large_purchase = ?,
        upcoming_purchase_amount = ?,
        upcoming_purchase_months = ?,
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
        merged.interestThresholdLowPct,
        merged.interestThresholdHighPct,
        boolToInt(merged.hasWrittenIps),
        boolToInt(merged.hasHsaQualifiedHdhp),
        boolToInt(merged.makesCharitableGifts),
        boolToInt(merged.upcomingLargePurchase),
        merged.upcomingPurchaseAmount,
        merged.upcomingPurchaseMonths,
      ]
    );
  }
}
