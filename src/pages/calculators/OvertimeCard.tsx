import { useEffect, useMemo, useState } from 'react';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { CalculatorCard } from './CalculatorCard';
import { computePretaxDeductions, computeBonusTax } from '@/lib/tax';
import { formatCurrency, formatPercent } from '@/lib/format';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  evaluateOvertimeLineItems,
  impliedHourlyRate,
  type OvertimeLineItem,
} from '@/lib/overtime';
import {
  PAYCHECK_PERIODS,
  type PaycheckPeriod,
} from '@/lib/paycheck-periods';
import type { Person } from '@/types/schema';

const YEAR = 2026;

const SELECT_CLASS =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

interface RowState {
  hours: number;
  baseMultiplier: number;
  // Preset selector value: '1.5', '2', or 'custom' (when custom, baseMultiplier holds the user's number)
  preset: '1.5' | '2' | 'custom';
  holidayMultiplier: number | null;
  stackMultipliers: boolean;
}

const STARTER_ROW: RowState = {
  hours: 8,
  baseMultiplier: 1.5,
  preset: '1.5',
  holidayMultiplier: null,
  stackMultipliers: false,
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

export function OvertimeCard() {
  const { household } = useHouseholdStore();
  const { persons } = usePersonsStore();
  const { dependents } = useDependentsStore();
  const taxItems = useTaxRulesStore((s) => s.items);
  const taxYear = useTaxRulesStore((s) => s.year);

  useEffect(() => {
    useTaxRulesStore.getState().loadYear(YEAR);
  }, []);

  const eligiblePerson = useMemo(() => persons.find(isEligible), [persons]);

  // ---- ephemeral UI state ----
  const [rows, setRows] = useState<RowState[]>([STARTER_ROW]);
  const [baseOverride, setBaseOverride] = useState<number | null>(null);
  const [period, setPeriod] = useState<PaycheckPeriod>('BI_WEEKLY');

  const derivedBase = eligiblePerson ? deriveBaseRate(eligiblePerson) : 0;
  const baseHourlyRate = baseOverride ?? derivedBase;

  const lookup = (jt: 'FEDERAL' | 'STATE' | 'CITY', code: string, fs: string) =>
    taxItems.find(
      (r) =>
        r.year === taxYear &&
        r.jurisdictionType === jt &&
        r.jurisdictionCode === code &&
        r.filingStatus === fs,
    ) ?? null;

  const overtime = useMemo(() => {
    if (!eligiblePerson || baseHourlyRate <= 0) return null;
    const items: OvertimeLineItem[] = rows.map((r) => ({
      hours: Math.max(0, r.hours),
      baseMultiplier: r.baseMultiplier,
      holidayMultiplier: r.holidayMultiplier,
      stackMultipliers: r.stackMultipliers,
    }));
    try {
      return evaluateOvertimeLineItems(items, baseHourlyRate);
    } catch {
      return null;
    }
  }, [rows, baseHourlyRate, eligiblePerson]);

  const totalGross = overtime?.totalGross ?? 0;

  const taxResult = useMemo(() => {
    if (!household || !eligiblePerson || taxItems.length === 0) return null;
    const federal = lookup('FEDERAL', 'US', household.filingStatus);
    const state = lookup('STATE', household.state, household.filingStatus);
    const city = household.city ? lookup('CITY', household.city, household.filingStatus) : null;
    if (!federal || !state) return null;

    const pretax = computePretaxDeductions({
      salary: eligiblePerson.annualSalaryPretax,
      pretax401kPct: eligiblePerson.pretax401kPct,
      healthInsuranceMonthlyPremium: eligiblePerson.healthInsuranceMonthlyPremium,
      dcfsaMonthly: eligiblePerson.dependentCareFsaMonthly,
      hsaMonthly: eligiblePerson.hsaMonthlyContribution,
      hsaEligible: eligiblePerson.hsaEligible,
      filingStatus: household.filingStatus,
      personCount: persons.length,
      dependentCount: dependents.length,
    });

    return computeBonusTax({
      personGross: eligiblePerson.annualSalaryPretax + totalGross,
      bonus: totalGross,
      pretax,
      filingStatus: household.filingStatus,
      federalBrackets: federal.brackets,
      stateBrackets: state.brackets,
      cityBrackets: city?.brackets ?? null,
      standardDeduction: federal.standardDeduction,
    });
  }, [household, eligiblePerson, persons, dependents, taxItems, taxYear, totalGross]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- early returns ----

  if (!eligiblePerson) {
    return (
      <CalculatorCard title="Overtime" headline="—">
        <p className="text-sm text-muted-foreground">
          No eligible person — set Employment type to Hourly or Salaried with overtime to enable this card.
        </p>
      </CalculatorCard>
    );
  }

  // ---- handlers ----

  const updateRow = (index: number, patch: Partial<RowState>) => {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };
  const addRow = () => setRows((prev) => [...prev, { ...STARTER_ROW }]);
  const removeRow = (index: number) =>
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));

  // ---- inputs ----

  const baseInput = (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
      <div className="space-y-1">
        <label htmlFor="ot-base-rate" className="text-sm font-medium">
          Base hourly rate
        </label>
        <Input
          id="ot-base-rate"
          type="number"
          min="0"
          step="0.01"
          value={baseHourlyRate === 0 ? '' : baseHourlyRate}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            setBaseOverride(Number.isFinite(v) && v >= 0 ? v : null);
          }}
        />
        <p className="text-xs text-muted-foreground">
          Auto-derived from {eligiblePerson.name} (
          {eligiblePerson.employmentType === 'HOURLY' ? 'hourly rate' : 'implied from salary'}
          ). Edit to override.
        </p>
      </div>
      <div className="space-y-1">
        <label htmlFor="ot-period" className="text-sm font-medium">
          Pay period
        </label>
        <select
          id="ot-period"
          className={SELECT_CLASS}
          value={period}
          onChange={(e) => setPeriod(e.target.value as PaycheckPeriod)}
        >
          {PAYCHECK_PERIODS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Display only — hours are entered per row.
        </p>
      </div>
    </div>
  );

  const rowsEditor = (
    <div className="space-y-3 mb-4">
      <div className="text-sm font-medium">OT line items</div>
      {rows.map((row, i) => {
        const hoursId = `ot-row-${i}-hours`;
        const presetId = `ot-row-${i}-preset`;
        const customId = `ot-row-${i}-custom`;
        const holidayId = `ot-row-${i}-holiday`;
        const stackId = `ot-row-${i}-stack`;

        return (
          <div
            key={i}
            className="rounded-md border bg-muted/30 p-3 space-y-2"
            data-testid={`ot-row-${i}`}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor={hoursId} className="text-xs font-medium">
                  Hours
                </label>
                <Input
                  id={hoursId}
                  type="number"
                  min="0"
                  step="0.25"
                  value={row.hours === 0 ? '' : row.hours}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    updateRow(i, { hours: Number.isFinite(v) && v >= 0 ? v : 0 });
                  }}
                />
              </div>
              <div className="space-y-1">
                <label htmlFor={presetId} className="text-xs font-medium">
                  Multiplier
                </label>
                <select
                  id={presetId}
                  className={SELECT_CLASS}
                  value={row.preset}
                  onChange={(e) => {
                    const next = e.target.value as RowState['preset'];
                    if (next === '1.5') updateRow(i, { preset: '1.5', baseMultiplier: 1.5 });
                    else if (next === '2') updateRow(i, { preset: '2', baseMultiplier: 2 });
                    else updateRow(i, { preset: 'custom' });
                  }}
                >
                  <option value="1.5">1.5x (time-and-a-half)</option>
                  <option value="2">2x (double-time)</option>
                  <option value="custom">Custom</option>
                </select>
              </div>
            </div>

            {row.preset === 'custom' && (
              <div className="space-y-1">
                <label htmlFor={customId} className="text-xs font-medium">
                  Custom multiplier
                </label>
                <Input
                  id={customId}
                  type="number"
                  min="0"
                  step="0.05"
                  value={row.baseMultiplier}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    updateRow(i, { baseMultiplier: Number.isFinite(v) ? v : 0 });
                  }}
                />
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor={holidayId} className="text-xs font-medium">
                  Holiday multiplier (optional)
                </label>
                <Input
                  id={holidayId}
                  type="number"
                  min="0"
                  step="0.05"
                  value={row.holidayMultiplier ?? ''}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === '') {
                      updateRow(i, { holidayMultiplier: null });
                      return;
                    }
                    const v = parseFloat(raw);
                    updateRow(i, { holidayMultiplier: Number.isFinite(v) ? v : null });
                  }}
                />
              </div>
              <div className="flex items-end">
                <label
                  htmlFor={stackId}
                  className="text-xs font-medium flex items-center gap-2"
                >
                  <input
                    id={stackId}
                    type="checkbox"
                    checked={row.stackMultipliers}
                    disabled={row.holidayMultiplier === null}
                    onChange={(e) =>
                      updateRow(i, { stackMultipliers: e.target.checked })
                    }
                  />
                  Stack with base
                </label>
              </div>
            </div>

            {rows.length > 1 && (
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeRow(i)}
                  aria-label={`Remove row ${i + 1}`}
                >
                  Remove
                </Button>
              </div>
            )}
          </div>
        );
      })}
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
      <CalculatorCard title="OT take-home" headline="—">
        {baseInput}
        {rowsEditor}
        <p className="text-sm text-muted-foreground">
          Base hourly rate must be positive. Enter a rate above.
        </p>
      </CalculatorCard>
    );
  }

  if (totalGross <= 0 || !taxResult) {
    return (
      <CalculatorCard title="OT take-home" headline="—">
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

  return (
    <CalculatorCard
      title="OT take-home"
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
              {li.hours} hrs × {formatCurrency(baseHourlyRate)} ×{' '}
              {li.effectiveMultiplier.toFixed(2)}
            </span>
            <span className="font-medium">{formatCurrency(li.gross)}</span>
          </div>
        ))}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-sm">
        <div>
          <div className="text-muted-foreground">Total OT gross</div>
          <div className="font-medium tabular-nums">{formatCurrency(totalGross)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Marginal rate on OT</div>
          <div className="font-medium tabular-nums">
            {formatPercent(taxResult.marginalRateOnBonus)}
          </div>
        </div>
        <div>
          <div className="text-muted-foreground">Total OT take-home</div>
          <div className="font-semibold tabular-nums">
            {formatCurrency(overtimeTakeHome)}
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground mt-3">
        Hours above represent one {PAYCHECK_PERIODS.find((p) => p.id === period)?.label.toLowerCase() ?? 'period'}.
        Overtime is taxed as supplemental wages (same method as bonuses) at {eligiblePerson.name}
        &#39;s marginal rate.
      </p>
    </CalculatorCard>
  );
}
