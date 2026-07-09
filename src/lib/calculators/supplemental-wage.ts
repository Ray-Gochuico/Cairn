import { computeBonusTax, type Bracket, type BonusTaxOutput } from '@/lib/tax';
import { CONTRIBUTION_LIMITS_2026, dcfsaLimit, hsaLimitForHousehold } from '@/lib/contribution-limits';
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
  // Round-3 M1: DCFSA (§129) and the HSA family limit are PER-RETURN caps —
  // the old per-person computePretaxDeductions loop capped each earner
  // individually and SUMMED the results, letting a dual-earner household
  // shelter up to 2× the statutory limits (and hsaLimitForHousehold handed
  // every earner the full family cap). Mirror PaycheckCalculator's
  // aggregate-then-cap: sum the RAW elections across earners, apply each
  // per-return cap exactly once. 401(k) (§402(g)) is genuinely per-employee
  // and keeps its per-person cap.
  let totalSalary = 0;
  let pretax401k = 0;
  let healthMonthly = 0;
  let dcfsaMonthly = 0;
  let hsaMonthlyEligible = 0;
  for (const p of personsToSum) {
    totalSalary += p.annualSalaryPretax;
    pretax401k += Math.min(
      p.annualSalaryPretax * p.pretax401kPct,
      CONTRIBUTION_LIMITS_2026.EMPLOYEE_401K,
    );
    healthMonthly += p.healthInsuranceMonthlyPremium;
    dcfsaMonthly += p.dependentCareFsaMonthly;
    if (p.hsaEligible) hsaMonthlyEligible += p.hsaMonthlyContribution;
  }
  const pretaxDcfsa = Math.min(dcfsaMonthly * 12, dcfsaLimit(opts.filingStatus));
  const pretaxHsa = Math.min(
    hsaMonthlyEligible * 12,
    hsaLimitForHousehold({ personCount: opts.personCount, dependentCount: opts.dependentCount }),
  );
  return {
    totalSalary,
    pretax: { pretax401k, pretaxHealth: healthMonthly * 12, pretaxDcfsa, pretaxHsa },
  };
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
