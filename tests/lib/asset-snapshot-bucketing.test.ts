import { describe, it, expect } from 'vitest';
import { bucketAssetSnapshots } from '@/lib/asset-snapshot-bucketing';
import type { AssetValueSnapshot } from '@/types/schema';

describe('bucketAssetSnapshots', () => {
  it('returns the closest snapshot for each bucket (uses earlier snapshot when it is closer)', () => {
    const snapshots: AssetValueSnapshot[] = [
      { ownerType: 'PROPERTY', ownerId: 1, snapshotDate: '2026-01-15', value: 400000 },
      { ownerType: 'PROPERTY', ownerId: 1, snapshotDate: '2026-04-10', value: 410000 },
    ];
    // Feb 28: |Jan 15 − Feb 28| = 44 days, |Apr 10 − Feb 28| = 41 days → Apr 10 wins.
    // Apr 30: |Jan 15 − Apr 30| = 105, |Apr 10 − Apr 30| = 20 → Apr 10 wins.
    // Jun 30: |Jan 15 − Jun 30| = 166, |Apr 10 − Jun 30| = 81 → Apr 10 wins.
    const out = bucketAssetSnapshots(
      snapshots,
      'PROPERTY',
      1,
      ['2026-02-28', '2026-04-30', '2026-06-30'],
      'MONTH',
      405000,
    );
    expect(out).toEqual([410000, 410000, 410000]);
  });

  it('uses the only snapshot even for buckets before it (closest-date wins over fallback)', () => {
    const snapshots: AssetValueSnapshot[] = [
      { ownerType: 'VEHICLE', ownerId: 1, snapshotDate: '2026-04-10', value: 22000 },
    ];
    // Under closest-date, the lone snapshot anchors every bucket — Feb 28
    // still picks the Apr 10 snapshot instead of falling back to the
    // currentEstimatedValue. Fallback now only fires when NO snapshot
    // exists for this entity at all.
    const out = bucketAssetSnapshots(
      snapshots,
      'VEHICLE',
      1,
      ['2026-02-28', '2026-04-30'],
      'MONTH',
      25000,
    );
    expect(out).toEqual([22000, 22000]);
  });

  it('picks the asset snapshot closest to bucketEnd (can be AFTER bucketEnd)', () => {
    const snapshots: AssetValueSnapshot[] = [
      { ownerType: 'PROPERTY', ownerId: 1, snapshotDate: '2026-03-23', value: 400000 },
      { ownerType: 'PROPERTY', ownerId: 1, snapshotDate: '2026-04-01', value: 410000 },
    ];
    // March bucket end = March 31. April 1 is 1 day from March 31; March 23 is 8 days.
    const out = bucketAssetSnapshots(
      snapshots,
      'PROPERTY',
      1,
      ['2026-03-31'],
      'MONTH',
      405000,
    );
    expect(out).toEqual([410000]);
  });

  it('uses fallback only when no snapshot is available for the entity at all', () => {
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

  it('a sparse snapshot fills multiple bucket ends', () => {
    const snapshots: AssetValueSnapshot[] = [
      { ownerType: 'PROPERTY', ownerId: 1, snapshotDate: '2026-04-10', value: 410000 },
    ];
    const out = bucketAssetSnapshots(
      snapshots,
      'PROPERTY',
      1,
      ['2026-02-28', '2026-03-31', '2026-05-31'],
      'MONTH',
      400000,
    );
    expect(out).toEqual([410000, 410000, 410000]);
  });

  it('equidistant snapshots: later wins', () => {
    const snapshots: AssetValueSnapshot[] = [
      { ownerType: 'VEHICLE', ownerId: 1, snapshotDate: '2026-01-16', value: 22000 },
      { ownerType: 'VEHICLE', ownerId: 1, snapshotDate: '2026-02-15', value: 21000 },
    ];
    // Jan 31 is equidistant: 15 days to each. Later (Feb 15) wins.
    const out = bucketAssetSnapshots(
      snapshots,
      'VEHICLE',
      1,
      ['2026-01-31'],
      'MONTH',
      25000,
    );
    expect(out).toEqual([21000]);
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
    // Feb 28: |Jan 15 − Feb 28| = 44, |Apr 10 − Feb 28| = 41 → Apr 10 wins.
    // Apr 30: closer to Apr 10. Both buckets pick 410000.
    const out = bucketAssetSnapshots(
      snapshots,
      'PROPERTY',
      1,
      ['2026-02-28', '2026-04-30'],
      'MONTH',
      0,
    );
    expect(out).toEqual([410000, 410000]);
  });

  it('handles unsorted input correctly under closest-date semantics', () => {
    const snapshots: AssetValueSnapshot[] = [
      { ownerType: 'PROPERTY', ownerId: 1, snapshotDate: '2026-04-10', value: 410000 },
      { ownerType: 'PROPERTY', ownerId: 1, snapshotDate: '2026-01-15', value: 400000 },
      { ownerType: 'PROPERTY', ownerId: 1, snapshotDate: '2026-03-15', value: 405000 },
    ];
    // Feb 28: |Jan 15 − Feb 28| = 44, |Mar 15 − Feb 28| = 15, |Apr 10 − Feb 28| = 41 → Mar 15 wins.
    // Apr 30: |Jan 15 − Apr 30| = 105, |Mar 15 − Apr 30| = 46, |Apr 10 − Apr 30| = 20 → Apr 10 wins.
    const out = bucketAssetSnapshots(
      snapshots,
      'PROPERTY',
      1,
      ['2026-02-28', '2026-04-30'],
      'MONTH',
      0,
    );
    expect(out).toEqual([405000, 410000]);
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
