import { useEffect, useMemo, useState } from 'react';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { CalculatorCard } from './CalculatorCard';
import { computePretaxDeductions, computeBonusTax } from '@/lib/tax';
import { formatCurrency } from '@/lib/format';
import { Input } from '@/components/ui/input';
import { CONTRIBUTION_LIMITS_2026 } from '@/lib/contribution-limits';

const YEAR = 2026;

type CommissionFrequency = 'MONTHLY' | 'QUARTERLY';

function periodsPerYear(frequency: CommissionFrequency): number {
  return frequency === 'MONTHLY' ? 12 : 4;
}

export function CommissionTaxCard() {
  const { household } = useHouseholdStore();
  const { persons } = usePersonsStore();
  const { dependents } = useDependentsStore();
  const taxItems = useTaxRulesStore((s) => s.items);
  const taxYear = useTaxRulesStore((s) => s.year);

  const [commissionPerCheck, setCommissionPerCheck] = useState<number>(
    () => persons[0]?.expectedCommission ?? 0
  );
  const [frequency, setFrequency] = useState<CommissionFrequency>(
    () => (persons[0]?.expectedCommissionFrequency as CommissionFrequency) ?? 'MONTHLY'
  );

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

  const periods = periodsPerYear(frequency);
  const annualCommission = commissionPerCheck * periods;

  const { result, commission401kPerCheck } = useMemo(() => {
    if (!household || persons.length === 0 || taxItems.length === 0) {
      return { result: null, commission401kPerCheck: 0 };
    }
    const federal = lookup('FEDERAL', 'US', household.filingStatus);
    const state = lookup('STATE', household.state, household.filingStatus);
    const city = household.city ? lookup('CITY', household.city, household.filingStatus) : null;
    if (!federal || !state) return { result: null, commission401kPerCheck: 0 };

    // Aggregate salary + pretax across all persons (salary only — same as BonusTaxCard).
    let totalSalary = 0;
    const pretaxAggregate = { pretax401k: 0, pretaxHealth: 0, pretaxDcfsa: 0, pretaxHsa: 0 };
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
      pretaxAggregate.pretax401k += pretax.pretax401k;
      pretaxAggregate.pretaxHealth += pretax.pretaxHealth;
      pretaxAggregate.pretaxDcfsa += pretax.pretaxDcfsa;
      pretaxAggregate.pretaxHsa += pretax.pretaxHsa;
    }

    const taxResult = computeBonusTax({
      personGross: totalSalary + annualCommission,
      bonus: annualCommission,
      pretax: pretaxAggregate,
      filingStatus: household.filingStatus,
      federalBrackets: federal.brackets,
      stateBrackets: state.brackets,
      cityBrackets: city?.brackets ?? null,
      standardDeduction: federal.standardDeduction,
    });

    // 401(k) from commission: weighted-average pct across persons by salary share.
    const totalSalaryAll = persons.reduce((a, p) => a + p.annualSalaryPretax, 0);
    const totalCommissionPct = persons.reduce(
      (a, p) =>
        a +
        (totalSalaryAll > 0
          ? (p.pretax401kPct * p.annualSalaryPretax) / totalSalaryAll
          : 0),
      0,
    );

    const remainingAnnualCap = Math.max(
      0,
      CONTRIBUTION_LIMITS_2026.EMPLOYEE_401K - pretaxAggregate.pretax401k,
    );
    const uncappedAnnualCommission401k = annualCommission * totalCommissionPct;
    const annualCommission401k = Math.min(uncappedAnnualCommission401k, remainingAnnualCap);
    const commissionCheckContrib = annualCommission401k / periods;

    return { result: taxResult, commission401kPerCheck: commissionCheckContrib };
  }, [household, persons, dependents, taxItems, taxYear, annualCommission, periods]); // eslint-disable-line react-hooks/exhaustive-deps

  const commissionInputs = (
    <div className="space-y-3 mb-4">
      <div className="space-y-1">
        <label htmlFor="commission-per-check" className="text-sm font-medium">
          Commission per check
        </label>
        <Input
          id="commission-per-check"
          type="number"
          min="0"
          step="100"
          value={commissionPerCheck === 0 ? '' : commissionPerCheck}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            setCommissionPerCheck(Number.isFinite(v) && v >= 0 ? v : 0);
          }}
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="commission-frequency" className="text-sm font-medium">
          Frequency
        </label>
        <select
          id="commission-frequency"
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as CommissionFrequency)}
        >
          <option value="MONTHLY">Monthly (12/yr)</option>
          <option value="QUARTERLY">Quarterly (4/yr)</option>
        </select>
      </div>
    </div>
  );

  if (!household || persons.length === 0 || !result) {
    return (
      <CalculatorCard title="Commission Tax" headline="—">
        {commissionInputs}
        <p className="text-sm text-muted-foreground">
          Set up your household profile + tax rules to see commission tax.
        </p>
      </CalculatorCard>
    );
  }

  if (commissionPerCheck === 0) {
    return (
      <CalculatorCard title="Commission Tax" headline="—">
        {commissionInputs}
        <p className="text-sm text-muted-foreground">
          Enter a commission amount to see the tax breakdown.
        </p>
      </CalculatorCard>
    );
  }

  const taxPerCheck = result.bonusBreakdown.total / periods;
  const netPerCheck = commissionPerCheck - commission401kPerCheck - taxPerCheck;

  const annualCommission401k = commission401kPerCheck * periods;
  const annualTaxOnCommission = result.bonusBreakdown.total;
  const annualNet = annualCommission - annualCommission401k - annualTaxOnCommission;

  return (
    <CalculatorCard
      title="Commission Tax"
      headline={
        <span data-testid="commission-takehome">{formatCurrency(netPerCheck)}</span>
      }
    >
      {commissionInputs}
      {/* Per-check breakdown */}
      <div className="text-sm font-medium mb-2">Per check ({frequency === 'MONTHLY' ? 'monthly' : 'quarterly'})</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-sm mb-4">
        <div>
          <div className="text-muted-foreground">Commission gross</div>
          <div className="font-medium tabular-nums">{formatCurrency(commissionPerCheck)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">401(k) from this check</div>
          <div className="font-medium tabular-nums">{formatCurrency(commission401kPerCheck)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Federal tax</div>
          <div className="font-medium tabular-nums">
            {formatCurrency(result.bonusBreakdown.federal / periods)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">FICA</div>
          <div className="font-medium tabular-nums">
            {formatCurrency(result.bonusBreakdown.fica / periods)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">State tax</div>
          <div className="font-medium tabular-nums">
            {formatCurrency(result.bonusBreakdown.state / periods)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">City tax</div>
          <div className="font-medium tabular-nums">
            {formatCurrency(result.bonusBreakdown.city / periods)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Net to bank</div>
          <div className="font-semibold tabular-nums">{formatCurrency(netPerCheck)}</div>
        </div>
      </div>

      {/* Annual totals */}
      <div className="text-sm font-medium mb-2">Annual totals</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-sm mb-4">
        <div>
          <div className="text-muted-foreground">Annual commission</div>
          <div className="font-medium tabular-nums">{formatCurrency(annualCommission)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Annual 401(k) from commission</div>
          <div className="font-medium tabular-nums">
            {formatCurrency(annualCommission401k)}
            <span className="text-xs text-muted-foreground ml-1">
              of {formatCurrency(CONTRIBUTION_LIMITS_2026.EMPLOYEE_401K)} cap
            </span>
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Annual tax on commission</div>
          <div className="font-medium tabular-nums">{formatCurrency(annualTaxOnCommission)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Annual net</div>
          <div className="font-semibold tabular-nums">{formatCurrency(annualNet)}</div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Commission is taxed as supplemental wages. 401(k) contributions from commission are shown
        but the tax calc uses your salary pretax only (matches bonus card).
      </p>
    </CalculatorCard>
  );
}
