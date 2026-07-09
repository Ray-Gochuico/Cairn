import { useMemo } from 'react';
import { usePersonsStore } from '@/stores/persons-store';
import { useHouseholdStore } from '@/stores/household-store';
import { CalculatorCard } from './CalculatorCard';
import { computeSupplementalWageTax, flatSupplementalWithholding } from '@/lib/calculators/supplemental-wage';
import { useSupplementalMethod } from '@/lib/calculators/use-supplemental-method';
import { SupplementalMethodToggle } from '@/components/calculators/SupplementalMethodToggle';
import { useHouseholdTaxContext } from '@/lib/calculators/use-household-tax-context';
import { useCalculatorState } from '@/lib/calculator-state';
import { NumberField } from '@/components/calculators/NumberField';
import { ResultRow } from '@/components/calculators/ResultRow';
import { formatCurrency } from '@/lib/format';
import { CONTRIBUTION_LIMITS_2026 } from '@/lib/contribution-limits';
import { TermTooltip } from '@/components/ui/glossary-tooltip';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';

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
  // Wave-9 F1/F2: commission belongs to ONE earner — attribution drives both
  // the SS wage base and the 401(k) headroom.
  const recipient = persons.find((p) => (p.expectedCommission ?? 0) > 0) ?? persons[0] ?? null;
  const defaults = useMemo(
    () => ({
      annualCommission: seed?.expectedCommission ?? 0,
      frequency: (seed?.expectedCommissionFrequency ?? 'MONTHLY') as CommissionFrequency,
    }),
    [seed],
  );
  const { values, setValue, reset, isOverridden } = useCalculatorState(cardId ?? 'commission-tax', defaults);
  const [method, setMethod] = useSupplementalMethod(cardId ?? 'commission-tax');

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
      // Wave-9 F1: per-earner SS wage bases; the commission rides on the recipient.
      perPersonBaseSalary: persons.map((p) => p.annualSalaryPretax),
      recipientIndex: Math.max(0, persons.findIndex((p) => p === recipient)),
    });

    // Wave-9 F2: the $24,500 §402(g) limit is PER EMPLOYEE. The commission
    // earner's headroom is their own cap minus their own salary deferral —
    // the household aggregate (legitimately up to 2×) is irrelevant here.
    const recipientPct = recipient?.pretax401kPct ?? 0;
    const recipientOwn401k = recipient
      ? Math.min(recipient.annualSalaryPretax * recipientPct, CONTRIBUTION_LIMITS_2026.EMPLOYEE_401K)
      : 0;
    const remainingAnnualCap = Math.max(
      0,
      CONTRIBUTION_LIMITS_2026.EMPLOYEE_401K - recipientOwn401k,
    );
    const annualCommission401k = Math.min(annualCommission * recipientPct, remainingAnnualCap);
    return { result: taxResult, commission401kPerCheck: annualCommission401k / periods };
  }, [tax.ready, tax.federal, tax.state, tax.city, tax.totalSalary, tax.aggregatedPretax, household, persons, recipient, annualCommission, periods]);

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
        <Select
          value={values.frequency}
          onValueChange={(v) => setValue('frequency', v as CommissionFrequency)}
        >
          <SelectTrigger id="commission-frequency" aria-label="Frequency">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="MONTHLY">Monthly (12/yr)</SelectItem>
            <SelectItem value="QUARTERLY">Quarterly (4/yr)</SelectItem>
          </SelectContent>
        </Select>
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

  const flatFederal = flatSupplementalWithholding(annualCommission);
  const federalOnCommission = method === 'FLAT' ? flatFederal : result.bonusBreakdown.federal;
  const annualTaxOnCommission =
    method === 'FLAT'
      ? flatFederal + result.bonusBreakdown.fica + result.bonusBreakdown.state + result.bonusBreakdown.city
      : result.bonusBreakdown.total;
  const taxPerCheck = annualTaxOnCommission / periods;
  const netPerCheck = commissionPerCheck - commission401kPerCheck - taxPerCheck;

  const annualCommission401k = commission401kPerCheck * periods;
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
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">Withholding method</span>
        <SupplementalMethodToggle method={method} onChange={setMethod} />
      </div>
      {/* Per-check breakdown */}
      <div className="text-sm font-medium mb-2">Per check ({values.frequency === 'MONTHLY' ? 'monthly' : 'quarterly'})</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-sm mb-4">
        <ResultRow label="Commission gross" value={formatCurrency(commissionPerCheck)} />
        <ResultRow label="401(k) from this check" value={formatCurrency(commission401kPerCheck)} />
        <ResultRow label="Estimated federal tax" value={formatCurrency(federalOnCommission / periods)} />
        <ResultRow label={<TermTooltip term="FICA" />} value={formatCurrency(result.bonusBreakdown.fica / periods)} />
        <ResultRow label="Estimated state tax" value={formatCurrency(result.bonusBreakdown.state / periods)} />
        <ResultRow label="Estimated city tax" value={formatCurrency(result.bonusBreakdown.city / periods)} />
        <ResultRow label="Estimated take-home" value={formatCurrency(netPerCheck)} emphasis />
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
                of {persons.length > 1 && recipient ? `${recipient.name}'s ` : 'your '}
                {formatCurrency(CONTRIBUTION_LIMITS_2026.EMPLOYEE_401K)} cap
              </span>
            </>
          }
        />
        <ResultRow label="Estimated annual tax on commission" value={formatCurrency(annualTaxOnCommission)} />
        <ResultRow label="Estimated annual take-home" value={formatCurrency(annualNet)} emphasis />
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
            flat rate or the aggregate method. Use the Aggregate / Flat 22%
            toggle above to compare both; the flat figure is federal withholding
            (reconciles at filing). State supplemental flat rates are still not
            modeled.
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
