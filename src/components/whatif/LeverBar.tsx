import { useState } from 'react';
import { Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useScenariosStore } from '@/stores/scenarios-store';
import { useHouseholdStore } from '@/stores/household-store';
import ExtraLoanPaymentsPopover from '@/components/whatif/levers/ExtraLoanPaymentsPopover';
import LumpSumsPopover from '@/components/whatif/levers/LumpSumsPopover';
import ExpensePeriodsPopover from '@/components/whatif/levers/ExpensePeriodsPopover';
import ReturnSchedulePopover from '@/components/whatif/levers/ReturnSchedulePopover';
import IncomePopover from '@/components/whatif/levers/IncomePopover';
import ContributionsPopover from '@/components/whatif/levers/ContributionsPopover';
import InflationPopover from '@/components/whatif/levers/InflationPopover';
import SwrLeverPill from '@/components/whatif/SwrLeverPill';
import { useSurplusFlowPreview } from '@/components/whatif/useSurplusFlowPreview';
import { formatCompactCurrency } from '@/lib/format';

type LeverKey = 'loans' | 'lumpSums' | 'expenses' | 'returns' | 'income' | 'contributions' | 'inflation';

export default function LeverBar() {
  const scenarios = useScenariosStore((s) => s.scenarios);
  const updateLever = useScenariosStore((s) => s.updateLever);
  const household = useHouseholdStore((s) => s.household);
  const active = scenarios.find((s) => s.isActive);
  const [openLever, setOpenLever] = useState<LeverKey | null>(null);

  // Task β2 — preview of the engine's salary-surplus routing for the current
  // month. The pill below branches on `.destination` to show either an
  // "auto $X/mo" badge (investments) or a "going to cash" Info icon (the new
  // default since migration 0029). Hook is called unconditionally before the
  // early return below to keep React's rules of hooks happy.
  const surplus = useSurplusFlowPreview(active?.leverPayload ?? null);

  if (!active) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        No active scenario. Create a scenario to start tuning levers.
      </div>
    );
  }

  const lp = active.leverPayload;
  const counts: Record<LeverKey, number> = {
    loans: lp.extraLoanPayments.length,
    lumpSums: lp.lumpSums.length,
    expenses: lp.expensePeriods.length,
    returns: Object.keys(lp.returns.overrides).length,
    income: lp.income.perPerson.reduce((acc, p) => acc + p.events.length, 0),
    contributions: lp.contributions.length,
    inflation: Object.keys(lp.inflation?.overrides ?? {}).length,
  };

  const Pill = ({ k, label }: { k: LeverKey; label: string }) => (
    <Button
      variant={openLever === k ? 'default' : 'outline'}
      size="sm"
      onClick={() => setOpenLever((cur) => (cur === k ? null : k))}
      aria-label={label}
    >
      {label}{counts[k] > 0 ? ` · ${counts[k]}` : ''}
    </Button>
  );

  // Determine whether the returns lever is in its untouched default state
  // (7% compounding, no per-year overrides). When true, surface a muted
  // "(default)" hint so users know the 7% assumption is active.
  const returnsIsDefault =
    lp.returns.defaultRate === 0.07 &&
    Object.keys(lp.returns.overrides).length === 0;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Pill k="loans"         label="Loans" />
        <Pill k="lumpSums"      label="Lump sums" />
        <Pill k="expenses"      label="Expenses" />
        <Button
          variant={openLever === 'returns' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setOpenLever((cur) => (cur === 'returns' ? null : 'returns'))}
          aria-label="Returns"
          className="flex flex-col items-start h-auto py-1 leading-tight"
        >
          <span>Returns</span>
          {returnsIsDefault && (
            <span
              data-testid="returns-default-hint"
              className="text-xs text-muted-foreground italic font-normal"
            >
              using default 7%
            </span>
          )}
        </Button>
        <Pill k="income"        label="Income" />
        {/* Task β2 — Contributions pill UX branches on the surplus destination:
            - segments configured → "Contributions · N" (unchanged)
            - no segments, destination=investments, amount > 0 → "auto $X/mo" badge
            - no segments, destination=cash,        amount > 0 → cash-hint Info icon
            - no segments, amount = 0 → fallback generic Info icon
            The title attribute carries the discoverable hover copy. */}
        {(() => {
          const hasSegments = counts.contributions > 0;
          const hasSurplus = surplus.amount > 0;
          // Transitional bridge (α3 → γ3): the surplus now exposes a per-bucket
          // breakdown rather than a 'cash'|'investments' destination tag. We
          // surface the auto-invest badge whenever ANY non-cash routing is
          // configured; the cash-hint icon when everything flows to cash.
          // γ3 will rewrite the rendered copy to be per-bucket aware.
          const routedToInvestments = surplus.taxAdvantaged + surplus.brokerage;
          const showAutoInvestBadge =
            !hasSegments && hasSurplus && routedToInvestments > 0;
          const showCashHint =
            !hasSegments && hasSurplus && routedToInvestments === 0;
          const showFallbackIcon = !hasSegments && !hasSurplus;
          const formattedAmount = formatCompactCurrency(surplus.amount);
          const pillTitle = hasSegments
            ? undefined
            : showAutoInvestBadge
            ? `Monthly surplus of ${formattedAmount} auto-invests when no segments are active`
            : showCashHint
            ? 'Surplus is going to cash. Add a segment to invest.'
            : 'Monthly surplus accumulates here when no segments are active';
          return (
            <Button
              variant={openLever === 'contributions' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setOpenLever((cur) => (cur === 'contributions' ? null : 'contributions'))}
              aria-label="Contributions"
              title={pillTitle}
              className="flex items-center gap-1"
            >
              Contributions
              {hasSegments && ` · ${counts.contributions}`}
              {showAutoInvestBadge && (
                <span
                  data-testid="contributions-auto-invest-badge"
                  className="text-xs text-muted-foreground font-normal"
                >
                  {' · auto '}
                  {formattedAmount}/mo
                </span>
              )}
              {showCashHint && (
                <Info
                  data-testid="contributions-cash-hint-icon"
                  className="h-3 w-3 text-muted-foreground"
                  aria-hidden
                />
              )}
              {showFallbackIcon && (
                <Info
                  data-testid="contributions-auto-invest-icon"
                  className="h-3 w-3 text-muted-foreground"
                  aria-hidden
                />
              )}
            </Button>
          );
        })()}
        {active.id != null && household && (
          <SwrLeverPill
            swrOverride={lp.swrOverride}
            householdWithdrawalRate={household.withdrawalRate}
            onChange={(next) => {
              void updateLever(active.id!, { swrOverride: next });
            }}
          />
        )}
        {/* 8th pill — per-scenario inflation lever (Task #15). Appended LAST
            to avoid conflict with Wave B's Contributions pill rework (T25). */}
        <Pill k="inflation" label="Inflation" />
      </div>

      <ExtraLoanPaymentsPopover
        open={openLever === 'loans'}
        onOpenChange={(o) => setOpenLever(o ? 'loans' : null)}
      />
      <LumpSumsPopover
        open={openLever === 'lumpSums'}
        onOpenChange={(o) => setOpenLever(o ? 'lumpSums' : null)}
      />
      <ExpensePeriodsPopover
        open={openLever === 'expenses'}
        onOpenChange={(o) => setOpenLever(o ? 'expenses' : null)}
      />
      <ReturnSchedulePopover
        open={openLever === 'returns'}
        onOpenChange={(o) => setOpenLever(o ? 'returns' : null)}
      />
      <IncomePopover
        open={openLever === 'income'}
        onOpenChange={(o) => setOpenLever(o ? 'income' : null)}
      />
      <ContributionsPopover
        open={openLever === 'contributions'}
        onOpenChange={(o) => setOpenLever(o ? 'contributions' : null)}
      />
      <InflationPopover
        open={openLever === 'inflation'}
        onOpenChange={(o) => setOpenLever(o ? 'inflation' : null)}
      />
    </>
  );
}
