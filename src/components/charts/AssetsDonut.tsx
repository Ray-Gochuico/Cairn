import { useEffect, useMemo } from 'react';
import DonutChartCard, { type DonutSlice } from './DonutChartCard';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import {
  latestAssetValue,
  latestSnapshotForAccount,
} from '@/lib/latest-value';
import { formatCurrency } from '@/lib/format';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const EMPTY_SLICES: DonutSlice[] = [];

/**
 * Per-entity composition of the household's assets at the current moment.
 * One slice per account / property / vehicle that has a positive latest
 * value (latest account_snapshot ≤ today for accounts; latest
 * asset_value_snapshot ≤ today or `currentEstimatedValue` fallback for
 * properties and vehicles).
 *
 * Excludes properties/vehicles marked `excludedFromNetWorth=true` per the
 * spec § "Two donuts". Sits alongside `LiabilitiesDonut` on the Net Worth
 * page below the time-series chart.
 */
export default function AssetsDonut() {
  const accounts = useAccountsStore((s) => s.accounts);
  const loadAccounts = useAccountsStore((s) => s.load);
  const snapshots = useSnapshotsStore((s) => s.snapshots);
  const loadSnapshots = useSnapshotsStore((s) => s.load);
  const properties = usePropertiesStore((s) => s.properties);
  const loadProperties = usePropertiesStore((s) => s.load);
  const vehicles = useVehiclesStore((s) => s.vehicles);
  const loadVehicles = useVehiclesStore((s) => s.load);
  const assetValueSnapshots = useAssetValueSnapshotsStore(
    (s) => s.assetValueSnapshots,
  );
  const loadAssetValueSnapshots = useAssetValueSnapshotsStore((s) => s.load);

  useEffect(() => {
    loadAccounts();
    loadSnapshots();
    loadProperties();
    loadVehicles();
    loadAssetValueSnapshots();
  }, [
    loadAccounts,
    loadSnapshots,
    loadProperties,
    loadVehicles,
    loadAssetValueSnapshots,
  ]);

  const slices = useMemo<DonutSlice[]>(() => {
    const today = new Date().toISOString().slice(0, 10);
    const out: DonutSlice[] = [];

    for (const acc of accounts) {
      if (acc.id == null) continue;
      if (acc.excludedFromNetWorth) continue;
      const value = latestSnapshotForAccount(acc.id, snapshots, today);
      if (value > 0) out.push({ name: acc.name, value });
    }
    for (const p of properties) {
      if (p.id == null) continue;
      if (p.excludedFromNetWorth) continue;
      const value = latestAssetValue(
        assetValueSnapshots,
        'PROPERTY',
        p.id,
        today,
        p.currentEstimatedValue,
      );
      if (value > 0) out.push({ name: p.name, value });
    }
    for (const v of vehicles) {
      if (v.id == null) continue;
      if (v.excludedFromNetWorth) continue;
      const value = latestAssetValue(
        assetValueSnapshots,
        'VEHICLE',
        v.id,
        today,
        v.currentEstimatedValue,
      );
      if (value > 0) out.push({ name: v.name, value });
    }
    return out;
  }, [accounts, snapshots, properties, vehicles, assetValueSnapshots]);

  // When there's nothing to chart, render a calm empty-state card instead
  // of mounting DonutChartCard with an empty array (which would render a
  // bare legend underneath an empty chart).
  if (slices.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Assets</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          No assets recorded yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <DonutChartCard
      title="Assets"
      data={slices.length === 0 ? EMPTY_SLICES : slices}
      valueFormatter={formatCurrency}
    />
  );
}
