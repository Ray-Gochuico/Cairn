import { useCallback, useMemo, useState } from 'react';
import { useHouseholdStore } from '@/stores/household-store';
import { CalculatorCard, EmptyMeaning, RailReset, RailViewGroup } from './CalculatorCard';
import {
  computeSupplementalWageTax,
  flatSupplementalWithholding,
} from '@/lib/calculators/supplemental-wage';
import { useSupplementalMethod } from '@/lib/calculators/use-supplemental-method';
import { SupplementalMethodToggle } from '@/components/calculators/SupplementalMethodToggle';
import {
  SupplementalResultBlock,
  type SupplementalTaxRows,
} from '@/components/calculators/SupplementalResultBlock';
import { useHouseholdTaxContext } from '@/lib/calculators/use-household-tax-context';
import { useCalculatorState } from '@/lib/calculator-state';
import { NumberField } from '@/components/calculators/NumberField';
import { NotModeledDisclosure } from '@/components/calculators/NotModeledDisclosure';
import { ResultRow } from '@/components/calculators/ResultRow';
import { EarnerSelect } from '@/components/calculators/EarnerSelect';
import { useSelectedEarner } from '@/lib/calculators/use-selected-earner';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/lib/format';
import { CONTRIBUTION_LIMITS_2026 } from '@/lib/contribution-limits';
import { TermTooltip } from '@/components/ui/glossary-tooltip';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import type { BonusFrequency } from '@/types/schema';
import { InlineLink } from '@/components/calculators/InlineLink';

type SupplementalType = 'BONUS' | 'COMMISSION';
type CommissionFrequency = 'MONTHLY' | 'QUARTERLY';

// D12: the segment choice persists under its own new key; the per-type
// calc-state / method keys below stay on the legacy ids so in-session edits
// survive the merge and never bleed across segments.
const TYPE_KEY = 'calc-suppl-type:supplemental-pay';

function readType(): SupplementalType {
  try {
    return sessionStorage.getItem(TYPE_KEY) === 'COMMISSION' ? 'COMMISSION' : 'BONUS';
  } catch {
    return 'BONUS';
  }
}

/** Segment persistence — same try/catch sessionStorage idiom as useSupplementalMethod. */
function useSupplementalType(): [SupplementalType, (t: SupplementalType) => void] {
  const [type, setType] = useState<SupplementalType>(readType);
  const set = useCallback((t: SupplementalType) => {
    setType(t);
    try {
      sessionStorage.setItem(TYPE_KEY, t);
    } catch {
      // sessionStorage unavailable — in-memory state still drives the UI.
    }
  }, []);
  return [type, set];
}

const SEG_BTN_BASE = 'px-2 py-0.5 text-xs transition-colors';
const SEG_BTN_ACTIVE = 'bg-primary text-primary-foreground';

interface SupplementalPayCardProps {
  cardId?: string;
}

/**
 * Wave 18 B7 — the merged Supplemental pay card (Bonus + Commission).
 * Per-segment state rides the PRESERVED legacy keys (calc-state:bonus-tax /
 * calc-state:commission-tax, calc-suppl-method:*) — D12. Both segments use
 * the per-EVENT amount + frequency semantic (D15) with an unconditional
 * annual echo line replacing the old isConsistent checkbox. The commission
 * 401(k) deferral is presentation-only cash routing (D1): take-home = gross
 * − tax; the engine keeps zero knowledge of the deferral.
 */
export function SupplementalPayCard({ cardId }: SupplementalPayCardProps = {}) {
  const { household } = useHouseholdStore();
  const tax = useHouseholdTaxContext();
  // D7 (Wave 18): EFFECTIVE persons — bar salary overrides ride through the
  // context; the persons store is never read for salary-bearing math here.
  const persons = tax.persons;
  const [type, setType] = useSupplementalType();
  const noun = type === 'BONUS' ? 'bonus' : 'commission';

  // Wave 15's right-person rule, per type: the person with an expected
  // amount, else persons[0].
  const bonusDefaultEarner =
    persons.find((p) => (p.expectedBonus ?? 0) > 0) ?? persons[0] ?? null;
  const commissionDefaultEarner =
    persons.find((p) => (p.expectedCommission ?? 0) > 0) ?? persons[0] ?? null;
  const defaultEarner = type === 'BONUS' ? bonusDefaultEarner : commissionDefaultEarner;
  const personIds = useMemo(
    () => persons.map((p) => p.id).filter((id): id is number => id != null),
    [persons],
  );
  const [earnerId, setEarnerId] = useSelectedEarner(
    cardId ?? 'supplemental-pay',
    defaultEarner?.id ?? null,
    personIds,
  );
  const earner = persons.find((p) => p.id === earnerId) ?? defaultEarner;

  // D12/D15: BOTH state hooks run unconditionally (hooks rules); the segment
  // picks the driver. Bonus keeps the landed per-event value key `bonus`;
  // commission's input changed semantics (annual → per-event), so it gets a
  // fresh `perCheck` key — reusing `annualCommission` would misread a stale
  // in-flight annual override as a 12× per-check figure.
  const bonusDefaults = useMemo(() => {
    const frequency = (earner?.expectedBonusFrequency ?? 'ANNUAL') as BonusFrequency;
    return {
      bonus: (earner?.expectedBonus ?? 0) / (frequency === 'QUARTERLY' ? 4 : 1),
      frequency,
    };
  }, [earner]);
  const commissionDefaults = useMemo(() => {
    const frequency = (earner?.expectedCommissionFrequency ?? 'MONTHLY') as CommissionFrequency;
    const periods = frequency === 'MONTHLY' ? 12 : 4;
    return { perCheck: (earner?.expectedCommission ?? 0) / periods, frequency };
  }, [earner]);
  const bonusState = useCalculatorState('bonus-tax', bonusDefaults);
  const commissionState = useCalculatorState('commission-tax', commissionDefaults);
  const [bonusMethod, setBonusMethod] = useSupplementalMethod('bonus-tax');
  const [commissionMethod, setCommissionMethod] = useSupplementalMethod('commission-tax');
  const method = type === 'BONUS' ? bonusMethod : commissionMethod;
  const setMethod = type === 'BONUS' ? setBonusMethod : setCommissionMethod;
  const active = type === 'BONUS' ? bonusState : commissionState;

  const periods =
    type === 'BONUS'
      ? bonusState.values.frequency === 'QUARTERLY'
        ? 4
        : 1
      : commissionState.values.frequency === 'MONTHLY'
        ? 12
        : 4;
  const perEvent =
    type === 'BONUS' ? (bonusState.values.bonus ?? 0) : (commissionState.values.perCheck ?? 0);
  const annualWages = perEvent * periods;
  const recipientIndex = Math.max(0, persons.findIndex((p) => p.id === earner?.id));

  const result = useMemo(() => {
    if (!tax.ready || !household || !tax.federal || !tax.state) return null;
    return computeSupplementalWageTax({
      baseSalary: tax.totalSalary,
      supplementalWages: annualWages,
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
      // Wave-9 F1: per-earner SS wage bases; the wages ride on the earner.
      perPersonBaseSalary: persons.map((p) => p.annualSalaryPretax),
      recipientIndex,
    });
  }, [tax.ready, tax.federal, tax.state, tax.city, tax.totalSalary, tax.aggregatedPretax, household, annualWages, persons, recipientIndex]);

  // Method-resolved ANNUAL rows (the exact math both old cards used).
  const rows: SupplementalTaxRows | null = useMemo(() => {
    if (!result || annualWages <= 0) return null;
    const b = result.bonusBreakdown;
    if (method === 'FLAT') {
      const flatFederal = flatSupplementalWithholding(annualWages);
      const total = flatFederal + b.fica + b.state + b.city;
      return {
        federal: flatFederal,
        fica: b.fica,
        state: b.state,
        city: b.city,
        total,
        takeHome: annualWages - total, // D1: NO deferral subtraction
        rate: total / annualWages, // effective withholding rate (Wave-15 label)
      };
    }
    return {
      federal: b.federal,
      fica: b.fica,
      state: b.state,
      city: b.city,
      total: b.total,
      takeHome: annualWages - b.total,
      rate: result.marginalRateOnBonus,
    };
  }, [result, method, annualWages]);

  // D1 — commission-only 401(k) routing (informational, OUTSIDE the tax
  // pipeline; the engine never sees it). Wave-9 F2: §402(g) is per employee.
  const deferral = useMemo(() => {
    if (type !== 'COMMISSION' || !earner || annualWages <= 0) return null;
    const pct = earner.pretax401kPct ?? 0;
    const own401k = Math.min(
      earner.annualSalaryPretax * pct,
      CONTRIBUTION_LIMITS_2026.EMPLOYEE_401K,
    );
    const remainingCap = Math.max(0, CONTRIBUTION_LIMITS_2026.EMPLOYEE_401K - own401k);
    const annualDeferral = Math.min(annualWages * pct, remainingCap);
    return { annualDeferral, capRemainingAfter: remainingCap - annualDeferral };
  }, [type, earner, annualWages]);

  const rail = (
    <>
      {active.isOverridden && <RailReset onClick={active.reset} />}
      <div role="group" aria-label="Pay type" className="inline-flex self-start rounded border overflow-hidden">
        <button
          type="button"
          aria-pressed={type === 'BONUS'}
          onClick={() => setType('BONUS')}
          className={cn(SEG_BTN_BASE, type === 'BONUS' ? SEG_BTN_ACTIVE : '')}
        >
          Bonus
        </button>
        <button
          type="button"
          aria-pressed={type === 'COMMISSION'}
          onClick={() => setType('COMMISSION')}
          className={cn(SEG_BTN_BASE, 'border-l', type === 'COMMISSION' ? SEG_BTN_ACTIVE : '')}
        >
          Commission
        </button>
      </div>
      <EarnerSelect
        persons={persons}
        selectedId={earner?.id ?? null}
        onChange={setEarnerId}
        label={`Who receives this ${noun}`}
      />
      {type === 'BONUS' ? (
        <>
          <NumberField
            id="bonus-override"
            label={`Bonus amount${bonusState.values.frequency === 'QUARTERLY' ? ' (per quarter)' : ''}`}
            value={bonusState.values.bonus}
            onChange={(v) => bonusState.setValue('bonus', v ?? 0)}
            suffix="$"
            step="100"
            min={0}
            edited={bonusState.overriddenKeys.has('bonus')}
          />
          <div className="space-y-1">
            <Label htmlFor="bonus-frequency">Bonus frequency</Label>
            <Select
              value={bonusState.values.frequency}
              onValueChange={(v) => bonusState.setValue('frequency', v as BonusFrequency)}
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
        </>
      ) : (
        <>
          <NumberField
            id="commission-per-check"
            label="Commission per check"
            value={commissionState.values.perCheck}
            onChange={(v) => commissionState.setValue('perCheck', v ?? 0)}
            suffix="$"
            step="100"
            min={0}
            edited={commissionState.overriddenKeys.has('perCheck')}
          />
          <div className="space-y-1">
            <Label htmlFor="commission-frequency">Frequency</Label>
            <Select
              value={commissionState.values.frequency}
              onValueChange={(v) =>
                commissionState.setValue('frequency', v as CommissionFrequency)
              }
            >
              <SelectTrigger id="commission-frequency" aria-label="Frequency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MONTHLY">Monthly (12/yr)</SelectItem>
                <SelectItem value="QUARTERLY">Quarterly (4/yr)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}
      <RailViewGroup>
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm">Withholding method</span>
          <SupplementalMethodToggle method={method} onChange={setMethod} />
        </div>
      </RailViewGroup>
    </>
  );

  if (!result) {
    return (
      <CalculatorCard
        title="Supplemental pay"
        headline="—"
        cardId={cardId}
        rail={rail}
        meaning={
          <EmptyMeaning>
            <InlineLink to="/inputs/household">Set up your household profile</InlineLink>{' '}
            + tax rules to see {noun} tax.
          </EmptyMeaning>
        }
      />
    );
  }

  if (perEvent <= 0 || !rows) {
    return (
      <CalculatorCard
        title="Supplemental pay"
        headline="—"
        cardId={cardId}
        rail={rail}
        meaning={
          <EmptyMeaning>
            {type === 'BONUS'
              ? 'Enter a bonus amount to see the bonus tax breakdown.'
              : 'Enter a commission amount to see the tax breakdown.'}
          </EmptyMeaning>
        }
      />
    );
  }

  const perEventTakeHome = rows.takeHome / periods;
  const annualTakeHome = rows.takeHome;
  const annualDeferral = deferral?.annualDeferral ?? 0;
  const capRemainingAfter = deferral?.capRemainingAfter ?? 0;

  return (
    <CalculatorCard
      title="Supplemental pay"
      cardId={cardId}
      dirty={active.isOverridden || tax.salaryOverridden}
      meaning={
        <>
          After an estimated {formatCurrency(rows.total / periods)} tax on a{' '}
          {formatCurrency(perEvent)} {noun}.
        </>
      }
      rail={rail}
      headline={<span data-testid="supplemental-headline">{formatCurrency(perEventTakeHome)}</span>}
    >
      <SupplementalResultBlock noun={noun} periods={periods} method={method} rows={rows}>
        {/* D15: the unconditional annual echo — honest for one-offs too
            (conditional framing). Replaces the isConsistent checkbox. */}
        <p className="text-sm" data-testid="supplemental-annual-echo">
          <span className="text-muted-foreground">If this repeats:</span>{' '}
          <span className="font-medium tabular-nums">
            {formatCurrency(annualTakeHome)}/yr take-home
          </span>
          {periods > 1 && (
            <span className="text-muted-foreground">
              {' '}
              ({periods} × {formatCurrency(perEventTakeHome)})
            </span>
          )}
        </p>
        {type === 'COMMISSION' && annualDeferral > 0 && earner && (
          <div className="text-sm space-y-1">
            <ResultRow
              label="401(k) from this commission (annual)"
              value={
                <>
                  {formatCurrency(annualDeferral)}
                  <span className="text-xs text-muted-foreground ml-1">
                    — {formatCurrency(capRemainingAfter)} of{' '}
                    {persons.length > 1 ? `${earner.name}'s` : 'your'}{' '}
                    {formatCurrency(CONTRIBUTION_LIMITS_2026.EMPLOYEE_401K)} cap remains
                  </span>
                </>
              }
            />
            <ResultRow
              label="Cash in pocket after deferral (annual)"
              value={formatCurrency(annualTakeHome - annualDeferral)}
            />
            <p className="text-xs text-muted-foreground">
              The deferral&#39;s income-tax savings aren&#39;t modeled here — your actual tax will
              be slightly lower.
            </p>
          </div>
        )}
      </SupplementalResultBlock>
      <NotModeledDisclosure
        footer={
          type === 'BONUS'
            ? 'For a high-stakes bonus decision (negotiating, deciding whether to defer), run the numbers past a CPA — the items above can each shift the bottom line by hundreds to thousands of dollars.'
            : 'For a planning decision tied to commission (mortgage qualification, quarterly estimated taxes), run the numbers past a CPA — the items above can each shift the bottom line by hundreds to thousands of dollars per check.'
        }
      >
        {type === 'BONUS' ? (
          <>
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
              <TermTooltip term="NIIT">NIIT</TermTooltip> (3.8% net investment
              income tax) — applies to investment income, not the bonus itself.
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
          </>
        ) : (
          <>
            <li>
              <strong>Aggregate vs. flat-rate withholding.</strong> Like bonuses,
              commission is a "supplemental wage" — the IRS allows either the 22%
              flat rate (37% above $1M — mandatory, not an employer option) or the
              aggregate method. Use the Aggregate / Flat 22% toggle above to compare
              both; the flat figure is federal withholding (reconciles at filing).
              State supplemental flat rates are still not modeled.
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
              <TermTooltip term="NIIT">NIIT</TermTooltip> (3.8% net investment
              income tax) — applies to investment income, not commission wages.
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
          </>
        )}
      </NotModeledDisclosure>
    </CalculatorCard>
  );
}
