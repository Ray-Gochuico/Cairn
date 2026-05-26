import { describe, it, expect } from 'vitest';
import {
  bucketSnapshots,
  bucketSnapshotsByClosestDate,
  cutoffForWindow,
  type Granularity,
} from '@/lib/snapshot-bucketing';

const SNAPS = [
  { accountId: 1, snapshotDate: '2024-01-15', totalValue: 100 },
  { accountId: 1, snapshotDate: '2024-02-15', totalValue: 110 },
  { accountId: 1, snapshotDate: '2024-02-28', totalValue: 115 },
  { accountId: 2, snapshotDate: '2024-01-15', totalValue: 200 },
  { accountId: 2, snapshotDate: '2024-02-15', totalValue: 220 },
];

describe('bucketSnapshots', () => {
  it('buckets by month using end-of-month date as bucket key', () => {
    const result = bucketSnapshots(SNAPS, 'MONTH', 90);
    expect(result.bucketEnds).toEqual(['2024-01-31', '2024-02-29']);
    expect(result.valuesByAccount.get(1)).toEqual([100, 115]); // latest in each month
    expect(result.valuesByAccount.get(2)).toEqual([200, 220]);
  });

  it('takes the LATEST snapshot per account per bucket (not the sum)', () => {
    const result = bucketSnapshots(SNAPS, 'MONTH', 90);
    expect(result.valuesByAccount.get(1)![1]).toBe(115);
  });

  it('carries forward last-known value when an account is missing in a bucket', () => {
    const sparse = [
      { accountId: 1, snapshotDate: '2024-01-15', totalValue: 100 },
      { accountId: 2, snapshotDate: '2024-01-15', totalValue: 200 },
      { accountId: 2, snapshotDate: '2024-02-15', totalValue: 220 },
    ];
    const result = bucketSnapshots(sparse, 'MONTH', 90);
    expect(result.valuesByAccount.get(1)).toEqual([100, 100]); // carry forward
  });

  it('caps output at the most recent N buckets', () => {
    // Use UTC math so the fixture is timezone-independent.
    const many = Array.from({ length: 150 }, (_, i) => {
      const d = new Date(Date.UTC(2020, 0, 1));
      d.setUTCDate(d.getUTCDate() + i);
      return { accountId: 1, snapshotDate: d.toISOString().slice(0, 10), totalValue: i };
    });
    const result = bucketSnapshots(many, 'DAY', 90);
    expect(result.bucketEnds.length).toBe(90);
    // 2020-01-01 + 149 days = 2020-05-29 (Jan 31 + Feb 29 + Mar 31 + Apr 30 + May 29 = 150 days from Jan 1 inclusive).
    expect(result.bucketEnds[89]).toBe('2020-05-29');
  });

  it.each<Granularity>(['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR'])(
    'handles %s granularity without throwing on empty input',
    (g) => {
      const result = bucketSnapshots([], g, 90);
      expect(result.bucketEnds).toEqual([]);
      expect(result.valuesByAccount.size).toBe(0);
    },
  );

  it('handles WEEK granularity with ISO-week-end (Saturday) bucket key', () => {
    const result = bucketSnapshots(
      [
        { accountId: 1, snapshotDate: '2024-01-08', totalValue: 100 },
        { accountId: 1, snapshotDate: '2024-01-15', totalValue: 110 },
      ],
      'WEEK',
      90,
    );
    expect(result.bucketEnds).toEqual(['2024-01-13', '2024-01-20']);
  });

  it('handles QUARTER granularity with end-of-quarter date', () => {
    const result = bucketSnapshots(
      [
        { accountId: 1, snapshotDate: '2024-02-15', totalValue: 100 },
        { accountId: 1, snapshotDate: '2024-05-15', totalValue: 110 },
      ],
      'QUARTER',
      90,
    );
    expect(result.bucketEnds).toEqual(['2024-03-31', '2024-06-30']);
  });

  it('handles YEAR granularity with end-of-year date', () => {
    const result = bucketSnapshots(
      [
        { accountId: 1, snapshotDate: '2023-02-15', totalValue: 100 },
        { accountId: 1, snapshotDate: '2024-05-15', totalValue: 110 },
      ],
      'YEAR',
      90,
    );
    expect(result.bucketEnds).toEqual(['2023-12-31', '2024-12-31']);
  });
});

describe('bucketSnapshotsByClosestDate', () => {
  it('picks the snapshot whose date is closest to each bucket end', () => {
    // March 23 entry and April 1 entry. Bucket end for March = March 31.
    // April 1 is 1 day from March 31; March 23 is 8 days from March 31.
    // So the April 1 snapshot wins the March bucket.
    const snapshots = [
      { accountId: 1, snapshotDate: '2026-03-23', totalValue: 100 },
      { accountId: 1, snapshotDate: '2026-04-01', totalValue: 200 },
    ];
    const out = bucketSnapshotsByClosestDate(snapshots, 'MONTH', 12);
    const marchIdx = out.bucketEnds.findIndex((b) => b.startsWith('2026-03'));
    expect(marchIdx).toBeGreaterThanOrEqual(0);
    expect(out.valuesByAccount.get(1)?.[marchIdx]).toBe(200);
  });

  it('a single sparse snapshot anchors multiple adjacent buckets', () => {
    const snapshots = [
      { accountId: 1, snapshotDate: '2026-04-15', totalValue: 500 },
    ];
    const out = bucketSnapshotsByClosestDate(snapshots, 'MONTH', 6);
    // Every bucket end picks the lone snapshot.
    for (const [, series] of out.valuesByAccount) {
      expect(series.every((v) => v === 500)).toBe(true);
    }
  });

  it('equidistant snapshots break the tie by picking the LATER one', () => {
    // Jan 16 and Feb 15 are both 15 days from Jan 31. Later (Feb 15) wins.
    const snapshots = [
      { accountId: 1, snapshotDate: '2026-01-16', totalValue: 100 },
      { accountId: 1, snapshotDate: '2026-02-15', totalValue: 200 },
    ];
    const out = bucketSnapshotsByClosestDate(snapshots, 'MONTH', 12);
    const janIdx = out.bucketEnds.findIndex((b) => b.startsWith('2026-01'));
    expect(out.valuesByAccount.get(1)?.[janIdx]).toBe(200);
  });

  it('handles multiple accounts in parallel', () => {
    const snapshots = [
      { accountId: 1, snapshotDate: '2026-03-15', totalValue: 100 },
      { accountId: 2, snapshotDate: '2026-03-28', totalValue: 200 },
    ];
    const out = bucketSnapshotsByClosestDate(snapshots, 'MONTH', 6);
    expect(out.valuesByAccount.size).toBe(2);
    const marchIdx = out.bucketEnds.findIndex((b) => b.startsWith('2026-03'));
    expect(out.valuesByAccount.get(1)?.[marchIdx]).toBe(100);
    expect(out.valuesByAccount.get(2)?.[marchIdx]).toBe(200);
  });

  it('returns 0 for an account with no snapshots at all (empty input)', () => {
    const out = bucketSnapshotsByClosestDate([], 'MONTH', 6);
    expect(out.bucketEnds.length).toBe(0);
    expect(out.valuesByAccount.size).toBe(0);
  });

  it('respects WEEK granularity (bucket end = Saturday)', () => {
    // Snapshot on Wednesday (2026-04-08). Closest Saturday is 2026-04-11.
    const snapshots = [
      { accountId: 1, snapshotDate: '2026-04-08', totalValue: 999 },
    ];
    const out = bucketSnapshotsByClosestDate(snapshots, 'WEEK', 4);
    const idx = out.bucketEnds.findIndex((b) => b === '2026-04-11');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(out.valuesByAccount.get(1)?.[idx]).toBe(999);
  });
});

describe('cutoffForWindow', () => {
  const today = new Date(Date.UTC(2024, 4, 15)); // 2024-05-15 UTC

  it('computes 3M cutoff as today minus 3 months', () => {
    expect(cutoffForWindow('3M', today)).toBe('2024-02-15');
  });

  it('computes 1Y cutoff as today minus 12 months', () => {
    expect(cutoffForWindow('1Y', today)).toBe('2023-05-15');
  });

  it('computes 5Y cutoff as today minus 60 months', () => {
    expect(cutoffForWindow('5Y', today)).toBe('2019-05-15');
  });

  it('returns null for ALL (no cutoff)', () => {
    expect(cutoffForWindow('ALL', today)).toBeNull();
  });
});
