import { useHoldingsStore } from '@/stores/holdings-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useCategoriesStore } from '@/stores/categories-store';
import { useRoadmapOverridesStore } from '@/stores/roadmap-overrides-store';
import { seedResolvedStores } from '../helpers/seed-resolved-stores';

/**
 * WhatIf now gates its render behind `useLoadGate` over the factory stores it
 * consumes (W10 M33). The WhatIf test files mock scenarios/loans/household/
 * persons but leave the remaining factory stores REAL — whose mount `load()`
 * flips isLoading:true and would leave the gate unsettled (skeleton) in a
 * DB-less test. Seed those real stores resolved-empty with a no-op load so
 * the gate settles synchronously, matching the pre-gate render behavior.
 */
export function seedWhatIfRealStores(): void {
  // Round-3 consolidation: the MECHANISM lives in tests/helpers/
  // seed-resolved-stores.ts; this wrapper keeps its store list.
  seedResolvedStores([
    { store: useHoldingsStore, collections: { holdings: [] } },
    { store: useAccountsStore, collections: { accounts: [] } },
    { store: useSnapshotsStore, collections: { snapshots: [] } },
    { store: useTransactionsStore, collections: { transactions: [] } },
    { store: usePropertiesStore, collections: { properties: [] } },
    { store: useVehiclesStore, collections: { vehicles: [] } },
    { store: useAssetValueSnapshotsStore, collections: { assetValueSnapshots: [] } },
    // W3: the page's gate grew by three stores (contributions + categories +
    // roadmap-overrides feed useRoadmap's context for the model-gaps G9 row).
    // seedResolvedStores seeds ANY collection field, so the overrides Map goes
    // through the same mechanism — no bespoke setState needed.
    { store: useContributionsStore, collections: { contributions: [] } },
    { store: useCategoriesStore, collections: { categories: [] } },
    { store: useRoadmapOverridesStore, collections: { overridesByNodeId: new Map() } },
  ]);
}
