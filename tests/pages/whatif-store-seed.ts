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
import { useTickersStore } from '@/stores/tickers-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useHousingPaymentsStore } from '@/stores/housing-payments-store';
import { useInterviewAnswersStore } from '@/stores/interview-answers-store';
import { useSettingsStore } from '@/stores/settings-store';
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
    // R4 (D-R4-9): the gate grew by five — the four interview-context slices
    // useInterview() adds for the G9 census, plus settings (now page-loaded).
    // Settings seeds NO collection: callers prime `settings` themselves
    // (setSettings) before or after this, and it must survive either order.
    { store: useTickersStore, collections: { tickers: [] } },
    { store: useDependentsStore, collections: { dependents: [] } },
    { store: useHousingPaymentsStore, collections: { housingPayments: [] } },
    { store: useInterviewAnswersStore, collections: { answersByKey: new Map() } },
    { store: useSettingsStore, collections: {} },
  ]);
}
