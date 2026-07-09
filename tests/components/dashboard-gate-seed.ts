import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { useTickersStore } from '@/stores/tickers-store';
import { useFundHoldingsStore } from '@/stores/fund-holdings-store';
import { useRoadmapOverridesStore } from '@/stores/roadmap-overrides-store';
import { useHouseholdStore } from '@/stores/household-store';

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
  const noop = async () => {};
  useAssetValueSnapshotsStore.setState({ assetValueSnapshots: [], isLoading: false, error: null, load: noop } as never);
  useHoldingsStore.setState({ holdings: [], isLoading: false, error: null, load: noop } as never);
  useTickersStore.setState({ tickers: [], isLoading: false, error: null, load: noop } as never);
  useFundHoldingsStore.setState({ fundHoldings: [], isLoading: false, error: null, load: noop } as never);
  useRoadmapOverridesStore.setState({ overridesByNodeId: new Map(), isLoading: false, error: null, load: noop } as never);
  useHouseholdStore.setState((s) => ({ ...s, load: noop } as never));
}
