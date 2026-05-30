import { useMemo } from 'react';
import { usePersonsStore } from '@/stores/persons-store';
import { useHouseholdStore } from '@/stores/household-store';
import { CalculatorCard } from './CalculatorCard';
import { computeSupplementalWageTax } from '@/lib/calculators/supplemental-wage';
import { useHouseholdTaxContext } from '@/lib/calculators/use-household-tax-context';
import { useCalculatorState } from '@/lib/calculator-state';
import { NumberField } from '@/components/calculators/NumberField';
import { ResultRow } from '@/components/calculators/ResultRow';
import { formatCurrency } from '@/lib/format';
import { CONTRIBUTION_LIMITS_2026 } from '@/lib/contribution-limits';
import { TermTooltip } from '@/components/ui/glossary-tooltip';

type CommissionFrequency = 'MONTHLY' | 'QUARTERLY';

function periodsPerYear(frequency: CommissionFrequency): number {
  return frequency === 'MONTHLY' ? 12 : 4;
}

interface CommissionTaxCardProps {
  cardId?: string;
  onHide?: (cardId: string) => void;
}

export function CommissionTaxCard({ cardId, onHide }: CommissionTaxCardProps = {}) {
  const { household } = useHouseholdStore();
  const { persons } = usePersonsStore();
  const tax = useHouseholdTaxContext();

  const seed = persons[0] ?? null;
  const defaults = useMemo(
    () => ({
      annualCommission: seed?.expectedCommission ?? 0,
      frequency: (seed?.expectedCommissionFrequency ?? 'MONTHLY') as CommissionFrequency,
    }),
    [seed],
  );
  const { values, setValue, reset, isOverridden } = useCalculatorState(cardId ?? 'commission-tax', defaults);

  const periods = periodsPerYear(values.frequency);
  const annualCommission = values.annualCommission ?? 0;
  const commissionPerCheck = periods > 0 ? annualCommission / periods : 0;

  const { result, commission401kPerCheck } = useMemo(() => {
    if (!tax.ready || !household || !tax.federal || !tax.state) {
      return { result: null, commission401kPerCheck: 0 };
    }
    const taxResult = computeSupplementalWageTax({
      baseSalary: tax.totalSalary,
      supplementalWages: annualCommission,
      pretax: tax.aggregatedPretax,
      filingStatus: household.filingStatus,
      federalBrackets: tax.federal.brackets,
      stateBrackets: tax.state.brackets,
      cityBrackets: tax.city?.brackets ?? null,
      standardDeduction: {
        federal: tax.federal.standardDeduction,
        state: tax.state.standardDeduction,
        city: tax.city?.standardDeduction ?? 0,
      },
    });

    // 401(k) from commission: weighted-average pct across persons by salary share
    // (unchanged from the prior implementation).
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
      CONTRIBUTION_LIMITS_2026.EMPLOYEE_401K - tax.aggregatedPretax.pretax401k,
    );
    const annualCommission401k = Math.min(annualCommission * totalCommissionPct, remainingAnnualCap);
    return { result: taxResult, commission401kPerCheck: annualCommission401k / periods };
  }, [tax.ready, tax.federal, tax.state, tax.city, tax.totalSalary, tax.aggregatedPretax, household, persons, annualCommission, periods]);

  const commissionInputs = (
    <div className="space-y-3 mb-4">
      <NumberField
        id="annual-commission"
        label="Annual commission"
        value={values.annualCommission}
        onChange={(v) => setValue('annualCommission', v ?? 0)}
        suffix="$/yr"
        step="1000"
        min={0}
      />
      <div className="space-y-1">
        <label htmlFor="commission-frequency" className="text-sm font-medium">
          Frequency
        </label>
        <select
          id="commission-frequency"
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={values.frequency}
          onChange={(e) => setValue('frequency', e.target.value as CommissionFrequency)}
        >
          <option value="MONTHLY">Monthly (12/yr)</option>
          <option value="QUARTERLY">Quarterly (4/yr)</option>
        </select>
        <p className="text-xs text-muted-foreground tabular-nums">
          Per check: {formatCurrency(commissionPerCheck)}
        </p>
      </div>
      {isOverridden && (
        <button type="button" onClick={reset} className="text-sm text-primary hover:underline text-left">
          Reset to my data
        </button>
      )}
    </div>
  );

  if (!household || persons.length === 0 || !result) {
    return (
      <CalculatorCard title="Estimated commission take-home" headline="—" cardId={cardId} onHide={onHide}>
        {commissionInputs}
        <p className="text-sm text-muted-foreground">
          Set up your household profile + tax rules to see commission tax.
        </p>
      </CalculatorCard>
    );
  }

  if (annualCommission <= 0) {
    return (
      <CalculatorCard title="Estimated commission take-home" headline="—" cardId={cardId} onHide={onHide}>
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
      title="Estimated commission take-home"
      cardId={cardId}
      onHide={onHide}
      headline={
        <span data-testid="commission-takehome">{formatCurrency(netPerCheck)}</span>
      }
    >
      {commissionInputs}
      {/* Per-check breakdown */}
      <div className="text-sm font-medium mb-2">Per check ({values.frequency === 'MONTHLY' ? 'monthly' : 'quarterly'})</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-sm mb-4">
        <ResultRow label="Commission gross" value={formatCurrency(commissionPerCheck)} />
        <ResultRow label="401(k) from this check" value={formatCurrency(commission401kPerCheck)} />
        <ResultRow label="Estimated federal tax" value={formatCurrency(result.bonusBreakdown.federal / periods)} />
        <ResultRow label={<TermTooltip term="FICA" />} value={formatCurrency(result.bonusBreakdown.fica / periods)} />
        <ResultRow label="Estimated state tax" value={formatCurrency(result.bonusBreakdown.state / periods)} />
        <ResultRow label="Estimated city tax" value={formatCurrency(result.bonusBreakdown.city / periods)} />
        <ResultRow label="Estimated net to bank" value={formatCurrency(netPerCheck)} emphasis />
      </div>

      {/* Annual totals */}
      <div className="text-sm font-medium mb-2">Annual totals</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-sm mb-4">
        <ResultRow label="Annual commission" value={formatCurrency(annualCommission)} />
        <ResultRow
          label="Annual 401(k) from commission"
          value={
            <>
              {formatCurrency(annualCommission401k)}
              <span className="text-xs text-muted-foreground ml-1">
                of {formatCurrency(CONTRIBUTION_LIMITS_2026.EMPLOYEE_401K)} cap
              </span>
            </>
          }
        />
        <ResultRow label="Estimated annual tax on commission" value={formatCurrency(annualTaxOnCommission)} />
        <ResultRow label="Estimated annual net" value={formatCurrency(annualNet)} emphasis />
      </div>

      <p className="text-xs text-muted-foreground">
        Commission is taxed as supplemental wages. 401(k) contributions from commission are shown
        but the tax calc uses your salary pretax only (matches bonus card).
      </p>
      {/* Wave-5 W5-5 — calculator framing parity with the 401k card.
          Commission income shares the supplemental-wage withholding ambiguity
          and several state-rule complications that the engine does not model. */}
      <details className="text-xs mt-3 border-t pt-2 text-muted-foreground">
        <summary className="cursor-pointer font-medium hover:text-foreground">
          What this calculator does NOT model
        </summary>
        <ul className="mt-2 list-disc pl-5 space-y-1">
          <li>
            <strong>Aggregate vs. flat-rate withholding.</strong> Like bonuses,
            commission is a "supplemental wage" — the IRS allows either the 22%
            flat rate or the aggregate method. The engine uses the aggregate
            method; your payroll may use the flat rate.
          </li>
          <li>
            <strong>State-specific supplemental-wage flat rates.</strong> CA, GA,
            NY, NJ, and others tax supplemental wages at a flat statutory rate
            that may differ from your W-4 ordinary rate. The engine applies
            your state's ordinary brackets.
          </li>
          <li>
            <strong>Clawback / chargeback adjustments.</strong> Many commission
            plans claw back unearned commission if the underlying deal cancels.
            The engine treats each commission check as final.
          </li>
          <li>
            <TermTooltip term="NIIT">NIIT</TermTooltip> + Additional Medicare
            surtax (0.9% above $200k single / $250k MFJ) — secondary effects
            for high earners.
          </li>
          <li>
            <TermTooltip term="AMT">AMT</TermTooltip> on ISO exercises landing
            in the same period.
          </li>
          <li>
            <strong>Self-employment tax</strong> if any portion is paid as 1099
            commission (independent contractor) rather than W-2. The engine
            assumes W-2 employee withholding throughout.
          </li>
        </ul>
        <p className="mt-2">
          For a planning decision tied to commission (mortgage qualification,
          quarterly estimated taxes), run the numbers past a CPA — the items
          above can each shift the bottom line by hundreds to thousands of
          dollars per check.
        </p>
      </details>
    </CalculatorCard>
  );
}
