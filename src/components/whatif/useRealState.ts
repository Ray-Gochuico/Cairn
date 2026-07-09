import { useMemo } from 'react';
import { captureRealState, type RealState } from '@/lib/scenarios';
import { useLocalToday } from '@/lib/use-local-today';
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
import { useHousingPaymentsStore } from '@/stores/housing-payments-store';
import { useVehicleLeasesStore } from '@/stores/vehicle-leases-store';
import { useCategoriesStore } from '@/stores/categories-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';

export function useRealState(): RealState | null {
  // Live LOCAL month (Wave 11 T10): the projection start month follows
  // useLocalToday so it re-derives at the month flip.
  const todayISO = useLocalToday();
  const household        = useHouseholdStore((s) => s.household);
  const persons          = usePersonsStore((s) => s.persons);
  const loans            = useLoansStore((s) => s.loans);
  const holdings         = useHoldingsStore((s) => s.holdings);
  const accounts         = useAccountsStore((s) => s.accounts);
  const accountSnapshots = useSnapshotsStore((s) => s.snapshots);
  const transactions     = useTransactionsStore((s) => s.transactions);
  // NEW-W7-WI1: prefer Settings → Advanced → Default inflation, fall
  // back to the scenarios-store default (which itself defaults to
  // 0.025). Pre-fix the engine only read the scenarios-store value, so
  // changing Default inflation in Settings had no effect on projections
  // until the user re-seeded the store from settings somehow — a
  // silent override that broke the documented "Settings is the source
  // of truth for household-default rates" invariant.
  const settingsInflation = useSettingsStore((s) => s.settings?.defaultInflation);
  const scenariosInflation = useScenariosStore((s) => s.inflation);
  const inflation        = settingsInflation ?? scenariosInflation;
  // Wave-9 M45 (sibling of NEW-W7-WI1 above): Settings → Advanced → Default
  // return rate wins; the scenarios-store default (0.07) is the fallback.
  const settingsReturnRate = useSettingsStore((s) => s.settings?.defaultReturnRate);
  const scenariosReturnRate = useScenariosStore((s) => s.defaultReturnRate);
  const returnRate       = settingsReturnRate ?? scenariosReturnRate;
  const settings         = useSettingsStore((s) => s.settings);
  const taxRules         = useTaxRulesStore((s) => s.items);
  const defaultCashApy   = settings?.defaultCashApy ?? null;
  const defaultDrawdownTaxRate = settings?.defaultDrawdownTaxRate ?? null;
  const housingPayments  = useHousingPaymentsStore((s) => s.housingPayments);
  const vehicleLeases    = useVehicleLeasesStore((s) => s.vehicleLeases);
  const categories       = useCategoriesStore((s) => s.categories);
  const properties          = usePropertiesStore((s) => s.properties);
  const vehicles            = useVehiclesStore((s) => s.vehicles);
  const assetValueSnapshots = useAssetValueSnapshotsStore((s) => s.assetValueSnapshots);

  return useMemo<RealState | null>(() => {
    if (!household) return null;
    const startISO = todayISO.slice(0, 7);
    return captureRealState({
      accounts,
      accountSnapshots,
      holdings,
      loans,
      loanPayments: [],
      transactions,
      categories,
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
      housingPayments,
      vehicleLeases,
      properties,
      vehicles,
      assetValueSnapshots,
    });
    // NOTE (2026-05-26 revamp):
    // - The pre-revamp hook rewrote `real.baselineMonthlyExpenses` when the
    //   household had a custom monthlyExpenseBaseline. Dropped — the engine
    //   no longer reads that field; expenses come from `payload.expensePeriods`.
    // - The pre-revamp hook also threaded `settings.autoInvestSalarySurplus`
    //   into RealState.defaults. Dropped — routing now flows through
    //   `payload.gapAllocation` instead of a household-level setting.
    // - 2026-05-27 v1.1: housingPayments + vehicleLeases are summed into
    //   step.expenses per projection month so rentals/leases that end stop
    //   contributing automatically.
  }, [household, persons, loans, holdings, accounts, accountSnapshots, transactions, categories, inflation, returnRate, defaultCashApy, defaultDrawdownTaxRate, taxRules, housingPayments, vehicleLeases, properties, vehicles, assetValueSnapshots, todayISO]);
}
