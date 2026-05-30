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
  });
}
