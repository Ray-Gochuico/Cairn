import { useEffect, useMemo, useState } from 'react';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { CalculatorCard } from './CalculatorCard';
import { computePretaxDeductions, computeBonusTax } from '@/lib/tax';
import { formatCurrency, formatPercent } from '@/lib/format';
import { Input } from '@/components/ui/input';
import type { BonusFrequency } from '@/types/schema';

// TODO(12.7.1): swap for getCurrentTaxYear() once that helper lands.
const YEAR = 2026;

export function BonusTaxCard() {
  const { household } = useHouseholdStore();
  const { persons } = usePersonsStore();
  const { dependents } = useDependentsStore();
  const taxItems = useTaxRulesStore((s) => s.items);
  const taxYear = useTaxRulesStore((s) => s.year);

  // Seed frequency + consistency from the FIRST person who has a non-zero
  // expectedBonus, falling back to the first person if none qualify. Households
  // with mixed bonus structures across persons are out of scope for this card;
  // the user can override either control inline without persisting.
  const seedPerson =
    persons.find((p) => (p.expectedBonus ?? 0) > 0) ?? persons[0] ?? null;

  const defaultBonus = 0;
  const [bonusOverride, setBonusOverride] = useState<number | null>(null);
  const [frequencyOverride, setFrequencyOverride] = useState<BonusFrequency | null>(null);
  const [consistencyOverride, setConsistencyOverride] = useState<boolean | null>(null);

  const effectiveBonus = bonusOverride ?? defaultBonus;
  const effectiveFrequency: BonusFrequency =
    frequencyOverride ?? seedPerson?.expectedBonusFrequency ?? 'ANNUAL';
  const isConsistent =
    consistencyOverride ?? seedPerson?.bonusIsConsistent ?? true;
  const bonusesPerYear = effectiveFrequency === 'QUARTERLY' ? 4 : 1;
  // The bonus input represents one payment; multiply by frequency for the
  // annual figure that drives marginal-rate math.
  const annualBonus = effectiveBonus * bonusesPerYear;

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
      personGross: totalSalary + annualBonus,
      bonus: annualBonus,
      pretax: totalPretax,
      filingStatus: household.filingStatus,
      federalBrackets: federal.brackets,
      stateBrackets: state.brackets,
      cityBrackets: city?.brackets ?? null,
      standardDeduction: federal.standardDeduction,
    });
  }, [household, persons, dependents, taxItems, taxYear, annualBonus]); // eslint-disable-line react-hooks/exhaustive-deps

  const controls = (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
      <div className="space-y-1">
        <label htmlFor="bonus-override" className="text-sm font-medium">
          Bonus amount{effectiveFrequency === 'QUARTERLY' ? ' (per quarter)' : ''}
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
      <div className="space-y-1">
        <label htmlFor="bonus-frequency" className="text-sm font-medium">
          Bonus frequency
        </label>
        <select
          id="bonus-frequency"
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={effectiveFrequency}
          onChange={(e) => setFrequencyOverride(e.target.value as BonusFrequency)}
        >
          <option value="ANNUAL">Annual</option>
          <option value="QUARTERLY">Quarterly</option>
        </select>
      </div>
      <div className="sm:col-span-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isConsistent}
            onChange={(e) => setConsistencyOverride(e.target.checked)}
          />
          Bonuses are consistent year over year
        </label>
      </div>
    </div>
  );

  if (!result) {
    return (
      <CalculatorCard title="Bonus take-home" headline="—">
        {controls}
        <p className="text-sm text-muted-foreground">
          Set up your household profile + tax rules to see bonus tax.
        </p>
      </CalculatorCard>
    );
  }

  if (effectiveBonus <= 0) {
    return (
      <CalculatorCard title="Bonus take-home" headline="—">
        {controls}
        <p className="text-sm text-muted-foreground">
          Enter a bonus amount to see the bonus tax breakdown.
        </p>
      </CalculatorCard>
    );
  }

  // Per-bonus take-home is the headline (matches user intuition: "what does
  // THIS bonus pay"). Annual rollup appears as a secondary line when
  // bonusIsConsistent so users can see the projected full-year impact.
  const annualBonusTakeHome = annualBonus - result.bonusBreakdown.total;
  const perBonusTakeHome = annualBonusTakeHome / bonusesPerYear;

  return (
    <CalculatorCard
      title="Bonus take-home"
      headline={
        <span data-testid="bonus-takehome">
          {formatCurrency(perBonusTakeHome)}
        </span>
      }
    >
      {controls}
      <div className="text-sm text-muted-foreground mb-3">
        On a {formatCurrency(effectiveBonus)} bonus
        {effectiveFrequency === 'QUARTERLY'
          ? ` (${formatCurrency(annualBonus)} annual)`
          : ''}, marginal-rate-diff math gives:
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-sm">
        <div>
          <div className="text-muted-foreground">Federal on bonus</div>
          <div className="font-medium tabular-nums">
            {formatCurrency(result.bonusBreakdown.federal / bonusesPerYear)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">FICA on bonus</div>
          <div className="font-medium tabular-nums">
            {formatCurrency(result.bonusBreakdown.fica / bonusesPerYear)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">State on bonus</div>
          <div className="font-medium tabular-nums">
            {formatCurrency(result.bonusBreakdown.state / bonusesPerYear)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">City on bonus</div>
          <div className="font-medium tabular-nums">
            {formatCurrency(result.bonusBreakdown.city / bonusesPerYear)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Total tax on bonus</div>
          <div className="font-medium tabular-nums">
            {formatCurrency(result.bonusBreakdown.total / bonusesPerYear)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Marginal rate</div>
          <div className="font-medium tabular-nums">
            {formatPercent(result.marginalRateOnBonus)}
          </div>
        </div>
      </div>
      {isConsistent && (
        <div className="mt-3 pt-3 border-t text-sm">
          <span className="text-muted-foreground">Total take-home for the year:</span>{' '}
          <span className="font-medium tabular-nums">{formatCurrency(annualBonusTakeHome)}</span>
          {bonusesPerYear > 1 && (
            <span className="text-muted-foreground">
              {' '}({bonusesPerYear} bonuses × {formatCurrency(perBonusTakeHome)})
            </span>
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground mt-2">
        Enter a one-time bonus amount above. Editing here doesn&#39;t persist.
      </p>
    </CalculatorCard>
  );
}
