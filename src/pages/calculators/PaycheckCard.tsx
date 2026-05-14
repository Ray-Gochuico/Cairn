import { useEffect, useMemo, useState } from 'react';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { CalculatorCard } from './CalculatorCard';
import { computePretaxDeductions, computeBonusTax } from '@/lib/tax';
import { formatCurrency } from '@/lib/format';
import { PAYCHECK_PERIODS, periodsPerYear, type PaycheckPeriod } from '@/lib/paycheck-periods';
import { getCurrentTaxYear } from '@/lib/current-tax-year';

interface PaycheckCardProps {
  cardId?: string;
  onHide?: () => void;
}

export function PaycheckCard({ cardId, onHide }: PaycheckCardProps = {}) {
  const { household } = useHouseholdStore();
  const { persons } = usePersonsStore();
  const { dependents } = useDependentsStore();
  const taxItems = useTaxRulesStore((s) => s.items);
  const [period, setPeriod] = useState<PaycheckPeriod>('MONTHLY');

  // Smart-resolve the tax year from the seeded set: if the current calendar year
  // has rules use it, otherwise fall back to the most-recent seeded year.
  const seededYears = useMemo(
    () => [...new Set(taxItems.map((r) => r.year))],
    [taxItems],
  );
  const { year: resolvedYear } = getCurrentTaxYear(seededYears);

  // Bootstrap: on mount, discover what years are seeded and load the most
  // recent. This avoids the trap where loadYear(currentCalendarYear) returns
  // empty and clobbers any pre-loaded fallback rules — the resolver above
  // will then map seededYears → resolvedYear correctly.
  useEffect(() => {
    useTaxRulesStore.getState().loadAvailableYears();
  }, []);

  const lookup = (jt: 'FEDERAL' | 'STATE' | 'CITY', code: string, fs: string) =>
    taxItems.find(
      (r) =>
        r.year === resolvedYear &&
        r.jurisdictionType === jt &&
        r.jurisdictionCode === code &&
        r.filingStatus === fs,
    ) ?? null;

  const annual = useMemo(() => {
    if (!household || persons.length === 0 || taxItems.length === 0) return null;
    const federal = lookup('FEDERAL', 'US', household.filingStatus);
    const state = lookup('STATE', household.state, household.filingStatus);
    const city = household.city ? lookup('CITY', household.city, household.filingStatus) : null;
    if (!federal || !state) return null;

    let totalGross = 0;
    const totalPretax = { pretax401k: 0, pretaxHealth: 0, pretaxDcfsa: 0, pretaxHsa: 0 };

    for (const p of persons) {
      totalGross += p.annualSalaryPretax; // SALARY ONLY — no bonus
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

    const tax = computeBonusTax({
      personGross: totalGross,
      bonus: 0,
      pretax: totalPretax,
      filingStatus: household.filingStatus,
      federalBrackets: federal.brackets,
      stateBrackets: state.brackets,
      cityBrackets: city?.brackets ?? null,
      standardDeduction: federal.standardDeduction,
    });

    const pretaxTotal =
      totalPretax.pretax401k +
      totalPretax.pretaxHealth +
      totalPretax.pretaxDcfsa +
      totalPretax.pretaxHsa;
    const takeHome = totalGross - pretaxTotal - tax.totalTax;

    return {
      gross: totalGross,
      pretax401k: totalPretax.pretax401k,
      pretaxHealth: totalPretax.pretaxHealth,
      pretaxDcfsa: totalPretax.pretaxDcfsa,
      pretaxHsa: totalPretax.pretaxHsa,
      federalTax: tax.federalTax,
      fica: tax.fica,
      stateTax: tax.stateTax,
      cityTax: tax.cityTax,
      takeHome,
    };
  }, [household, persons, dependents, taxItems, resolvedYear]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!annual) {
    return (
      <CalculatorCard title="Paycheck (take-home)" headline="—" cardId={cardId} onHide={onHide}>
        <p className="text-sm text-muted-foreground">
          Set up your household profile + tax rules to see take-home.
        </p>
      </CalculatorCard>
    );
  }

  const div = periodsPerYear(period);
  const perPeriod = {
    gross: annual.gross / div,
    pretax401k: annual.pretax401k / div,
    pretaxHealth: annual.pretaxHealth / div,
    pretaxDcfsa: annual.pretaxDcfsa / div,
    pretaxHsa: annual.pretaxHsa / div,
    federalTax: annual.federalTax / div,
    fica: annual.fica / div,
    stateTax: annual.stateTax / div,
    cityTax: annual.cityTax / div,
    takeHome: annual.takeHome / div,
  };

  return (
    <CalculatorCard
      title="Paycheck (take-home)"
      cardId={cardId}
      onHide={onHide}
      headline={
        <span data-testid="paycheck-takehome">
          {formatCurrency(perPeriod.takeHome)}
        </span>
      }
    >
      <div className="flex items-center gap-2 mb-3 text-sm">
        <label htmlFor="paycheck-period" className="text-muted-foreground">
          Period:
        </label>
        <select
          id="paycheck-period"
          value={period}
          onChange={(e) => setPeriod(e.target.value as PaycheckPeriod)}
          className="border rounded px-2 py-1 bg-background"
        >
          {PAYCHECK_PERIODS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-sm">
        <div>
          <div className="text-muted-foreground">Gross</div>
          <div className="font-medium tabular-nums">{formatCurrency(perPeriod.gross)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Pretax 401(k)</div>
          <div className="font-medium tabular-nums">{formatCurrency(perPeriod.pretax401k)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Pretax health</div>
          <div className="font-medium tabular-nums">{formatCurrency(perPeriod.pretaxHealth)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Pretax DCFSA</div>
          <div className="font-medium tabular-nums">{formatCurrency(perPeriod.pretaxDcfsa)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Pretax HSA</div>
          <div className="font-medium tabular-nums">{formatCurrency(perPeriod.pretaxHsa)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Federal tax</div>
          <div className="font-medium tabular-nums">{formatCurrency(perPeriod.federalTax)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">FICA</div>
          <div className="font-medium tabular-nums">{formatCurrency(perPeriod.fica)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">State tax</div>
          <div className="font-medium tabular-nums">{formatCurrency(perPeriod.stateTax)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">City tax</div>
          <div className="font-medium tabular-nums">{formatCurrency(perPeriod.cityTax)}</div>
        </div>
      </div>
    </CalculatorCard>
  );
}
