import { useEffect, useMemo, useState } from 'react';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { CalculatorCard } from './CalculatorCard';
import { computePretaxDeductions, computeBonusTax } from '@/lib/tax';
import { formatCurrency, formatPercent } from '@/lib/format';
import { Input } from '@/components/ui/input';

const YEAR = 2026;

export function BonusTaxCard() {
  const { household } = useHouseholdStore();
  const { persons } = usePersonsStore();
  const { dependents } = useDependentsStore();
  const taxItems = useTaxRulesStore((s) => s.items);
  const taxYear = useTaxRulesStore((s) => s.year);

  // Bonus is purely ephemeral — no default from Person data. User must enter inline.
  const defaultBonus = 0;
  const [bonusOverride, setBonusOverride] = useState<number | null>(null);
  const effectiveBonus = bonusOverride ?? defaultBonus;

  // Call loadYear once on mount using getState() to avoid object-reference
  // churn in the dependency array (fixes the infinite-loop risk from the plan).
  useEffect(() => {
    useTaxRulesStore.getState().loadYear(YEAR);
  }, []);

  const lookup = (jt: 'FEDERAL' | 'STATE' | 'CITY', code: string, fs: string) =>
    taxItems.find(
      (r) =>
        r.year === taxYear &&
        r.jurisdictionType === jt &&
        r.jurisdictionCode === code &&
        r.filingStatus === fs,
    ) ?? null;

  const result = useMemo(() => {
    if (!household || persons.length === 0 || taxItems.length === 0) return null;
    const federal = lookup('FEDERAL', 'US', household.filingStatus);
    const state = lookup('STATE', household.state, household.filingStatus);
    const city = household.city ? lookup('CITY', household.city, household.filingStatus) : null;
    if (!federal || !state) return null;

    // Aggregate salary + pretax across all persons (same shape as before).
    let totalSalary = 0;
    let totalPretax = { pretax401k: 0, pretaxHealth: 0, pretaxDcfsa: 0, pretaxHsa: 0 };
    for (const p of persons) {
      totalSalary += p.annualSalaryPretax;
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
      totalPretax.pretax401k += pretax.pretax401k;
      totalPretax.pretaxHealth += pretax.pretaxHealth;
      totalPretax.pretaxDcfsa += pretax.pretaxDcfsa;
      totalPretax.pretaxHsa += pretax.pretaxHsa;
    }

    return computeBonusTax({
      personGross: totalSalary + effectiveBonus,
      bonus: effectiveBonus,
      pretax: totalPretax,
      filingStatus: household.filingStatus,
      federalBrackets: federal.brackets,
      stateBrackets: state.brackets,
      cityBrackets: city?.brackets ?? null,
      standardDeduction: federal.standardDeduction,
    });
  }, [household, persons, dependents, taxItems, taxYear, effectiveBonus]); // eslint-disable-line react-hooks/exhaustive-deps

  const bonusInput = (
    <div className="space-y-1 mb-4">
      <label htmlFor="bonus-override" className="text-sm font-medium">
        Bonus amount
      </label>
      <Input
        id="bonus-override"
        type="number"
        min="0"
        step="100"
        value={bonusOverride ?? defaultBonus}
        onChange={(e) => {
          const v = e.target.value === '' ? null : parseFloat(e.target.value);
          setBonusOverride(Number.isFinite(v as number) ? v : null);
        }}
      />
    </div>
  );

  if (!result) {
    return (
      <CalculatorCard title="Bonus take-home" headline="—">
        {bonusInput}
        <p className="text-sm text-muted-foreground">
          Set up your household profile + tax rules to see bonus tax.
        </p>
      </CalculatorCard>
    );
  }

  if (effectiveBonus <= 0) {
    return (
      <CalculatorCard title="Bonus take-home" headline="—">
        {bonusInput}
        <p className="text-sm text-muted-foreground">
          Enter a bonus amount to see the bonus tax breakdown.
        </p>
      </CalculatorCard>
    );
  }

  const bonusTakeHome = effectiveBonus - result.bonusBreakdown.total;

  return (
    <CalculatorCard
      title="Bonus take-home"
      headline={
        <span data-testid="bonus-takehome">
          {formatCurrency(bonusTakeHome)}
        </span>
      }
    >
      {bonusInput}
      <div className="text-sm text-muted-foreground mb-3">
        On a {formatCurrency(effectiveBonus)} bonus, marginal-rate-diff math gives:
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-sm">
        <div>
          <div className="text-muted-foreground">Federal on bonus</div>
          <div className="font-medium tabular-nums">
            {formatCurrency(result.bonusBreakdown.federal)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">FICA on bonus</div>
          <div className="font-medium tabular-nums">
            {formatCurrency(result.bonusBreakdown.fica)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">State on bonus</div>
          <div className="font-medium tabular-nums">
            {formatCurrency(result.bonusBreakdown.state)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">City on bonus</div>
          <div className="font-medium tabular-nums">
            {formatCurrency(result.bonusBreakdown.city)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Total tax on bonus</div>
          <div className="font-medium tabular-nums">
            {formatCurrency(result.bonusBreakdown.total)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Marginal rate</div>
          <div className="font-medium tabular-nums">
            {formatPercent(result.marginalRateOnBonus)}
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-2">
        Enter a one-time bonus amount above. Editing here doesn&#39;t persist.
      </p>
    </CalculatorCard>
  );
}
