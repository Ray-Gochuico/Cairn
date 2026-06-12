import {
  bucketEndFor,
  cutoffForWindow,
  type Granularity,
  type TimeWindow,
} from '@/lib/snapshot-bucketing';
import type { NetWorthChartRow } from '@/lib/net-worth-chart-data';

/**
 * Pure derivation layer for the AssetValueChart (spec
 * docs/superpowers/specs/2026-06-12-asset-value-chart-design.md §3, §5).
 * Everything here is deterministic: the component injects `todayIso`.
 */

export interface RangeTab {
  value: TimeWindow;
  label: string;
  /** Delta phrase when the data covers the whole window. */
  phrase: string;
}

export const RANGE_TABS: readonly RangeTab[] = [
  { value: '3M', label: '3M', phrase: 'past 3 months' },
  { value: '6M', label: '6M', phrase: 'past 6 months' },
  { value: 'YTD', label: 'YTD', phrase: 'this year' },
  { value: '1Y', label: '1Y', phrase: 'past year' },
  { value: '5Y', label: '5Y', phrase: 'past 5 years' },
  { value: 'ALL', label: 'All', phrase: 'all time' },
];

function monthsBetween(aIso: string, bIso: string): number {
  const a = new Date(aIso + 'T00:00:00Z');
  const b = new Date(bIso + 'T00:00:00Z');
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
}

/**
 * Auto granularity per window (spec §5.2): weekly for ≤1Y so daily-snapshotted
 * accounts read smooth; monthly for 5Y; ALL adapts to the data span so the
 * contiguous spine stays within the builder's MAX_BUCKETS=90.
 */
export function granularityForWindow(
  w: TimeWindow,
  earliestIso: string | null,
  todayIso: string,
): Granularity {
  if (w === '3M' || w === '6M' || w === 'YTD' || w === '1Y') return 'WEEK';
  if (w === '5Y') return 'MONTH';
  if (!earliestIso) return 'MONTH';
  const span = monthsBetween(earliestIso, todayIso);
  if (span <= 88) return 'MONTH';
  if (span <= 264) return 'QUARTER';
  return 'YEAR';
}

/** Bucket ends can land in the future (week's Saturday / month end) — never display them. */
export function clampDisplayDate(bucketEnd: string, todayIso: string): string {
  return bucketEnd > todayIso ? todayIso : bucketEnd;
}

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});
const MONTH_YEAR_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const MONTH_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });

/** "Mar 31, 2026", display-clamped to today. */
export function formatBucketDate(bucketEnd: string, todayIso: string): string {
  return DATE_FMT.format(new Date(clampDisplayDate(bucketEnd, todayIso) + 'T00:00:00Z'));
}

/** % delta with the spec's honesty rules: baseline must be > 0; |pct| ≤ 999.9. */
export function deltaPctOrNull(delta: number, baseline: number): number | null {
  if (baseline <= 0) return null;
  const pct = (delta / baseline) * 100;
  return Math.abs(pct) > 999.9 ? null : pct;
}

export interface AssetValuePoint {
  bucketEnd: string;
  value: number;
}

export interface AssetValueView {
  points: AssetValuePoint[];
  latest: AssetValuePoint | null;
  baseline: AssetValuePoint | null;
  /** latest − baseline; null when fewer than 2 points. */
  delta: number | null;
  deltaPct: number | null;
  /**
   * "past year" | "this year" | … | "since Mar 2026".
   * Render only when `delta !== null`; the component shows "not enough
   * history" otherwise (a 1-point series still gets a phrase here).
   */
  phrase: string;
}

export function buildAssetValueView(
  rows: NetWorthChartRow[],
  window: TimeWindow,
  granularity: Granularity,
  todayIso: string,
): AssetValueView {
  const points = rows.map((r) => ({ bucketEnd: r.bucketEnd, value: r.netWorth }));
  const latest = points.length > 0 ? points[points.length - 1] : null;
  const baseline = points.length > 1 ? points[0] : null;
  const delta = latest && baseline ? latest.value - baseline.value : null;
  const deltaPct = delta !== null && baseline ? deltaPctOrNull(delta, baseline.value) : null;

  const tab = RANGE_TABS.find((t) => t.value === window);
  let phrase = tab?.phrase ?? '';
  if (window !== 'ALL' && points.length > 0) {
    const cutoff = cutoffForWindow(window, new Date(todayIso + 'T00:00:00Z'));
    if (cutoff) {
      // Covered when the first bucket is the window's own first bucket;
      // anything later means the data is shorter than the window — phrase
      // off the actual start instead (spec §3.1).
      const firstExpected = bucketEndFor(cutoff, granularity);
      if (points[0].bucketEnd > firstExpected) {
        const startIso = clampDisplayDate(points[0].bucketEnd, todayIso);
        phrase = `since ${MONTH_YEAR_FMT.format(new Date(startIso + 'T00:00:00Z'))}`;
      }
    }
  }
  return { points, latest, baseline, delta, deltaPct, phrase };
}

/** Explicit tick values: first bucket of each month (≤1Y) or year (5Y/ALL). */
export function xTicksFor(rows: NetWorthChartRow[], window: TimeWindow): string[] {
  const yearly = window === '5Y' || window === 'ALL';
  const ticks: string[] = [];
  let prev = '';
  for (const r of rows) {
    const key = yearly ? r.bucketEnd.slice(0, 4) : r.bucketEnd.slice(0, 7);
    if (key !== prev) {
      ticks.push(r.bucketEnd);
      prev = key;
    }
  }
  return ticks;
}

export function xTickLabel(bucketEnd: string, window: TimeWindow): string {
  const d = new Date(bucketEnd + 'T00:00:00Z');
  return window === '5Y' || window === 'ALL'
    ? String(d.getUTCFullYear())
    : MONTH_FMT.format(d);
}
