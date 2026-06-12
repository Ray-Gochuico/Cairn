import { describe, it, expect } from 'vitest';
import {
  RANGE_TABS,
  granularityForWindow,
  clampDisplayDate,
  formatBucketDate,
  buildAssetValueView,
  deltaPctOrNull,
  xTicksFor,
  xTickLabel,
} from '@/lib/asset-value-chart';
import type { NetWorthChartRow } from '@/lib/net-worth-chart-data';

const TODAY = '2026-06-12';

function row(bucketEnd: string, netWorth: number): NetWorthChartRow {
  return { bucketEnd, netWorth };
}

describe('RANGE_TABS', () => {
  it('is the spec tab set in order', () => {
    expect(RANGE_TABS.map((t) => t.value)).toEqual(['3M', '6M', 'YTD', '1Y', '5Y', 'ALL']);
  });
});

describe('granularityForWindow', () => {
  it('short windows are weekly, 5Y monthly', () => {
    expect(granularityForWindow('3M', null, TODAY)).toBe('WEEK');
    expect(granularityForWindow('6M', null, TODAY)).toBe('WEEK');
    expect(granularityForWindow('YTD', null, TODAY)).toBe('WEEK');
    expect(granularityForWindow('1Y', null, TODAY)).toBe('WEEK');
    expect(granularityForWindow('5Y', null, TODAY)).toBe('MONTH');
  });
  it('ALL adapts to the data span (MONTH ≤88mo, QUARTER ≤264mo, else YEAR)', () => {
    expect(granularityForWindow('ALL', '2020-01-15', TODAY)).toBe('MONTH');   // 77 mo
    expect(granularityForWindow('ALL', '2010-01-15', TODAY)).toBe('QUARTER'); // 197 mo
    expect(granularityForWindow('ALL', '1995-01-15', TODAY)).toBe('YEAR');    // 377 mo
    expect(granularityForWindow('ALL', null, TODAY)).toBe('MONTH');
  });
  it('ALL: MONTH/QUARTER edge at exactly 88 vs 89 months', () => {
    // monthsBetween ignores day-of-month: (2026−2019)*12 + (Jun − Feb) = 84 + 4 = 88
    expect(granularityForWindow('ALL', '2019-02-15', TODAY)).toBe('MONTH');   // 88 mo — last MONTH
    expect(granularityForWindow('ALL', '2019-01-15', TODAY)).toBe('QUARTER'); // 89 mo — first QUARTER
  });
  it('ALL: QUARTER/YEAR edge at exactly 264 vs 265 months', () => {
    // (2026−2004)*12 + (Jun − Jun) = 264; one month earlier = 265
    expect(granularityForWindow('ALL', '2004-06-15', TODAY)).toBe('QUARTER'); // 264 mo — last QUARTER
    expect(granularityForWindow('ALL', '2004-05-15', TODAY)).toBe('YEAR');    // 265 mo — first YEAR
  });
});

describe('clampDisplayDate / formatBucketDate', () => {
  it('clamps future bucket ends to today', () => {
    expect(clampDisplayDate('2026-06-30', TODAY)).toBe(TODAY);
    expect(clampDisplayDate('2026-05-31', TODAY)).toBe('2026-05-31');
  });
  it('formats as "Mmm D, YYYY" in UTC', () => {
    expect(formatBucketDate('2026-03-31', TODAY)).toBe('Mar 31, 2026');
    expect(formatBucketDate('2026-06-30', TODAY)).toBe('Jun 12, 2026'); // clamped
  });
});

describe('deltaPctOrNull', () => {
  it('null for baseline ≤ 0', () => {
    expect(deltaPctOrNull(100, 0)).toBeNull();
    expect(deltaPctOrNull(100, -5)).toBeNull();
  });
  it('null beyond ±999.9% (near-zero baseline)', () => {
    expect(deltaPctOrNull(120, 12)).toBeNull();          // 1000% > 999.9 → null
    expect(deltaPctOrNull(119, 12)).toBeCloseTo(991.7, 1);
  });
  it('plain percentage otherwise', () => {
    expect(deltaPctOrNull(8600, 100000)).toBeCloseTo(8.6, 5);
  });
});

describe('buildAssetValueView', () => {
  const rows = [
    row('2025-06-30', 100000),
    row('2025-12-31', 120000),
    row('2026-06-30', 138600),
  ];
  it('derives latest, baseline, delta, pct', () => {
    const v = buildAssetValueView(rows, '1Y', 'MONTH', TODAY);
    expect(v.latest?.value).toBe(138600);
    expect(v.baseline?.value).toBe(100000);
    expect(v.delta).toBe(38600);
    expect(v.deltaPct).toBeCloseTo(38.6, 5);
    expect(v.phrase).toBe('past year');
  });
  it('uses "since <Mmm YYYY>" when data starts inside the window', () => {
    const shortRows = [row('2026-03-31', 100), row('2026-06-30', 200)];
    const v = buildAssetValueView(shortRows, '1Y', 'MONTH', TODAY);
    expect(v.phrase).toBe('since Mar 2026');
  });
  it('WEEK boundary: one bucket late triggers the since-phrase', () => {
    // 1Y cutoff from 2026-06-12 = 2025-06-12 → firstExpected = bucketEndFor(WEEK) = '2025-06-14' (Sat).
    // First row one week-bucket later → data starts inside the window.
    const late = [row('2025-06-21', 100), row('2026-06-13', 200)];
    const v = buildAssetValueView(late, '1Y', 'WEEK', TODAY);
    expect(v.phrase).toBe('since Jun 2025');
  });
  it('WEEK boundary: first bucket exactly at firstExpected keeps the window phrase', () => {
    const exact = [row('2025-06-14', 100), row('2026-06-13', 200)];
    const v = buildAssetValueView(exact, '1Y', 'WEEK', TODAY);
    expect(v.phrase).toBe('past year');
  });
  it('YTD full coverage: phrase is "this year"', () => {
    // YTD cutoff = 2026-01-01 → firstExpected = bucketEndFor(WEEK) = '2026-01-03' (Sat).
    const full = [row('2026-01-03', 100), row('2026-06-13', 200)];
    const v = buildAssetValueView(full, 'YTD', 'WEEK', TODAY);
    expect(v.phrase).toBe('this year');
  });
  it('YTD late start: phrase is "since <Mmm YYYY>"', () => {
    const late = [row('2026-03-07', 100), row('2026-06-13', 200)];
    const v = buildAssetValueView(late, 'YTD', 'WEEK', TODAY);
    expect(v.phrase).toBe('since Mar 2026');
  });
  it('ALL is always "all time"', () => {
    const v = buildAssetValueView(rows, 'ALL', 'MONTH', TODAY);
    expect(v.phrase).toBe('all time');
  });
  it('single point: no delta', () => {
    const v = buildAssetValueView([row('2026-06-30', 5)], '1Y', 'MONTH', TODAY);
    expect(v.delta).toBeNull();
    expect(v.deltaPct).toBeNull();
  });
  it('empty rows: empty view', () => {
    const v = buildAssetValueView([], '1Y', 'MONTH', TODAY);
    expect(v.points).toEqual([]);
    expect(v.latest).toBeNull();
  });
});

describe('x ticks', () => {
  it('≤1Y windows: first bucket of each month, labeled MMM', () => {
    const rows = [
      row('2026-04-04', 1), row('2026-04-11', 1), row('2026-05-02', 1),
      row('2026-05-09', 1), row('2026-06-06', 1),
    ];
    expect(xTicksFor(rows, '3M')).toEqual(['2026-04-04', '2026-05-02', '2026-06-06']);
    expect(xTickLabel('2026-04-04', '3M')).toBe('Apr');
  });
  it('5Y/ALL: first bucket of each year, labeled YYYY', () => {
    const rows = [
      row('2025-11-30', 1), row('2025-12-31', 1), row('2026-01-31', 1), row('2026-02-28', 1),
    ];
    expect(xTicksFor(rows, '5Y')).toEqual(['2025-11-30', '2026-01-31']);
    expect(xTickLabel('2026-01-31', '5Y')).toBe('2026');
  });
});
