import { useMemo, useState } from 'react';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { CalculatorCard } from './CalculatorCard';
import { OvertimeRowEditor, type OvertimeRow } from './OvertimeRowEditor';
import { aggregateHouseholdPretax, computeSupplementalWageTax } from '@/lib/calculators/supplemental-wage';
import { useHouseholdTaxContext } from '@/lib/calculators/use-household-tax-context';
import { useCalculatorState } from '@/lib/calculator-state';
import { NumberField } from '@/components/calculators/NumberField';
import { ResultRow } from '@/components/calculators/ResultRow';
import { formatCurrency, formatPercent } from '@/lib/format';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  evaluateOvertimeLineItems,
  impliedHourlyRate,
  obbbaOvertimeDeduction,
  type OvertimeLineItem,
} from '@/lib/overtime';
import { TermTooltip } from '@/components/ui/glossary-tooltip';
import {
  PAYCHECK_PERIODS,
  type PaycheckPeriod,
} from '@/lib/paycheck-periods';
import type { Person } from '@/types/schema';

const STARTER_ROW: OvertimeRow = {
  hours: 8,
  baseMultiplier: 1.5,
  preset: '1.5',
  holidayMultiplier: null,
  stackMultipliers: false,
  shiftDifferential: 0,
};

function deriveBaseRate(person: Person): number {
  if (person.employmentType === 'HOURLY') {
    return person.hourlyRate ?? 0;
  }
  if (person.employmentType === 'SALARY_WITH_OT') {
    if (person.regularHoursPerWeek <= 0 || person.annualSalaryPretax <= 0) return 0;
    return impliedHourlyRate(person.annualSalaryPretax, person.regularHoursPerWeek);
  }
  return 0;
}

function isEligible(person: Person): boolean {
  return person.employmentType === 'HOURLY' || person.employmentType === 'SALARY_WITH_OT';
}

interface OvertimeCardProps {
  cardId?: string;
  onHide?: (cardId: string) => void;
}

export function OvertimeCard({ cardId, onHide }: OvertimeCardProps = {}) {
  const { household } = useHouseholdStore();
  const { persons } = usePersonsStore();
  const { dependents } = useDependentsStore();
  const tax = useHouseholdTaxContext();

  const eligiblePerson = useMemo(() => persons.find(isEligible), [persons]);
  const derivedBase = eligiblePerson ? deriveBaseRate(eligiblePerson) : 0;
  const { values, setValue, reset, isOverridden } = useCalculatorState(cardId ?? 'overtime', { baseRate: derivedBase });
  const baseHourlyRate = values.baseRate ?? 0;

  // ---- ephemeral UI state ----
  const [rows, setRows] = useState<OvertimeRow[]>([STARTER_ROW]);
  const [period, setPeriod] = useState<PaycheckPeriod>('BI_WEEKLY');

  const overtime = useMemo(() => {
    if (!eligiblePerson || baseHourlyRate <= 0) return null;
    const items: OvertimeLineItem[] = rows.map((r) => ({
      hours: Math.max(0, r.hours),
      baseMultiplier: r.baseMultiplier,
      holidayMultiplier: r.holidayMultiplier,
      stackMultipliers: r.stackMultipliers,
      shiftDifferential: Math.max(0, r.shiftDifferential ?? 0),
    }));
    try {
      return evaluateOvertimeLineItems(items, baseHourlyRate);
    } catch {
      return null;
    }
  }, [rows, baseHourlyRate, eligiblePerson]);

  const totalGross = overtime?.totalGross ?? 0;

  const taxResult = useMemo(() => {
    if (!tax.ready || !household || !eligiblePerson || !tax.federal || !tax.state) return null;
    const agg = aggregateHouseholdPretax([eligiblePerson], {
      filingStatus: household.filingStatus,
      personCount: persons.length,      // household-wide caps still count everyone
      dependentCount: dependents.length,
    });
    return computeSupplementalWageTax({
      baseSalary: agg.totalSalary,
      supplementalWages: totalGross,
      pretax: agg.pretax,
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
  }, [tax.ready, tax.federal, tax.state, tax.city, household, eligiblePerson, persons, dependents, totalGross]);

  // ---- early returns ----

  if (!eligiblePerson) {
    return (
      <CalculatorCard title="Overtime" headline="—" cardId={cardId} onHide={onHide}>
        <p className="text-sm text-muted-foreground">
          No eligible person — set Employment type to Hourly or Salaried with overtime to enable this card.
        </p>
      </CalculatorCard>
    );
  }

  // ---- handlers ----

  const updateRow = (index: number, patch: Partial<OvertimeRow>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };
  const addRow = () => setRows((prev) => [...prev, { ...STARTER_ROW }]);
  const removeRow = (index: number) =>
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));

  // ---- inputs ----

  const baseInput = (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
      <div className="space-y-1">
        <NumberField
          id="ot-base-rate"
          label="Base hourly rate"
          value={values.baseRate}
          onChange={(v) => setValue('baseRate', v ?? 0)}
          suffix="$/hr"
          step="0.01"
          min={0}
        />
        <p className="text-xs text-muted-foreground">
          Auto-derived from {eligiblePerson.name} (
          {eligiblePerson.employmentType === 'HOURLY' ? 'hourly rate' : 'implied from salary'}
          ). Edit to override.
        </p>
        {isOverridden && (
          <button type="button" onClick={reset} className="text-sm text-primary hover:underline text-left">
            Reset to my data
          </button>
        )}
      </div>
      <div className="space-y-1">
        <div className="text-sm font-medium">Pay period</div>
        <Select value={period} onValueChange={(v) => setPeriod(v as PaycheckPeriod)}>
          <SelectTrigger id="ot-period" aria-label="Pay period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAYCHECK_PERIODS.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Display only — hours are entered per row.
        </p>
      </div>
    </div>
  );

  const rowsEditor = (
    <div className="space-y-3 mb-4">
      <div className="text-sm font-medium">OT line items</div>
      {rows.map((row, i) => (
        <OvertimeRowEditor
          key={i}
          row={row}
          index={i}
          canRemove={rows.length > 1}
          onChange={(patch) => updateRow(i, patch)}
          onRemove={() => removeRow(i)}
        />
      ))}
      <div>
        <Button type="button" variant="outline" size="sm" onClick={addRow}>
          + Add row
        </Button>
      </div>
    </div>
  );

  // ---- error / empty states for headline ----

  if (baseHourlyRate <= 0) {
    return (
      <CalculatorCard title="Overtime" headline="—" cardId={cardId} onHide={onHide}>
        {baseInput}
        {rowsEditor}
        <p className="text-sm text-muted-foreground">
          Base hourly rate must be positive. Enter a rate above.
        </p>
      </CalculatorCard>
    );
  }

  if (totalGross <= 0 || !taxResult || !household) {
    return (
      <CalculatorCard title="Overtime" headline="—" cardId={cardId} onHide={onHide}>
        {baseInput}
        {rowsEditor}
        <p className="text-sm text-muted-foreground">
          {totalGross <= 0
            ? 'Enter overtime hours above to see the take-home breakdown.'
            : 'Set up your household profile + tax rules to see overtime tax.'}
        </p>
      </CalculatorCard>
    );
  }

  const overtimeTakeHome = taxResult.bonusTakeHome;
  const obbbaDeduction = obbbaOvertimeDeduction(overtime?.totalPremium ?? 0, household.filingStatus);
  const federalMarginalOnOt = totalGross > 0 ? taxResult.bonusBreakdown.federal / totalGross : 0;
  const obbbaFederalSaving = obbbaDeduction * federalMarginalOnOt;

  return (
    <CalculatorCard
      title="Overtime"
      cardId={cardId}
      onHide={onHide}
      headline={
        <span data-testid="ot-takehome">{formatCurrency(overtimeTakeHome)}</span>
      }
    >
      {baseInput}
      {rowsEditor}

      {/* Per-row breakdown */}
      <div className="text-sm font-medium mb-2">Per-row breakdown</div>
      <div className="space-y-1 text-sm mb-4">
        {(overtime?.lineItems ?? []).map((li, i) => (
          <div
            key={i}
            data-testid={`ot-row-result-${i}`}
            className="flex justify-between gap-3 tabular-nums"
          >
            <span className="text-muted-foreground">
              {li.hours} hrs × {formatCurrency(li.effectiveBaseRate)} ×{' '}
              {li.effectiveMultiplier.toFixed(2)}
            </span>
            <span className="font-medium">{formatCurrency(li.gross)}</span>
          </div>
        ))}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-sm">
        <ResultRow label="Total OT gross" value={formatCurrency(totalGross)} />
        <ResultRow label="Marginal rate on OT" value={formatPercent(taxResult.marginalRateOnBonus)} />
        <ResultRow label="Total OT take-home" value={formatCurrency(overtimeTakeHome)} emphasis />
      </div>

      {obbbaDeduction > 0 && (
        <div className="mt-3 border-t pt-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <ResultRow label={<><TermTooltip term="OBBBA">OBBBA</TermTooltip> OT deduction (est.)</>} value={formatCurrency(obbbaDeduction)} />
            <ResultRow label="Est. federal tax saved" value={formatCurrency(obbbaFederalSaving)} testId="ot-obbba-deduction" />
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Estimate. Deducts the overtime premium (pay above your regular rate), capped at $12,500 ($25,000 MFJ).
            Does not model the $150k/$300k MAGI phase-out; the deduction sunsets after 2028; FICA and most state
            income taxes still apply; it applies the per-period premium against the annual cap without annualizing.
          </p>
        </div>
      )}

      <p className="text-xs text-muted-foreground mt-3">
        Hours above represent one {PAYCHECK_PERIODS.find((p) => p.id === period)?.label.toLowerCase() ?? 'period'}.
        Overtime is taxed as supplemental wages (same method as bonuses) at {eligiblePerson.name}
        &#39;s marginal rate.
      </p>
    </CalculatorCard>
  );
}
