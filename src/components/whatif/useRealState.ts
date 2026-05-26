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

  return useMemo<RealState | null>(() => {
    if (!household) return null;
    const startISO = todayMonthISO();
    const real = captureRealState({
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
      },
      startISO,
      taxRules,
    });
    const expensesOverride = (household as unknown as { monthlyExpenseBaseline?: number }).monthlyExpenseBaseline;
    if (typeof expensesOverride === 'number' && expensesOverride > 0) {
      return { ...real, baselineMonthlyExpenses: expensesOverride };
    }
    return real;
  }, [household, persons, loans, holdings, accounts, accountSnapshots, transactions, inflation, returnRate, defaultCashApy, taxRules]);
}
