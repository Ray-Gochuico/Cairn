import { useMemo, useState } from 'react';
import { useHouseholdStore } from '@/stores/household-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { CalculatorCard, EmptyMeaning, RailReset, RailViewGroup } from './CalculatorCard';
import { OvertimeRowEditor, type OvertimeRow } from './OvertimeRowEditor';
import { aggregateHouseholdPretax, computeSupplementalWageTax } from '@/lib/calculators/supplemental-wage';
import { useHouseholdTaxContext } from '@/lib/calculators/use-household-tax-context';
import { useCalculatorState } from '@/lib/calculator-state';
import { NumberField } from '@/components/calculators/NumberField';
import { NotModeledDisclosure } from '@/components/calculators/NotModeledDisclosure';
import { ResultRow } from '@/components/calculators/ResultRow';
import { SupplementalResultBlock } from '@/components/calculators/SupplementalResultBlock';
import { EarnerSelect } from '@/components/calculators/EarnerSelect';
import { useSelectedEarner } from '@/lib/calculators/use-selected-earner';
import { formatCurrency } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
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
  periodsPerYear as paycheckPeriodsPerYear,
  type PaycheckPeriod,
} from '@/lib/paycheck-periods';
import { FilingStatus } from '@/types/enums';
import type { Person } from '@/types/schema';
import { InlineLink } from '@/components/calculators/InlineLink';

type OvertimeRecurrence = 'REPEATS' | 'ONE_OFF';

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
}

export function OvertimeCard({ cardId }: OvertimeCardProps = {}) {
  const { household } = useHouseholdStore();
  const dependents = useDependentsStore((s) => s.dependents);
  const tax = useHouseholdTaxContext();
  // D7 (Wave 18): EFFECTIVE persons — bar salary overrides drive
  // deriveBaseRate, the salary patch, and recipientIndex.
  const persons = tax.persons;

  // Wave 18 B7: with 2+ eligible persons an EarnerSelect picks whose OT this
  // is — the selection drives deriveBaseRate, the salary patch, and
  // recipientIndex. Single-eligible households see no picker (unchanged).
  const eligible = useMemo(() => persons.filter(isEligible), [persons]);
  const eligibleIds = useMemo(
    () => eligible.map((p) => p.id).filter((id): id is number => id != null),
    [eligible],
  );
  const [otEarnerId, setOtEarnerId] = useSelectedEarner(
    cardId ?? 'overtime',
    eligible[0]?.id ?? null,
    eligibleIds,
  );
  const eligiblePerson = eligible.find((p) => p.id === otEarnerId) ?? eligible[0];
  const derivedBase = eligiblePerson ? deriveBaseRate(eligiblePerson) : 0;
  const { values, setValue, reset, isOverridden, overriddenKeys } = useCalculatorState(cardId ?? 'overtime', { baseRate: derivedBase });
  const baseHourlyRate = values.baseRate ?? 0;

  // ---- ephemeral UI state ----
  const [rows, setRows] = useState<OvertimeRow[]>([STARTER_ROW]);
  const [period, setPeriod] = useState<PaycheckPeriod>('BI_WEEKLY');
  // T3 review I1: plain useState like its sibling annualization knob `period`,
  // NOT useCalculatorState — 'REPEATS' is a fixed default, not "my data", so
  // picking One-off must neither surface the Base-rate "Reset to my data"
  // affordance nor get silently flipped back when the user resets an
  // overridden rate.
  const [recurrence, setRecurrence] = useState<OvertimeRecurrence>('REPEATS');

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

  const ppy = paycheckPeriodsPerYear(period);
  // Wave 15 T3: ONE recurrence knob feeds BOTH annualizations. Pre-fix the
  // OBBBA line annualized (×ppy) while the tax stack treated one period's OT
  // as the whole year's supplemental wages — two different years in one card.
  const periodsCounted = recurrence === 'REPEATS' ? ppy : 1;
  const annualOtGross = totalGross * periodsCounted;

  const taxResult = useMemo(() => {
    if (!tax.ready || !household || !eligiblePerson || !tax.federal || !tax.state) return null;
    // Wave-9 F13: HOURLY persons persist annualSalaryPretax = 0 — their wage
    // base lives in the hourly rate. Patch the eligible person's salary with
    // the annualized base (card's possibly-overridden rate × regular hours ×
    // 52) so OT stacks on a real base. A nonzero stored salary still wins.
    const effectivePersons = persons.map((p) =>
      p.id === eligiblePerson.id && p.employmentType === 'HOURLY' && p.annualSalaryPretax <= 0
        ? { ...p, annualSalaryPretax: baseHourlyRate * p.regularHoursPerWeek * 52 }
        : p,
    );
    // Wave-9 M59: household-wide aggregation (parity with Bonus/Commission)
    // so the marginal bracket reflects the whole return.
    const agg = aggregateHouseholdPretax(effectivePersons, {
      filingStatus: household.filingStatus,
      personCount: persons.length,
      dependentCount: dependents.length,
    });
    return computeSupplementalWageTax({
      baseSalary: agg.totalSalary,
      supplementalWages: annualOtGross,
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
      // Wave-9 F1: OT belongs to the eligible earner.
      perPersonBaseSalary: effectivePersons.map((p) => p.annualSalaryPretax),
      recipientIndex: Math.max(0, effectivePersons.findIndex((p) => p.id === eligiblePerson.id)),
    });
  }, [tax.ready, tax.federal, tax.state, tax.city, household, eligiblePerson, persons, dependents, annualOtGross, baseHourlyRate]);

  // ---- early returns ----

  if (!eligiblePerson) {
    return (
      <CalculatorCard
        title="Overtime"
        headline="—"
        cardId={cardId}
        meaning={
          <EmptyMeaning>
            No eligible person —{' '}
            <InlineLink to="/inputs/persons">
              set Employment type to Hourly or Salaried with overtime
            </InlineLink>{' '}
            to enable this card.
          </EmptyMeaning>
        }
      />
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

  // Wave 17: assumption fields live in the open card's rail — RailReset
  // first; the annualization knobs (pay period + recurrence — plain UI state,
  // never isOverridden) grouped under the View label.
  const rail = (
    <>
      {isOverridden && <RailReset onClick={reset} />}
      <EarnerSelect
        persons={eligible}
        selectedId={eligiblePerson?.id ?? null}
        onChange={setOtEarnerId}
        label="Whose overtime"
      />
      <div className="space-y-1">
        <NumberField
          id="ot-base-rate"
          label="Base hourly rate"
          value={values.baseRate}
          onChange={(v) => setValue('baseRate', v ?? 0)}
          suffix="$/hr"
          step="0.01"
          min={0}
          edited={overriddenKeys.has('baseRate')}
        />
        <p className="text-xs text-muted-foreground">
          Auto-derived from {eligiblePerson.name} (
          {eligiblePerson.employmentType === 'HOURLY' ? 'hourly rate' : 'implied from salary'}
          ). Edit to override.
        </p>
      </div>
      <RailViewGroup>
        <div className="space-y-1">
          <Label htmlFor="ot-period">Pay period</Label>
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
            Hours are entered per row; this sets how they annualize when overtime repeats.
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="ot-recurrence">Recurrence</Label>
          <Select
            value={recurrence}
            onValueChange={(v) => setRecurrence(v as OvertimeRecurrence)}
          >
            <SelectTrigger id="ot-recurrence" aria-label="Recurrence">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="REPEATS">Repeats every period</SelectItem>
              <SelectItem value="ONE_OFF">One-off</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {recurrence === 'REPEATS'
              ? 'Taxes and the OBBBA deduction use the annualized total.'
              : 'Taxes and the OBBBA deduction use just these hours.'}
          </p>
        </div>
      </RailViewGroup>
    </>
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
      <CalculatorCard
        title="Overtime"
        headline="—"
        cardId={cardId}
        rail={rail}
        meaning={<EmptyMeaning>Base hourly rate must be positive. Enter a rate in the rail.</EmptyMeaning>}
      >
        {rowsEditor}
      </CalculatorCard>
    );
  }

  if (totalGross <= 0 || !taxResult || !household) {
    return (
      <CalculatorCard
        title="Overtime"
        headline="—"
        cardId={cardId}
        rail={rail}
        meaning={
          <EmptyMeaning>
            {totalGross <= 0 ? (
              'Enter overtime hours to see the take-home breakdown.'
            ) : (
              <>
                <InlineLink to="/inputs/household">
                  Set up your household profile
                </InlineLink>{' '}
                + tax rules to see overtime tax.
              </>
            )}
          </EmptyMeaning>
        }
      >
        {rowsEditor}
      </CalculatorCard>
    );
  }

  // Headline stays "take-home from this period's entered OT" in both modes:
  // under REPEATS the tax stack runs on the annual OT, so divide back down.
  const overtimeTakeHome = taxResult.bonusTakeHome / periodsCounted;
  // Annualize the premium (×periodsCounted — ppy under REPEATS, 1 for a
  // one-off) before applying the annual cap so the deduction and tax-saved
  // figures reflect the recurrence the user picked.
  // Wave-9 M62: only the QUALIFIED (FLSA half-time) premium feeds OBBBA —
  // totalPremium stays for pay display.
  const annualPremium = (overtime?.totalQualifiedPremium ?? 0) * periodsCounted;
  const obbbaDeduction = obbbaOvertimeDeduction(annualPremium, household.filingStatus);
  const federalMarginalOnOt = annualOtGross > 0 ? taxResult.bonusBreakdown.federal / annualOtGross : 0;
  // federalMarginalOnOt is a rate (fraction); multiply by annual premium for the annual saving.
  const obbbaFederalSaving = obbbaDeduction * federalMarginalOnOt;

  return (
    <CalculatorCard
      title="Overtime"
      cardId={cardId}
      dirty={isOverridden || tax.salaryOverridden}
      meaning={<>Take-home on {formatCurrency(totalGross)} of overtime gross.</>}
      rail={rail}
      headline={
        <span data-testid="ot-takehome">{formatCurrency(overtimeTakeHome)}</span>
      }
    >
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

      {/* Summary — the shared supplemental result block (Wave 18 B7).
          periods=1: the figures below are already per-entered-period; method
          is fixed AGGREGATE (OT has no flat-method toggle — do not add one). */}
      <SupplementalResultBlock
        noun="overtime"
        periods={1}
        method="AGGREGATE"
        rows={{
          federal: taxResult.bonusBreakdown.federal / periodsCounted,
          fica: taxResult.bonusBreakdown.fica / periodsCounted,
          state: taxResult.bonusBreakdown.state / periodsCounted,
          city: taxResult.bonusBreakdown.city / periodsCounted,
          total: taxResult.bonusBreakdown.total / periodsCounted,
          takeHome: overtimeTakeHome,
          rate: taxResult.marginalRateOnBonus,
        }}
      />

      {recurrence === 'REPEATS' && (
        <div className="mt-3 pt-3 border-t text-sm">
          <span className="text-muted-foreground">Estimated annual OT take-home:</span>{' '}
          <span className="font-medium tabular-nums">{formatCurrency(taxResult.bonusTakeHome)}</span>
          {/* T3 review M1: the annual figure is exact; the per-period one is
              its rounded derivative — ≈ plus reversed order so the reader
              isn't invited to hand-multiply two independently rounded
              figures and get a mismatch. */}
          <span className="text-muted-foreground"> (≈ {formatCurrency(overtimeTakeHome)}/period × {ppy})</span>
        </div>
      )}

      {obbbaDeduction > 0 && (
        <div className="mt-3 border-t pt-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <ResultRow label={<><TermTooltip term="OBBBA">OBBBA</TermTooltip> OT deduction est. (annual)</>} value={formatCurrency(obbbaDeduction)} />
            <ResultRow label="Est. annual federal tax saved" value={formatCurrency(obbbaFederalSaving)} testId="ot-obbba-deduction" />
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {recurrence === 'REPEATS' ? (
              <>
                Annual estimate. Annualizes the overtime premium (pay above your regular rate) across{' '}
                {ppy} pay periods, then caps at $12,500 ($25,000 MFJ).
              </>
            ) : (
              <>Annual estimate for this one-off overtime alone, capped at $12,500 ($25,000 MFJ).</>
            )}{' '}
            Does not model the $150k/$300k MAGI phase-out; the deduction sunsets after 2028; FICA and most state
            income taxes still apply.
          </p>
          {overtime && overtime.totalPremium > overtime.totalQualifiedPremium && (
            <p className="text-xs text-muted-foreground mt-1">
              Only the FLSA half-time portion of your premium qualifies — pay above 1.5× is excluded.
            </p>
          )}
        </div>
      )}
      {household.filingStatus === FilingStatus.MFS && (
        <p className="text-xs text-muted-foreground mt-3">
          Married filing separately doesn&#39;t qualify for the OBBBA overtime deduction.
        </p>
      )}

      <p className="text-xs text-muted-foreground mt-3">
        Hours above represent one {PAYCHECK_PERIODS.find((p) => p.id === period)?.label.toLowerCase() ?? 'period'}
        {recurrence === 'REPEATS' ? ', repeated every period for the year' : ' as a one-off'}.
        Overtime is taxed as supplemental wages (same method as bonuses) at {eligiblePerson.name}
        &#39;s marginal rate.
      </p>

      <NotModeledDisclosure footer="For a decision that hinges on overtime (loan qualification, whether an extra shift is worth it), run the numbers past a CPA — the items above can shift the bottom line materially.">
          <li>
            <strong>State daily-overtime rules.</strong> CA owes daily OT over 8
            hours (double-time over 12); NV has a daily rule tied to pay rate.
            The engine never derives OT from a schedule — rows are hours you
            enter, so state daily rules are yours to apply when entering them.
          </li>
          <li>
            <strong>Exempt-status edge cases.</strong> Figures assume the earner
            is OT-eligible (non-exempt). Misclassification, fluctuating-workweek
            plans, and comp-time-in-lieu arrangements are not modeled.
          </li>
          <li>
            <strong><TermTooltip term="OBBBA">OBBBA</TermTooltip> phase-out and sunset.</strong>{' '}
            The deduction estimate ignores the $150k/$300k MAGI phase-out, and
            the provision sunsets after 2028 — above those incomes the real
            deduction is smaller or zero.
          </li>
          <li>
            <strong>State-specific supplemental-wage flat rates.</strong> CA, GA,
            NY, NJ, and others withhold supplemental wages at flat statutory
            rates; the engine applies your ordinary marginal brackets (same treatment
            as the bonus calculator).
          </li>
          <li>
            <strong>FLSA regular-rate inclusions.</strong> Nondiscretionary
            bonuses and commissions legally raise the OT base rate — the base
            rate here is the one you enter.
          </li>
      </NotModeledDisclosure>
    </CalculatorCard>
  );
}
