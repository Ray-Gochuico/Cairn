import { useEffect, useMemo } from 'react';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { CalculatorCard } from './CalculatorCard';
import { computePretaxDeductions, computeBonusTax } from '@/lib/tax';
import { formatCurrency, formatPercent } from '@/lib/format';

const YEAR = 2026;

export function BonusTaxCard() {
  const household = useHouseholdStore((s) => s.household);
  const persons = usePersonsStore((s) => s.persons);
  const dependents = useDependentsStore((s) => s.dependents);
  const taxItems = useTaxRulesStore((s) => s.items);
  const taxYear = useTaxRulesStore((s) => s.year);

  // Call loadYear once on mount using getState() to avoid object-reference
  // churn in the dependency array (fixes the infinite-loop risk from the plan).
  useEffect(() => {
    useTaxRulesStore.getState().loadYear(YEAR);
  }, []);

  const result = useMemo(() => {
    if (!household || persons.length === 0 || taxItems.length === 0) return null;

    const lookup = (
      jurisdictionType: 'FEDERAL' | 'STATE' | 'CITY',
      code: string,
      filingStatus: string,
    ) =>
      taxItems.find(
        (r) =>
          r.year === taxYear &&
          r.jurisdictionType === jurisdictionType &&
          r.jurisdictionCode === code &&
          r.filingStatus === filingStatus,
      ) ?? null;

    const federal = lookup('FEDERAL', 'US', household.filingStatus);
    const state = lookup('STATE', household.state, household.filingStatus);
    const city = household.city ? lookup('CITY', household.city, household.filingStatus) : null;
    if (!federal || !state) return null;

    // Accumulate across all persons (supports MFJ with two earners).
    let totalGross = 0;
    let totalBonus = 0;
    let pretax401k = 0;
    let pretaxHealth = 0;
    let pretaxDcfsa = 0;
    let pretaxHsa = 0;

    for (const p of persons) {
      totalGross += p.annualSalaryPretax + (p.expectedBonus ?? 0);
      totalBonus += p.expectedBonus ?? 0;

      const pretax = computePretaxDeductions({
        salary: p.annualSalaryPretax,
        pretax401kPct: p.pretax401kPct,
        healthInsuranceMonthlyPremium: p.healthInsuranceMonthlyPremium,
        dcfsaMonthly: p.dependentCareFsaMonthly,
        hsaMonthly: p.hsaMonthlyContribution,
        hsaEligible: p.hsaEligible,
        filingStatus: household.filingStatus,
        personCount: persons.length,
        dependentCount: dependents.length,
      });

      pretax401k += pretax.pretax401k;
      pretaxHealth += pretax.pretaxHealth;
      pretaxDcfsa += pretax.pretaxDcfsa;
      pretaxHsa += pretax.pretaxHsa;
    }

    return computeBonusTax({
      personGross: totalGross,
      bonus: totalBonus,
      pretax: { pretax401k, pretaxHealth, pretaxDcfsa, pretaxHsa },
      filingStatus: household.filingStatus,
      federalBrackets: federal.brackets,
      stateBrackets: state.brackets,
      cityBrackets: city?.brackets ?? null,
      standardDeduction: federal.standardDeduction,
    });
  }, [household, persons, dependents, taxItems, taxYear]);

  if (!result) {
    return (
      <CalculatorCard title="Bonus Tax" headline="—">
        <p className="text-sm text-muted-foreground">
          Set up your household profile + tax rules to see bonus tax.
        </p>
      </CalculatorCard>
    );
  }

  return (
    <CalculatorCard
      title="Bonus Tax"
      headline={
        <span data-testid="bonus-takehome">
          {formatCurrency(result.bonusTakeHome)} take-home
        </span>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-sm">
        <div>
          <div className="text-muted-foreground">Federal</div>
          <div className="font-medium tabular-nums">{formatCurrency(result.federalTax)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">FICA</div>
          <div className="font-medium tabular-nums">{formatCurrency(result.fica)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">State</div>
          <div className="font-medium tabular-nums">{formatCurrency(result.stateTax)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">City</div>
          <div className="font-medium tabular-nums">{formatCurrency(result.cityTax)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Effective rate</div>
          <div className="font-medium tabular-nums">{formatPercent(result.effectiveRate)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Marginal on bonus</div>
          <div className="font-medium tabular-nums">{formatPercent(result.marginalRateOnBonus)}</div>
        </div>
      </div>
    </CalculatorCard>
  );
}
