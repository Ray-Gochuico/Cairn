import { describe, it, expect } from 'vitest';
import {
  bucketSnapshots,
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

describe('cutoffForWindow — 6M and YTD', () => {
  it('6M cutoff is six months back (UTC)', () => {
    expect(cutoffForWindow('6M', new Date(Date.UTC(2026, 5, 12)))).toBe('2025-12-12');
  });
  it('YTD cutoff is Jan 1 of the current UTC year', () => {
    expect(cutoffForWindow('YTD', new Date(Date.UTC(2026, 5, 12)))).toBe('2026-01-01');
  });
  it('existing windows are unchanged', () => {
    expect(cutoffForWindow('3M', new Date(Date.UTC(2026, 5, 12)))).toBe('2026-03-12');
    expect(cutoffForWindow('ALL')).toBeNull();
  });
});
