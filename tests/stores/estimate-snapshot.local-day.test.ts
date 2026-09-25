import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import { PropertyType } from '@/types/enums';

/**
 * v1.7.0 R4 smoke regression: an estimate edit records the new value as
 * today's asset-value snapshot, and "today" was the UTC day — tomorrow in the
 * evening west of UTC, so the row sat past every local-day as-of read. It is
 * now the LOCAL day. (The two store suites read the real clock under the
 * frozen test-clock allowlist; these clock-pinned arms live here.)
 */
const baseProperty = {
  householdId: 1, ownerPersonId: null, name: 'Home', type: PropertyType.PRIMARY_RESIDENCE,
  address: null, purchaseDate: null, purchasePrice: null, currentEstimatedValue: 400_000,
  linkedLoanId: null, excludedFromNetWorth: false,
};
const baseVehicle = {
  householdId: 1, ownerPersonId: null, name: 'Car', year: 2022, make: null, model: null,
  purchaseDate: null, purchasePrice: null, currentEstimatedValue: 20_000,
  linkedLoanId: null, excludedFromNetWorth: false,
};

async function snapshotDates(db: SqliteAdapter, ownerType: 'PROPERTY' | 'VEHICLE'): Promise<string[]> {
  const rows = await db.select<{ snapshot_date: string }>(
    'SELECT snapshot_date FROM asset_value_snapshots WHERE owner_type = ? ORDER BY id',
    [ownerType],
  );
  return rows.map((r) => r.snapshot_date);
}

const ARMS = [
  { zone: 'America/New_York', instant: '2026-09-25T03:33:00Z', local: '2026-09-24', label: '23:33 EDT (03:33 UTC the next day)' },
  { zone: 'Pacific/Auckland', instant: '2026-09-24T21:00:00Z', local: '2026-09-25', label: '09:00 NZST (21:00 UTC the previous day)' },
] as const;

describe('an estimate edit is dated the LOCAL day', () => {
  const ORIGINAL_TZ = process.env.TZ;
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    usePropertiesStore.setState({ properties: [], isLoading: false, error: null });
    useVehiclesStore.setState({ vehicles: [], isLoading: false, error: null });
    useAssetValueSnapshotsStore.setState({ assetValueSnapshots: [], isLoading: false, error: null });
    vi.useFakeTimers({ toFake: ['Date'] });
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
    await db.close();
  });

  it.each(ARMS)('property — $zone, $label: $local', async ({ zone, instant, local }) => {
    process.env.TZ = zone;
    vi.setSystemTime(new Date(instant));
    const id = await usePropertiesStore.getState().create(baseProperty);
    await usePropertiesStore.getState().update(id, { currentEstimatedValue: 425_000 });
    expect(await snapshotDates(db, 'PROPERTY')).toEqual([local]);
  });

  it.each(ARMS)('vehicle — $zone, $label: $local', async ({ zone, instant, local }) => {
    process.env.TZ = zone;
    vi.setSystemTime(new Date(instant));
    const id = await useVehiclesStore.getState().create(baseVehicle);
    await useVehiclesStore.getState().update(id, { currentEstimatedValue: 18_500 });
    expect(await snapshotDates(db, 'VEHICLE')).toEqual([local]);
  });
});
