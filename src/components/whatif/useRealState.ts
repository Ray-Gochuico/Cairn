import { useMemo } from 'react';
import { captureRealState, type RealState } from '@/lib/scenarios';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useLoansStore } from '@/stores/loans-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useScenariosStore } from '@/stores/scenarios-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';

function todayMonthISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function useRealState(): RealState | null {
  const household        = useHouseholdStore((s) => s.household);
  const persons          = usePersonsStore((s) => s.persons);
  const loans            = useLoansStore((s) => s.loans);
  const holdings         = useHoldingsStore((s) => s.holdings);
  const accounts         = useAccountsStore((s) => s.accounts);
  const accountSnapshots = useSnapshotsStore((s) => s.snapshots);
  const transactions     = useTransactionsStore((s) => s.transactions);
  const inflation        = useScenariosStore((s) => s.inflation);
  const returnRate       = useScenariosStore((s) => s.defaultReturnRate);
  const settings         = useSettingsStore((s) => s.settings);
  const taxRules         = useTaxRulesStore((s) => s.items);
  const defaultCashApy   = settings?.defaultCashApy ?? null;
  const defaultDrawdownTaxRate = settings?.defaultDrawdownTaxRate ?? null;

  return useMemo<RealState | null>(() => {
    if (!household) return null;
    const startISO = todayMonthISO();
    return captureRealState({
      accounts,
      accountSnapshots,
      holdings,
      loans,
      loanPayments: [],
      transactions,
      household,
      persons,
      appSettings: {
        defaultInflation: inflation,
        defaultReturnRate: returnRate,
        defaultCashApy,
        defaultDrawdownTaxRate,
      },
      startISO,
      taxRules,
    });
    // NOTE (2026-05-26 revamp):
    // - The pre-revamp hook rewrote `real.baselineMonthlyExpenses` when the
    //   household had a custom monthlyExpenseBaseline. Dropped — the engine
    //   no longer reads that field; expenses come from `payload.expensePeriods`.
    // - The pre-revamp hook also threaded `settings.autoInvestSalarySurplus`
    //   into RealState.defaults. Dropped — routing now flows through
    //   `payload.gapAllocation` instead of a household-level setting.
  }, [household, persons, loans, holdings, accounts, accountSnapshots, transactions, inflation, returnRate, defaultCashApy, defaultDrawdownTaxRate, taxRules]);
}
