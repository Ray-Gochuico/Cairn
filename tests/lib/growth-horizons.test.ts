import { describe, it, expect } from 'vitest';
import {
  GROWTH_HORIZONS,
  sumLatestOnOrBefore,
  computeHorizonGrowth,
} from '@/lib/growth-horizons';

describe('GROWTH_HORIZONS', () => {
  it('defines the five horizons in 1d → 1y order', () => {
    expect(GROWTH_HORIZONS.map((h) => h.key)).toEqual([
      '1d',
      '1w',
      '1m',
      '1q',
      '1y',
    ]);
  });

  it('computes baseline dates with UTC math from a fixed now', () => {
    // 2026-05-28 is a Thursday; pick UTC midnight so the date math is
    // unambiguous regardless of the machine's local timezone.
    const now = new Date('2026-05-28T00:00:00Z');
    const byKey = Object.fromEntries(
      GROWTH_HORIZONS.map((h) => [h.key, h.baselineDate(now)]),
    );
    expect(byKey['1d']).toBe('2026-05-27'); // now - 1 day
    expect(byKey['1w']).toBe('2026-05-21'); // now - 7 days
    expect(byKey['1m']).toBe('2026-04-28'); // now - 1 month
    expect(byKey['1q']).toBe('2026-02-28'); // now - 3 months
    expect(byKey['1y']).toBe('2025-05-28'); // now - 12 months
  });

  it('does not drift across a TZ boundary for the daily horizon', () => {
    // A late-evening UTC instant must still map to the calendar day, not
    // slip backward — guards against using local getDate()/setDate().
    const now = new Date('2026-05-28T23:30:00Z');
    const oneDay = GROWTH_HORIZONS.find((h) => h.key === '1d')!;
    expect(oneDay.baselineDate(now)).toBe('2026-05-27');
  });

  it('clamps month-end baselines to the last day of the target month (no forward normalization)', () => {
    const b = (key: string, now: Date) =>
      GROWTH_HORIZONS.find((h) => h.key === key)!.baselineDate(now);
    // Mar 31 − 1mo used to normalize Feb 31 → Mar 3 (a "past month" 3 days
    // into the CURRENT month). Clamp to the target month's last day.
    expect(b('1m', new Date('2026-03-31T00:00:00Z'))).toBe('2026-02-28');
    expect(b('1m', new Date('2024-03-31T00:00:00Z'))).toBe('2024-02-29'); // leap year
    expect(b('1m', new Date('2026-05-31T00:00:00Z'))).toBe('2026-04-30');
    expect(b('1q', new Date('2026-05-31T00:00:00Z'))).toBe('2026-02-28');
    expect(b('1y', new Date('2024-02-29T00:00:00Z'))).toBe('2023-02-28'); // leap day − 1y
  });

  it('mid-month and 31→31 baselines are unchanged by the clamp', () => {
    const b = (key: string, now: Date) =>
      GROWTH_HORIZONS.find((h) => h.key === key)!.baselineDate(now);
    expect(b('1m', new Date('2026-05-28T00:00:00Z'))).toBe('2026-04-28');
    expect(b('1q', new Date('2026-05-28T00:00:00Z'))).toBe('2026-02-28');
    expect(b('1m', new Date('2026-01-31T00:00:00Z'))).toBe('2025-12-31'); // Dec has 31 days — no clamp
  });

  it("the quarter horizon reads 'Past 3 months' (range-grammar parity with the chart's 3M tab)", () => {
    const q = GROWTH_HORIZONS.find((h) => h.key === '1q')!;
    expect(q.label).toBe('Past 3 months');
  });
});

describe('sumLatestOnOrBefore', () => {
  const snapshots = [
    { accountId: 1, snapshotDate: '2026-01-01', totalValue: 100 },
    { accountId: 1, snapshotDate: '2026-03-01', totalValue: 150 },
    { accountId: 1, snapshotDate: '2026-06-01', totalValue: 200 }, // after target dates below
    { accountId: 2, snapshotDate: '2026-02-01', totalValue: 50 },
    { accountId: 2, snapshotDate: '2026-04-01', totalValue: 70 },
  ];

  it('picks the latest snapshot on-or-before the date per account and sums', () => {
    // As of 2026-04-15: acct1 -> 150 (2026-03-01), acct2 -> 70 (2026-04-01)
    expect(sumLatestOnOrBefore(snapshots, '2026-04-15')).toBe(220);
  });

  it('includes a snapshot dated exactly on the boundary date', () => {
    // As of 2026-03-01: acct1 -> 150 (the boundary), acct2 -> 50 (2026-02-01)
    expect(sumLatestOnOrBefore(snapshots, '2026-03-01')).toBe(200);
  });

  it('ignores snapshots strictly after the date', () => {
    // As of 2026-05-01: 2026-06-01 (acct1) must NOT count.
    // acct1 -> 150, acct2 -> 70
    expect(sumLatestOnOrBefore(snapshots, '2026-05-01')).toBe(220);
  });

  it('returns null when NO snapshot is on-or-before the date', () => {
    expect(sumLatestOnOrBefore(snapshots, '2025-12-31')).toBeNull();
  });

  it('respects the accountIds filter', () => {
    // Restrict to acct1 only. As of 2026-04-15 -> 150.
    expect(sumLatestOnOrBefore(snapshots, '2026-04-15', new Set([1]))).toBe(150);
  });

  it('returns null when the filtered account has no history that far back', () => {
    // acct2's earliest snapshot is 2026-02-01; before that -> null.
    expect(sumLatestOnOrBefore(snapshots, '2026-01-15', new Set([2]))).toBeNull();
  });

  it('returns null when the filter excludes every snapshot', () => {
    expect(sumLatestOnOrBefore(snapshots, '2026-12-31', new Set([999]))).toBeNull();
  });

  it('considers all accounts when accountIds is undefined', () => {
    // Sanity: same as the first case but explicit about the default.
    expect(sumLatestOnOrBefore(snapshots, '2026-04-15', undefined)).toBe(220);
  });
});

describe('computeHorizonGrowth', () => {
  const now = new Date('2026-05-28T00:00:00Z');
  // Baseline dates for `now` (mirrors GROWTH_HORIZONS):
  //   today = 2026-05-28, 1d = 2026-05-27, 1w = 2026-05-21,
  //   1m = 2026-04-28, 1q = 2026-02-28, 1y = 2025-05-28
  const TODAY = '2026-05-28';

  it('produces one entry per horizon, in order', () => {
    const result = computeHorizonGrowth(() => null, now);
    expect(result.map((r) => r.key)).toEqual(['1d', '1w', '1m', '1q', '1y']);
  });

  it('marks available=false and nulls deltas when the baseline is missing', () => {
    // current present everywhere, baseline only for 1d.
    const valueAsOf = (iso: string): number | null => {
      if (iso === TODAY) return 1000;
      if (iso === '2026-05-27') return 900; // 1d baseline present
      return null; // every other horizon's baseline missing
    };
    const result = computeHorizonGrowth(valueAsOf, now);
    const oneDay = result.find((r) => r.key === '1d')!;
    const oneWeek = result.find((r) => r.key === '1w')!;

    expect(oneDay.available).toBe(true);
    expect(oneDay.current).toBe(1000);
    expect(oneDay.baseline).toBe(900);

    expect(oneWeek.available).toBe(false);
    expect(oneWeek.current).toBe(1000); // current still surfaced
    expect(oneWeek.baseline).toBeNull();
    expect(oneWeek.deltaAbs).toBeNull();
    expect(oneWeek.deltaPct).toBeNull();
  });

  it('marks available=false when current itself is null', () => {
    const result = computeHorizonGrowth(() => null, now);
    for (const r of result) {
      expect(r.available).toBe(false);
      expect(r.current).toBeNull();
      expect(r.deltaAbs).toBeNull();
      expect(r.deltaPct).toBeNull();
    }
  });

  it('computes deltaAbs and deltaPct as a fraction when available', () => {
    // current 1100, baseline 1000 -> +100, +10%
    const valueAsOf = (iso: string): number | null =>
      iso === TODAY ? 1100 : 1000;
    const oneWeek = computeHorizonGrowth(valueAsOf, now).find(
      (r) => r.key === '1w',
    )!;
    expect(oneWeek.available).toBe(true);
    expect(oneWeek.deltaAbs).toBe(100);
    expect(oneWeek.deltaPct).toBeCloseTo(0.1, 10);
  });

  it('handles negative growth', () => {
    const valueAsOf = (iso: string): number | null =>
      iso === TODAY ? 800 : 1000;
    const oneWeek = computeHorizonGrowth(valueAsOf, now).find(
      (r) => r.key === '1w',
    )!;
    expect(oneWeek.deltaAbs).toBe(-200);
    expect(oneWeek.deltaPct).toBeCloseTo(-0.2, 10);
  });

  it('nulls deltaPct (but not deltaAbs) when the baseline is exactly 0', () => {
    const valueAsOf = (iso: string): number | null => (iso === TODAY ? 500 : 0);
    const oneWeek = computeHorizonGrowth(valueAsOf, now).find(
      (r) => r.key === '1w',
    )!;
    expect(oneWeek.available).toBe(true); // 0 is a real, non-null baseline
    expect(oneWeek.baseline).toBe(0);
    expect(oneWeek.deltaAbs).toBe(500);
    expect(oneWeek.deltaPct).toBeNull(); // division by zero avoided
  });

  it('nulls deltaPct on a NEGATIVE baseline (sign-flip guard; deltaAbs still carries direction)', () => {
    // baseline −10,000 → current −5,000 is an IMPROVEMENT of +5,000, but the
    // signed ratio is −50% — a green arrow with a negative percent. Matches
    // the chart's deltaPctOrNull convention: pct requires baseline > 0.
    const valueAsOf = (iso: string): number | null =>
      iso === TODAY ? -5000 : -10000;
    const oneWeek = computeHorizonGrowth(valueAsOf, now).find(
      (r) => r.key === '1w',
    )!;
    expect(oneWeek.available).toBe(true);
    expect(oneWeek.deltaAbs).toBe(5000);
    expect(oneWeek.deltaPct).toBeNull();
  });

  it('positive baselines are unaffected by the sign-flip guard', () => {
    const valueAsOf = (iso: string): number | null =>
      iso === TODAY ? 1100 : 1000;
    const oneWeek = computeHorizonGrowth(valueAsOf, now).find(
      (r) => r.key === '1w',
    )!;
    expect(oneWeek.deltaPct).toBeCloseTo(0.1, 10);
  });

  it('nulls deltaPct above the ±999.9% display cap (near-zero baseline absurdity guard)', () => {
    // A $12 baseline growing to $15,000 is a ~124,900% "gain" — the chart's
    // deltaPctOrNull caps at |999.9%| and renders absolute-only; the card
    // must do the same rather than print an absurd percent. deltaAbs stays.
    const valueAsOf = (iso: string): number | null =>
      iso === TODAY ? 15_000 : 12;
    const oneWeek = computeHorizonGrowth(valueAsOf, now).find(
      (r) => r.key === '1w',
    )!;
    expect(oneWeek.available).toBe(true);
    expect(oneWeek.deltaAbs).toBe(14_988);
    expect(oneWeek.deltaPct).toBeNull();
  });

  it('keeps deltaPct at exactly the ±999.9% cap boundary', () => {
    // 100 → 1099.9 is +999.9% — the largest percent the chart still displays.
    const valueAsOf = (iso: string): number | null =>
      iso === TODAY ? 1099.9 : 100;
    const oneWeek = computeHorizonGrowth(valueAsOf, now).find(
      (r) => r.key === '1w',
    )!;
    expect(oneWeek.deltaPct).toBeCloseTo(9.999, 10);
  });

  it('queries each horizon at its own baseline date', () => {
    // Assign a distinct baseline value per date so we can prove the right
    // date was passed to valueAsOf for each horizon.
    const perDate: Record<string, number> = {
      '2026-05-28': 1000, // today (current)
      '2026-05-27': 990, // 1d
      '2026-05-21': 950, // 1w
      '2026-04-28': 800, // 1m
      '2026-02-28': 600, // 1q
      '2025-05-28': 400, // 1y
    };
    const valueAsOf = (iso: string): number | null => perDate[iso] ?? null;
    const result = computeHorizonGrowth(valueAsOf, now);
    const baselineByKey = Object.fromEntries(
      result.map((r) => [r.key, r.baseline]),
    );
    expect(baselineByKey['1d']).toBe(990);
    expect(baselineByKey['1w']).toBe(950);
    expect(baselineByKey['1m']).toBe(800);
    expect(baselineByKey['1q']).toBe(600);
    expect(baselineByKey['1y']).toBe(400);

    // And the labels/baselineDate strings are carried through.
    const oneWeek = result.find((r) => r.key === '1w')!;
    expect(oneWeek.label).toBe('Past week');
    expect(oneWeek.baselineDate).toBe('2026-05-21');
  });
});
