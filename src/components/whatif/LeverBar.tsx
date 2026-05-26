import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useScenariosStore } from '@/stores/scenarios-store';
import { useHouseholdStore } from '@/stores/household-store';
import ExtraLoanPaymentsPopover from '@/components/whatif/levers/ExtraLoanPaymentsPopover';
import LumpSumsPopover from '@/components/whatif/levers/LumpSumsPopover';
import ExpensePeriodsPopover from '@/components/whatif/levers/ExpensePeriodsPopover';
import ReturnSchedulePopover from '@/components/whatif/levers/ReturnSchedulePopover';
import IncomePopover from '@/components/whatif/levers/IncomePopover';
import ContributionsPopover from '@/components/whatif/levers/ContributionsPopover';
import SwrLeverPill from '@/components/whatif/SwrLeverPill';

type LeverKey = 'loans' | 'lumpSums' | 'expenses' | 'returns' | 'income' | 'contributions';

export default function LeverBar() {
  const scenarios = useScenariosStore((s) => s.scenarios);
  const updateLever = useScenariosStore((s) => s.updateLever);
  const household = useHouseholdStore((s) => s.household);
  const active = scenarios.find((s) => s.isActive);
  const [openLever, setOpenLever] = useState<LeverKey | null>(null);

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

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Pill k="loans"         label="Loans" />
        <Pill k="lumpSums"      label="Lump sums" />
        <Pill k="expenses"      label="Expenses" />
        <Pill k="returns"       label="Returns" />
        <Pill k="income"        label="Income" />
        <Pill k="contributions" label="Contributions" />
        {active.id != null && household && (
          <SwrLeverPill
            swrOverride={lp.swrOverride}
            householdWithdrawalRate={household.withdrawalRate}
            onChange={(next) => {
              void updateLever(active.id!, { swrOverride: next });
            }}
          />
        )}
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
    </>
  );
}
