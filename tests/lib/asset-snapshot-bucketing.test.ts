import { describe, it, expect } from 'vitest';
import { assetValuesAsOf } from '@/lib/asset-snapshot-bucketing';
import type { AssetValueSnapshot } from '@/types/schema';

const NO_ANCHOR = { purchaseDate: null, purchasePrice: null, currentEstimatedValue: null };

function snap(id: number, ownerId: number, date: string, value: number): AssetValueSnapshot {
  return {
    id,
    ownerType: 'PROPERTY' as const,
    ownerId,
    snapshotDate: date,
    value,
  };
}

describe('assetValuesAsOf', () => {
  const ends = ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'];

  it('carries the latest snapshot ≤ bucketEnd forward (no look-ahead)', () => {
    const snaps = [snap(1, 7, '2026-02-10', 410000), snap(2, 7, '2026-04-05', 425000)];
    expect(assetValuesAsOf(snaps, 'PROPERTY', 7, ends, NO_ANCHOR)).toEqual([
      0, 410000, 410000, 425000,
    ]);
  });

  it('is 0 before the first snapshot when there is no purchase anchor', () => {
    const snaps = [snap(1, 7, '2026-03-10', 410000)];
    expect(assetValuesAsOf(snaps, 'PROPERTY', 7, ends, NO_ANCHOR)).toEqual([
      0, 0, 410000, 410000,
    ]);
  });

  it('anchors 0 → purchasePrice → first snapshot when purchase info is known', () => {
    const snaps = [snap(1, 7, '2026-04-05', 425000)];
    const anchor = { purchaseDate: '2026-02-15', purchasePrice: 400000, currentEstimatedValue: 999999 };
    expect(assetValuesAsOf(snaps, 'PROPERTY', 7, ends, anchor)).toEqual([
      0, 400000, 400000, 425000,
    ]);
  });

  it('no snapshots at all: flat currentEstimatedValue, zeroed before purchaseDate', () => {
    const anchor = { purchaseDate: '2026-02-15', purchasePrice: null, currentEstimatedValue: 430000 };
    expect(assetValuesAsOf([], 'PROPERTY', 7, ends, anchor)).toEqual([
      0, 430000, 430000, 430000,
    ]);
  });

  it('no snapshots, no anchor info: zeros', () => {
    expect(assetValuesAsOf([], 'PROPERTY', 7, ends, NO_ANCHOR)).toEqual([0, 0, 0, 0]);
  });

  it('ignores snapshots belonging to other owners', () => {
    const snaps = [snap(1, 8, '2026-01-15', 111), snap(2, 7, '2026-01-15', 222)];
    expect(assetValuesAsOf(snaps, 'PROPERTY', 7, ends, NO_ANCHOR)).toEqual([
      222, 222, 222, 222,
    ]);
  });

  it('same-date duplicates: the higher id (later insert) wins', () => {
    // Input in the store's id-DESC order — a date-only stable sort would
    // leave id 1 consumed last and wrongly pick 400000.
    const snaps = [snap(2, 7, '2026-02-10', 415000), snap(1, 7, '2026-02-10', 400000)];
    expect(assetValuesAsOf(snaps, 'PROPERTY', 7, ends, NO_ANCHOR)).toEqual([
      0, 415000, 415000, 415000,
    ]);
  });

  it('boundary equality: snapshot ON a bucketEnd counts (<=), purchaseDate === bucketEnd anchors (>=)', () => {
    const snaps = [snap(1, 7, '2026-03-31', 410000)];
    const anchor = { purchaseDate: '2026-01-31', purchasePrice: 400000, currentEstimatedValue: null };
    // Jan 31: purchaseDate equals the bucketEnd → purchasePrice applies.
    // Mar 31: snapshot dated exactly on the bucketEnd → it counts.
    expect(assetValuesAsOf(snaps, 'PROPERTY', 7, ends, anchor)).toEqual([
      400000, 400000, 410000, 410000,
    ]);
  });

  it('purchase known but price unknown: dips to 0 until the first snapshot (estimate must not leak)', () => {
    const snaps = [snap(1, 7, '2026-04-05', 425000)];
    const anchor = { purchaseDate: '2026-02-15', purchasePrice: null, currentEstimatedValue: 999999 };
    // Snapshots exist, so currentEstimatedValue never applies; with no
    // purchasePrice the span between purchase and first snapshot is 0 —
    // the spec-deliberate dip.
    expect(assetValuesAsOf(snaps, 'PROPERTY', 7, ends, anchor)).toEqual([
      0, 0, 0, 425000,
    ]);
  });

  it('returns an empty array when no buckets are provided', () => {
    expect(
      assetValuesAsOf([snap(1, 7, '2026-02-10', 410000)], 'PROPERTY', 7, [], NO_ANCHOR),
    ).toEqual([]);
  });

  it('handles a single-element bucketEnds (Task 8 calls with one iso date)', () => {
    const snaps = [snap(1, 7, '2026-02-10', 410000)];
    expect(assetValuesAsOf(snaps, 'PROPERTY', 7, ['2026-03-31'], NO_ANCHOR)).toEqual([410000]);
  });
});
