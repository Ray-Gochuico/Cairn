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
import { formatCurrency, formatPercent } from '@/lib/format';
import { TermTooltip } from '@/components/ui/glossary-tooltip';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import type { BonusFrequency } from '@/types/schema';

interface BonusTaxCardProps {
  cardId?: string;
  onHide?: (cardId: string) => void;
}

export function BonusTaxCard({ cardId, onHide }: BonusTaxCardProps = {}) {
  const { household } = useHouseholdStore();
  const persons = usePersonsStore((s) => s.persons);
  const tax = useHouseholdTaxContext();

  const seedPerson = persons.find((p) => (p.expectedBonus ?? 0) > 0) ?? persons[0] ?? null;

  // Editable assumptions (prefill from the seed person; bonus default stays 0 —
  // prefill-from-expectedBonus is a Wave-3 enhancement, out of scope here).
  const defaults = useMemo(
    () => ({
      bonus: 0,
      frequency: (seedPerson?.expectedBonusFrequency ?? 'ANNUAL') as BonusFrequency,
      isConsistent: seedPerson?.bonusIsConsistent ?? true,
    }),
    [seedPerson],
  );
  const { values, setValue, reset, isOverridden } = useCalculatorState(cardId ?? 'bonus-tax', defaults);
  const [method, setMethod] = useSupplementalMethod(cardId ?? 'bonus-tax');

  const effectiveBonus = values.bonus ?? 0;
  const bonusesPerYear = values.frequency === 'QUARTERLY' ? 4 : 1;
  const annualBonus = effectiveBonus * bonusesPerYear;

  const result = useMemo(() => {
    if (!tax.ready || !household || !tax.federal || !tax.state) return null;
    return computeSupplementalWageTax({
      baseSalary: tax.totalSalary,
      supplementalWages: annualBonus,
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
  }, [tax.ready, tax.federal, tax.state, tax.city, tax.totalSalary, tax.aggregatedPretax, household, annualBonus]);

  const controls = (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
      <NumberField
        id="bonus-override"
        label={`Bonus amount${values.frequency === 'QUARTERLY' ? ' (per quarter)' : ''}`}
        value={values.bonus}
        onChange={(v) => setValue('bonus', v ?? 0)}
        suffix="$"
        step="100"
        min={0}
      />
      <div className="space-y-1">
        <label htmlFor="bonus-frequency" className="text-sm font-medium">Bonus frequency</label>
        <Select
          value={values.frequency}
          onValueChange={(v) => setValue('frequency', v as BonusFrequency)}
        >
          <SelectTrigger id="bonus-frequency" aria-label="Bonus frequency">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ANNUAL">Annual</SelectItem>
            <SelectItem value="QUARTERLY">Quarterly</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="sm:col-span-2">
        <label htmlFor="bonus-consistent" className="flex items-center gap-2 text-sm">
          <Checkbox
            id="bonus-consistent"
            checked={values.isConsistent}
            onCheckedChange={(checked) => setValue('isConsistent', checked === true)}
          />
          Bonuses are consistent year over year
        </label>
      </div>
      {isOverridden && (
        <button type="button" onClick={reset} className="text-sm text-primary hover:underline sm:col-span-2 text-left">
          Reset to my data
        </button>
      )}
    </div>
  );

  if (!result) {
    return (
      <CalculatorCard title="Estimated bonus take-home" headline="—" cardId={cardId} onHide={onHide}>
        {controls}
        <p className="text-sm text-muted-foreground">
          Set up your household profile + tax rules to see bonus tax.
        </p>
      </CalculatorCard>
    );
  }

  if (effectiveBonus <= 0) {
    return (
      <CalculatorCard title="Estimated bonus take-home" headline="—" cardId={cardId} onHide={onHide}>
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
  const flatFederal = flatSupplementalWithholding(annualBonus);
  const federalOnBonus = method === 'FLAT' ? flatFederal : result.bonusBreakdown.federal;
  const totalTaxOnBonus =
    method === 'FLAT'
      ? flatFederal + result.bonusBreakdown.fica + result.bonusBreakdown.state + result.bonusBreakdown.city
      : result.bonusBreakdown.total;
  const annualBonusTakeHome = annualBonus - totalTaxOnBonus;
  const perBonusTakeHome = annualBonusTakeHome / bonusesPerYear;

  return (
    <CalculatorCard
      title="Estimated bonus take-home"
      cardId={cardId}
      onHide={onHide}
      headline={
        <span data-testid="bonus-takehome">
          {formatCurrency(perBonusTakeHome)}
        </span>
      }
    >
      {controls}
      <div className="text-sm text-muted-foreground mb-3">
        On a {formatCurrency(effectiveBonus)} bonus
        {values.frequency === 'QUARTERLY'
          ? ` (${formatCurrency(annualBonus)} annual)`
          : ''}, here's the estimated tax and take-home:
      </div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium">Withholding method</span>
        <SupplementalMethodToggle method={method} onChange={setMethod} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-sm">
        <ResultRow label="Estimated federal on bonus" value={formatCurrency(federalOnBonus / bonusesPerYear)} />
        <ResultRow label={<><TermTooltip term="FICA" /> on bonus</>} value={formatCurrency(result.bonusBreakdown.fica / bonusesPerYear)} />
        <ResultRow label="Estimated state on bonus" value={formatCurrency(result.bonusBreakdown.state / bonusesPerYear)} />
        <ResultRow label="Estimated city on bonus" value={formatCurrency(result.bonusBreakdown.city / bonusesPerYear)} />
        <ResultRow label="Estimated total tax on bonus" value={formatCurrency(totalTaxOnBonus / bonusesPerYear)} />
        <ResultRow label={<TermTooltip term="marginal rate" />} value={formatPercent(method === 'FLAT' ? (annualBonus > 0 ? totalTaxOnBonus / annualBonus : 0) : result.marginalRateOnBonus)} />
      </div>
      {values.isConsistent && (
        <div className="mt-3 pt-3 border-t text-sm">
          <span className="text-muted-foreground">Estimated total take-home for the year:</span>{' '}
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
      {/* Wave-5 W5-5 — calculator framing parity with the 401k card.
          The bonus take-home headline is an estimate because this engine
          uses the federal aggregate method by default and omits several
          items that materially shift the real number. */}
      <details className="text-xs mt-3 border-t pt-2 text-muted-foreground">
        <summary className="cursor-pointer font-medium hover:text-foreground">
          What this calculator does NOT model
        </summary>
        <ul className="mt-2 list-disc pl-5 space-y-1">
          <li>
            <strong>Aggregate vs. 22% flat method.</strong> The IRS lets your
            employer pick between the 22% supplemental-wage flat rate (37% over
            $1M) and the aggregate method (annualized W-4 brackets). Use the
            Aggregate / Flat 22% toggle above to compare both; the flat figure
            is federal withholding (reconciles at filing). State supplemental
            flat rates are still not modeled.
          </li>
          <li>
            <strong>State-specific supplemental-wage flat rates.</strong> CA, GA,
            NY, NJ, and others tax supplemental wages at a flat statutory rate
            that may differ from your W-4 ordinary rate. The engine applies
            your state's ordinary brackets.
          </li>
          <li>
            <TermTooltip term="NIIT">NIIT</TermTooltip> + Additional Medicare
            surtax (0.9% above $200k single / $250k MFJ) — secondary effects on
            the high-earner federal column.
          </li>
          <li>
            <TermTooltip term="AMT">AMT</TermTooltip> preference items if the
            bonus comes from an ISO disqualifying disposition.
          </li>
          <li>
            <strong>Bonus-period 401(k) catch-up elections.</strong> Some plans
            let you set a one-time bonus contribution % distinct from your
            regular salary deferral; the engine reuses your salary pretax %.
          </li>
          <li>
            <strong>RSU vesting taxes.</strong> If part of the bonus is in
            equity, the engine treats it all as cash. RSUs are taxed at FMV on
            vest and may push the same shares into a higher bracket.
          </li>
        </ul>
        <p className="mt-2">
          For a high-stakes bonus decision (negotiating, deciding whether to
          defer), run the numbers past a CPA — the items above can each shift
          the bottom line by hundreds to thousands of dollars.
        </p>
      </details>
    </CalculatorCard>
  );
}
