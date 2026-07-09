import { useEffect, useMemo } from 'react';
import DonutChartCard, { type DonutSlice } from './DonutChartCard';
import { DonutEntityPicker, useDonutSelected, type DonutEntityPickerItem } from './DonutEntityPicker';
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
import { useViewFilter } from '@/lib/use-view-filter';
import { entityKey } from '@/lib/entity-key';
import { colorForAccount, colorForEntityKey } from '@/lib/chart-colors';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const STORAGE_KEY = 'donut.assets.hidden';

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
 *
 * Picker: a header popover lets the user hide individual entities; the
 * hidden set persists in localStorage under `donut.assets.hidden`. Keys
 * use `entityKey(kind, id)` so account/property/vehicle ids never collide.
 */
export default function AssetsDonut() {
  // W10 T7: this donut is household-wide BY DESIGN. Flag that with the same
  // "· Household" suffix AssetValueChart uses when a person view is active.
  const { filter } = useViewFilter();
  const title = filter !== 'household' ? 'Assets · Household' : 'Assets';
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

  // Build the donut slices AND the parallel picker items in one pass so the
  // slice name and the picker key stay perfectly aligned. The picker key
  // uses `entityKey(kind, id)` because account/property/vehicle ids can
  // collide (`account:1` vs `property:1`); the slice name keeps the
  // user-facing label.
  const { slices, pickerItems } = useMemo<{
    slices: DonutSlice[];
    pickerItems: DonutEntityPickerItem[];
  }>(() => {
    const today = new Date().toISOString().slice(0, 10);
    const sl: DonutSlice[] = [];
    const pi: DonutEntityPickerItem[] = [];

    // Attach a deterministic, ENTITY-keyed color to BOTH the slice and the
    // picker item from one source. Keying on the entity (account id /
    // entityKey) rather than the running insertion index means a kept wedge's
    // color never shifts when another entity is hidden and the list reindexes
    // — so wedge == legend == picker swatch by construction (the I9 desync
    // fix). Accounts also honor the user's per-account accent override here,
    // which the old positional path silently dropped on the donut. The slice
    // carries `entityKey` so the picker filter can hide entities that share a
    // display label independently.
    function push(name: string, value: number, key: string, color: string) {
      sl.push({ name, value, color, entityKey: key });
      pi.push({ key, label: name, color });
    }

    for (const acc of accounts) {
      if (acc.id == null) continue;
      if (acc.excludedFromNetWorth) continue;
      const value = latestSnapshotForAccount(acc.id, snapshots, today);
      if (value > 0) {
        push(
          acc.name,
          value,
          entityKey('account', acc.id),
          colorForAccount(acc.id, acc.accentColor),
        );
      }
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
      if (value > 0) {
        const key = entityKey('property', p.id);
        push(p.name, value, key, colorForEntityKey(key));
      }
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
      if (value > 0) {
        const key = entityKey('vehicle', v.id);
        push(v.name, value, key, colorForEntityKey(key));
      }
    }
    return { slices: sl, pickerItems: pi };
  }, [accounts, snapshots, properties, vehicles, assetValueSnapshots]);

  const allKeys = useMemo(() => pickerItems.map((i) => i.key), [pickerItems]);
  const selected = useDonutSelected(STORAGE_KEY, allKeys);

  const filteredSlices = useMemo(
    () =>
      slices.filter((s) => s.entityKey !== undefined && selected.has(s.entityKey)),
    [slices, selected],
  );

  // Full-universe denominator (hidden entities included) so hiding one
  // never re-normalizes the shares that remain.
  const fullTotal = useMemo(() => slices.reduce((s, x) => s + x.value, 0), [slices]);

  // When there's nothing to chart at all (no entities upstream), render a
  // calm empty-state card. Picker would have nothing to select so we skip
  // it.
  if (slices.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          No assets recorded yet.
        </CardContent>
      </Card>
    );
  }

  const picker = (
    <DonutEntityPicker localStorageKey={STORAGE_KEY} items={pickerItems} />
  );

  // All entities hidden — keep the picker visible so the user can re-show.
  if (filteredSlices.length === 0) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <CardTitle>{title}</CardTitle>
            {picker}
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground py-8 text-center">
            All entities hidden. Open the picker above to show at least one.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <DonutChartCard
      title={title}
      data={filteredSlices}
      shareTotal={fullTotal}
      valueFormatter={formatCurrency}
      headerRight={picker}
    />
  );
}
