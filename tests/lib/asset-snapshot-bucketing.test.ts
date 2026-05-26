import { describe, it, expect } from 'vitest';
import { bucketAssetSnapshots } from '@/lib/asset-snapshot-bucketing';
import type { AssetValueSnapshot } from '@/types/schema';

describe('bucketAssetSnapshots', () => {
  it('returns the latest snapshot <= bucketEnd for each bucket', () => {
    const snapshots: AssetValueSnapshot[] = [
      { ownerType: 'PROPERTY', ownerId: 1, snapshotDate: '2026-01-15', value: 400000 },
      { ownerType: 'PROPERTY', ownerId: 1, snapshotDate: '2026-04-10', value: 410000 },
    ];
    const out = bucketAssetSnapshots(
      snapshots,
      'PROPERTY',
      1,
      ['2026-02-28', '2026-04-30', '2026-06-30'],
      'MONTH',
      405000,
    );
    expect(out).toEqual([400000, 410000, 410000]);
  });

  it('uses fallback for buckets before the earliest snapshot', () => {
    const snapshots: AssetValueSnapshot[] = [
      { ownerType: 'VEHICLE', ownerId: 1, snapshotDate: '2026-04-10', value: 22000 },
    ];
    const out = bucketAssetSnapshots(
      snapshots,
      'VEHICLE',
      1,
      ['2026-02-28', '2026-04-30'],
      'MONTH',
      25000,
    );
    expect(out).toEqual([25000, 22000]);
  });

  it('returns fallback for every bucket when no snapshots exist', () => {
    const out = bucketAssetSnapshots(
      [],
      'VEHICLE',
      1,
      ['2026-02-28', '2026-04-30'],
      'MONTH',
      25000,
    );
    expect(out).toEqual([25000, 25000]);
  });

  it('returns 0 when both snapshots and fallback are absent', () => {
    const out = bucketAssetSnapshots(
      [],
      'VEHICLE',
      1,
      ['2026-02-28'],
      'MONTH',
      null,
    );
    expect(out).toEqual([0]);
  });

  it('filters out snapshots from other owners', () => {
    const snapshots: AssetValueSnapshot[] = [
      { ownerType: 'PROPERTY', ownerId: 1, snapshotDate: '2026-01-15', value: 400000 },
      // Different owner — should be ignored.
      { ownerType: 'PROPERTY', ownerId: 2, snapshotDate: '2026-03-15', value: 999999 },
      // Same owner_id but different owner_type — also ignored.
      { ownerType: 'VEHICLE', ownerId: 1, snapshotDate: '2026-04-15', value: 999999 },
      { ownerType: 'PROPERTY', ownerId: 1, snapshotDate: '2026-04-10', value: 410000 },
    ];
    const out = bucketAssetSnapshots(
      snapshots,
      'PROPERTY',
      1,
      ['2026-02-28', '2026-04-30'],
      'MONTH',
      0,
    );
    expect(out).toEqual([400000, 410000]);
  });

  it('handles unsorted input by sorting internally', () => {
    const snapshots: AssetValueSnapshot[] = [
      { ownerType: 'PROPERTY', ownerId: 1, snapshotDate: '2026-04-10', value: 410000 },
      { ownerType: 'PROPERTY', ownerId: 1, snapshotDate: '2026-01-15', value: 400000 },
      { ownerType: 'PROPERTY', ownerId: 1, snapshotDate: '2026-03-15', value: 405000 },
    ];
    const out = bucketAssetSnapshots(
      snapshots,
      'PROPERTY',
      1,
      ['2026-02-28', '2026-04-30'],
      'MONTH',
      0,
    );
    expect(out).toEqual([400000, 410000]);
  });

  it('returns an empty array when no buckets are provided', () => {
    const out = bucketAssetSnapshots(
      [{ ownerType: 'PROPERTY', ownerId: 1, snapshotDate: '2026-01-15', value: 400000 }],
      'PROPERTY',
      1,
      [],
      'MONTH',
      100,
    );
    expect(out).toEqual([]);
  });
});
