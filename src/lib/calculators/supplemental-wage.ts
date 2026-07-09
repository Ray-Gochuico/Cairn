import { computePretaxDeductions, computeBonusTax, type Bracket, type BonusTaxOutput } from '@/lib/tax';
import type { Person } from '@/types/schema';
import type { FilingStatus } from '@/types/enums';

export interface HouseholdPretax {
  pretax401k: number;
  pretaxHealth: number;
  pretaxDcfsa: number;
  pretaxHsa: number;
}

export interface AggregatedHousehold {
  totalSalary: number;
  pretax: HouseholdPretax;
}

/**
 * Sums base salary + pre-tax deductions across the supplied persons. Pass ALL
 * household persons for Bonus/Commission; pass a single-person subset (e.g.
 * `[eligiblePerson]`) for Overtime. `personCount`/`dependentCount` are the
 * household-wide counts that drive the HSA/DCFSA caps and stay the same in both
 * cases — they are NOT `personsToSum.length`.
 */
export function aggregateHouseholdPretax(
  personsToSum: Person[],
  opts: { filingStatus: FilingStatus; personCount: number; dependentCount: number },
): AggregatedHousehold {
  let totalSalary = 0;
  const pretax: HouseholdPretax = { pretax401k: 0, pretaxHealth: 0, pretaxDcfsa: 0, pretaxHsa: 0 };
  for (const p of personsToSum) {
    totalSalary += p.annualSalaryPretax;
    const d = computePretaxDeductions({
      salary: p.annualSalaryPretax,
      pretax401kPct: p.pretax401kPct,
      healthInsuranceMonthlyPremium: p.healthInsuranceMonthlyPremium,
      dcfsaMonthly: p.dependentCareFsaMonthly,
      hsaMonthly: p.hsaMonthlyContribution,
      hsaEligible: p.hsaEligible,
      filingStatus: opts.filingStatus,
      personCount: opts.personCount,
      dependentCount: opts.dependentCount,
    });
    pretax.pretax401k += d.pretax401k;
    pretax.pretaxHealth += d.pretaxHealth;
    pretax.pretaxDcfsa += d.pretaxDcfsa;
    pretax.pretaxHsa += d.pretaxHsa;
  }
  return { totalSalary, pretax };
}

export interface SupplementalWageTaxInput {
  baseSalary: number;            // aggregated base salary (no supplemental wages)
  supplementalWages: number;     // annual bonus / commission / overtime gross
  pretax: HouseholdPretax;
  filingStatus: FilingStatus;
  federalBrackets: Bracket[];
  stateBrackets: Bracket[];
  cityBrackets: Bracket[] | null;
  standardDeduction: { federal: number; state: number; city: number };
  /**
   * Wave-9 F1: per-person annual base salaries (no supplemental wages),
   * aligned with the persons the caller aggregated into `baseSalary`
   * (entries must sum to it). `recipientIndex` names the earner who receives
   * `supplementalWages` (default 0). Omitted → legacy combined-base FICA.
   */
  perPersonBaseSalary?: number[];
  recipientIndex?: number;
}

/**
 * Marginal tax on supplemental wages (bonus / commission / overtime), via the
 * with/without-bonus diff in `computeBonusTax`. Single calculators-owned entry
 * point — the v1.1 Paycheck calculator imports this rather than re-deriving it.
 */
export function computeSupplementalWageTax(input: SupplementalWageTaxInput): BonusTaxOutput {
  return computeBonusTax({
    personGross: input.baseSalary + input.supplementalWages,
    bonus: input.supplementalWages,
    pretax: input.pretax,
    filingStatus: input.filingStatus,
    federalBrackets: input.federalBrackets,
    stateBrackets: input.stateBrackets,
    cityBrackets: input.cityBrackets,
    standardDeduction: input.standardDeduction,
    perPersonBaseGross: input.perPersonBaseSalary,
    recipientIndex: input.recipientIndex,
  });
}

const FLAT_SUPPLEMENTAL_RATE = 0.22;
const FLAT_SUPPLEMENTAL_RATE_OVER_1M = 0.37;
const SUPPLEMENTAL_1M_THRESHOLD = 1_000_000;

/**
 * Federal supplemental-wage flat-withholding method: 22% up to $1M of
 * supplemental wages, 37% on the portion above $1M. This is WITHHOLDING
 * (what payroll commonly takes out), not final tax — it reconciles at filing.
 */
export function flatSupplementalWithholding(wages: number): number {
  if (wages <= 0) return 0;
  if (wages <= SUPPLEMENTAL_1M_THRESHOLD) return wages * FLAT_SUPPLEMENTAL_RATE;
  return (
    SUPPLEMENTAL_1M_THRESHOLD * FLAT_SUPPLEMENTAL_RATE +
    (wages - SUPPLEMENTAL_1M_THRESHOLD) * FLAT_SUPPLEMENTAL_RATE_OVER_1M
  );
}
