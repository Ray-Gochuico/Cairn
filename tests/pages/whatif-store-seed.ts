import { useHoldingsStore } from '@/stores/holdings-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';

/**
 * WhatIf now gates its render behind `useLoadGate` over the factory stores it
 * consumes (W10 M33). The WhatIf test files mock scenarios/loans/household/
 * persons but leave the remaining factory stores REAL — whose mount `load()`
 * flips isLoading:true and would leave the gate unsettled (skeleton) in a
 * DB-less test. Seed those real stores resolved-empty with a no-op load so
 * the gate settles synchronously, matching the pre-gate render behavior.
 */
export function seedWhatIfRealStores(): void {
  useHoldingsStore.setState({ holdings: [], isLoading: false, error: null, load: async () => {} } as never);
  useAccountsStore.setState({ accounts: [], isLoading: false, error: null, load: async () => {} } as never);
  useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null, load: async () => {} } as never);
  useTransactionsStore.setState({ transactions: [], isLoading: false, error: null, load: async () => {} } as never);
  usePropertiesStore.setState({ properties: [], isLoading: false, error: null, load: async () => {} } as never);
  useVehiclesStore.setState({ vehicles: [], isLoading: false, error: null, load: async () => {} } as never);
  useAssetValueSnapshotsStore.setState({ assetValueSnapshots: [], isLoading: false, error: null, load: async () => {} } as never);
}
