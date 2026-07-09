import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { useTickersStore } from '@/stores/tickers-store';
import { useFundHoldingsStore } from '@/stores/fund-holdings-store';
import { useRoadmapOverridesStore } from '@/stores/roadmap-overrides-store';
import { useHouseholdStore } from '@/stores/household-store';
import { useSettingsStore } from '@/stores/settings-store';
import { seedResolvedStores } from '../helpers/seed-resolved-stores';

/**
 * W10 S3/S4: Dashboard now gates its render behind useLoadGate over all 15
 * stores it loads. Test resetStores helpers that predate the gate don't seed
 * every one (asset-value-snapshots / holdings / tickers / fund-holdings /
 * roadmap-overrides), and seed household without a no-op `load` — leaving the
 * mount load to flip isLoading and strand the gate on the skeleton. This seeds
 * the extra gated stores resolved-empty with no-op loads (and re-asserts a
 * no-op household load) so the gate settles synchronously.
 */
export function seedDashboardGateStores(): void {
  // Round-3 consolidation: the MECHANISM lives in tests/helpers/
  // seed-resolved-stores.ts; this wrapper keeps its store list (and the
  // household special case, which merges only `load` — its state is
  // caller-seeded).
  seedResolvedStores([
    { store: useAssetValueSnapshotsStore, collections: { assetValueSnapshots: [] } },
    { store: useHoldingsStore, collections: { holdings: [] } },
    { store: useTickersStore, collections: { tickers: [] } },
    { store: useFundHoldingsStore, collections: { fundHoldings: [] } },
    { store: useRoadmapOverridesStore, collections: { overridesByNodeId: new Map() } },
  ]);
  useHouseholdStore.setState((s) => ({ ...s, load: async () => {} } as never));

  // W13: settings joined the Dashboard gate (briefing visit stamps live in
  // app_settings). Seed resolved with null stamps → 'Since <month>' fallback
  // mode; update is a noop so the stamp effect never hits a DB in jsdom.
  useSettingsStore.setState({
    settings: {
      id: 1,
      lastRefreshAt: null,
      refreshCadence: 'EVERY_LAUNCH',
      lastSeenMonth: null,
      lastVisitDate: null,
      briefingBaselineDate: null,
    },
    isLoading: false,
    error: null,
    load: async () => {},
    update: async () => {},
  } as never);

  // W13: pills + widgets live inside the collapsed-by-default Details region.
  // Suites that assert widget/pill behavior seed it open; the collapsed
  // default is covered by dedicated tests that clear this key.
  try {
    window.localStorage.setItem('dashboardDetailsOpen.v1', 'true');
  } catch {
    /* localStorage unavailable in this environment */
  }
}
