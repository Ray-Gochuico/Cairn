import {
  bucketEndFor,
  cutoffForWindow,
  type Granularity,
  type TimeWindow,
} from '@/lib/snapshot-bucketing';
import type { NetWorthChartRow } from '@/lib/net-worth-chart-data';
import { assetValuesAsOf } from '@/lib/asset-snapshot-bucketing';
import { loanBalanceHistory } from '@/lib/loan-history';
import { sumLatestOnOrBefore } from '@/lib/growth-horizons';
import { entityKey } from '@/lib/entity-key';
import type { EntityKind } from '@/lib/net-worth-chart-prefs';
import type { AssetValueSnapshot, Loan } from '@/types/schema';

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

/**
 * Earliest observation across the selected entities — MUST mirror the
 * builder's observation-starts semantics (net-worth-chart-data.ts):
 * accounts → first snapshot; property/vehicle → min(first snapshot,
 * purchaseDate). Drives granularityForWindow's ALL-span so the contiguous
 * spine stays within MAX_BUCKETS.
 */
export function earliestObservationIso(args: {
  selectedKeys: ReadonlySet<string>;
  snapshots: ReadonlyArray<{ accountId: number; snapshotDate: string }>;
  assetValueSnapshots: ReadonlyArray<{
    ownerType: string;
    ownerId: number;
    snapshotDate: string;
  }>;
  properties: ReadonlyArray<{ id?: number; purchaseDate: string | null }>;
  vehicles: ReadonlyArray<{ id?: number; purchaseDate: string | null }>;
}): string | null {
  const { selectedKeys, snapshots, assetValueSnapshots, properties, vehicles } = args;
  let min: string | null = null;
  const consider = (d: string) => {
    if (min === null || d < min) min = d;
  };
  for (const s of snapshots) {
    if (selectedKeys.has(entityKey('account', s.accountId))) consider(s.snapshotDate);
  }
  for (const s of assetValueSnapshots) {
    const kind =
      s.ownerType === 'PROPERTY' ? 'property' : s.ownerType === 'VEHICLE' ? 'vehicle' : null;
    if (kind !== null && selectedKeys.has(entityKey(kind, s.ownerId))) {
      consider(s.snapshotDate);
    }
  }
  for (const [assets, kind] of [
    [properties, 'property'],
    [vehicles, 'vehicle'],
  ] as const) {
    for (const a of assets) {
      if (a.id == null || a.purchaseDate == null) continue;
      if (selectedKeys.has(entityKey(kind, a.id))) consider(a.purchaseDate);
    }
  }
  return min;
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
/** Round-3 M5: cap the hero x-axis at this many sparse, anchored labels. */
const MAX_X_TICKS = 5;

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

/**
 * Explicit tick values: first bucket of each month (≤1Y) or year (5Y/ALL).
 *
 * Future-tick clamp (spec §5.1): under WEEK granularity the final bucket can
 * end next Saturday, which may fall in a month/year `today` hasn't reached
 * yet — ticking it would show the label (e.g. 'Jul') days early. Skip any
 * candidate whose bucketEnd is still in the future; a suppressed tick is
 * better than one with a premature label.
 */
export function xTicksFor(
  rows: NetWorthChartRow[],
  window: TimeWindow,
  todayIso: string,
): string[] {
  const yearly = window === '5Y' || window === 'ALL';
  const ticks: string[] = [];
  let prev = '';
  for (const r of rows) {
    const key = yearly ? r.bucketEnd.slice(0, 4) : r.bucketEnd.slice(0, 7);
    if (key !== prev) {
      if (r.bucketEnd > todayIso) continue;
      ticks.push(r.bucketEnd);
      prev = key;
    }
  }
  // Round-3 M5: cap the axis at MAX_X_TICKS sparse labels. Twelve month
  // ticks on the 1Y hero read as noise (and bare 'Jan' labels were
  // year-ambiguous); 3-5 anchored labels date the chart at a glance.
  if (ticks.length <= MAX_X_TICKS) return ticks;
  const step = Math.ceil(ticks.length / MAX_X_TICKS);
  return ticks.filter((_, i) => i % step === 0);
}

export function xTickLabel(bucketEnd: string, window: TimeWindow): string {
  const d = new Date(bucketEnd + 'T00:00:00Z');
  return window === '5Y' || window === 'ALL'
    ? String(d.getUTCFullYear())
    : MONTH_YEAR_FMT.format(d); // 'Jan 2026' — year-anchored (round-3 M5)
}

export interface HeaderLabelOverrides {
  /** Selection == the entire eligible set. Default 'Net worth'. */
  fullSet?: string;
  /** Partial pick containing a loan. Default 'Included net'. */
  withLoans?: string;
  /** All-and-only assets while loans exist. Default 'Total assets'. */
  allAssets?: string;
  /** Any other partial assets-only pick. Default 'Included assets'. */
  partialAssets?: string;
}

/**
 * Header label per spec §3.1. The RULES are fixed: the full-set label ONLY
 * when the selection equals the entire eligible set (so a stale or partial
 * pick can never masquerade as the total); the with-loans label when any
 * loan is in a partial pick; the all-assets label for all-and-only assets;
 * the partial-assets label otherwise; a lone entity shows its own name.
 * Only the WORDING is surface-configurable via `labels` — an accounts-only
 * surface must not say "Net worth" (loans are out of scope by construction).
 */
export function headerLabel(args: {
  selected: ReadonlySet<string>;
  eligibleAssets: readonly string[];
  eligibleLoans: readonly string[];
  nameByKey: ReadonlyMap<string, string>;
  labels?: HeaderLabelOverrides;
}): string {
  const { selected, eligibleAssets, eligibleLoans, nameByKey, labels } = args;
  if (selected.size === 1) {
    const only = [...selected][0];
    return nameByKey.get(only) ?? labels?.partialAssets ?? 'Included assets';
  }
  const selAssets = eligibleAssets.filter((k) => selected.has(k)).length;
  const selLoans = eligibleLoans.filter((k) => selected.has(k)).length;
  const fullSet =
    selAssets === eligibleAssets.length &&
    selLoans === eligibleLoans.length &&
    selected.size === selAssets + selLoans;
  if (fullSet) return labels?.fullSet ?? 'Net worth';
  if (selLoans > 0) return labels?.withLoans ?? 'Included net';
  if (selAssets === eligibleAssets.length && selected.size === selAssets)
    return labels?.allAssets ?? 'Total assets';
  return labels?.partialAssets ?? 'Included assets';
}

export interface BreakdownRow {
  key: string;
  kind: EntityKind;
  name: string;
  /** Signed: loans negative. */
  value: number;
  /**
   * Change in net-worth contribution over the range — loan paydown is
   * positive. NULL when there is no baseline — render '—', never '$0'.
   */
  delta: number | null;
  deltaPct: number | null;
  /** Fraction of gross included assets; null for loans and negative values. */
  share: number | null;
  estimateBacked: boolean;
  /** Latest underlying observation date when older than one bucket; else null. */
  asOf: string | null;
}

export function buildBreakdownRows(args: {
  currentRow: NetWorthChartRow;
  baselineRow: NetWorthChartRow | null;
  entities: ReadonlyArray<{ key: string; kind: EntityKind; name: string }>;
  estimateBacked: ReadonlySet<string>;
  latestObservationByKey: ReadonlyMap<string, string>;
  previousBucketEnd: string | null;
}): BreakdownRow[] {
  const { currentRow, baselineRow, entities, estimateBacked, latestObservationByKey, previousBucketEnd } = args;
  const grossAssets = entities.reduce((sum, e) => {
    if (e.kind === 'loan') return sum;
    const v = currentRow[e.key];
    return sum + (typeof v === 'number' && v > 0 ? v : 0);
  }, 0);

  const rows = entities.map<BreakdownRow>((e) => {
    const raw = currentRow[e.key];
    const value = typeof raw === 'number' ? raw : 0;
    const baseRaw = baselineRow?.[e.key];
    const base = typeof baseRaw === 'number' ? baseRaw : 0;
    const delta = baselineRow ? value - base : null;
    const isLoan = e.kind === 'loan';
    const deltaPct = isLoan || delta === null ? null : deltaPctOrNull(delta, base);
    const share = isLoan || value < 0 || grossAssets <= 0 ? null : value / grossAssets;
    const obs = latestObservationByKey.get(e.key) ?? null;
    const isEst = estimateBacked.has(e.key);
    const stale =
      !isEst && obs !== null && previousBucketEnd !== null && obs <= previousBucketEnd;
    return {
      key: e.key,
      kind: e.kind,
      name: e.name,
      value,
      delta,
      deltaPct,
      share,
      estimateBacked: isEst,
      asOf: stale ? obs : null,
    };
  });
  return rows.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

export interface TooltipRowsResult {
  rows: Array<{ key: string; name: string; value: number }>;
  moreCount: number;
  /** SIGNED sum of the remainder (loans can make it negative). */
  moreSum: number;
}

export function tooltipRows(
  row: NetWorthChartRow,
  nameByKey: ReadonlyMap<string, string>,
  max = 5,
): TooltipRowsResult {
  const entries = Object.entries(row)
    .filter(([k, v]) => k !== 'bucketEnd' && k !== 'netWorth' && typeof v === 'number' && v !== 0)
    .map(([key, v]) => ({ key, name: nameByKey.get(key) ?? key, value: v as number }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const rows = entries.slice(0, max);
  const rest = entries.slice(max);
  return {
    rows,
    moreCount: rest.length,
    moreSum: rest.reduce((s, e) => s + e.value, 0),
  };
}

/** Properties/vehicles with zero value snapshots — their series is the flat estimate. */
export function estimateBackedKeys(
  entities: ReadonlyArray<{ key: string; kind: EntityKind; id: number }>,
  assetValueSnapshots: ReadonlyArray<Pick<AssetValueSnapshot, 'ownerType' | 'ownerId'>>,
): Set<string> {
  const out = new Set<string>();
  for (const e of entities) {
    if (e.kind !== 'property' && e.kind !== 'vehicle') continue;
    const ownerType = e.kind === 'property' ? 'PROPERTY' : 'VEHICLE';
    const has = assetValueSnapshots.some((s) => s.ownerType === ownerType && s.ownerId === e.id);
    if (!has) out.add(e.key);
  }
  return out;
}

/**
 * Day-granular net worth as-of factory for the GrowthCard refeed (spec §3.7):
 * the same as-of semantics the chart uses, so the two never disagree.
 * Returns null when no account history reaches the date (mirrors
 * sumLatestOnOrBefore) — the card renders "Not enough history yet".
 */
export function netWorthAsOfFactory(input: {
  snapshots: ReadonlyArray<{ accountId: number; snapshotDate: string; totalValue: number }>;
  properties: ReadonlyArray<{
    id?: number;
    purchaseDate: string | null;
    purchasePrice: number | null;
    currentEstimatedValue: number | null;
    excludedFromNetWorth: boolean;
  }>;
  vehicles: ReadonlyArray<{
    id?: number;
    purchaseDate: string | null;
    purchasePrice: number | null;
    currentEstimatedValue: number | null;
    excludedFromNetWorth: boolean;
  }>;
  loans: ReadonlyArray<Loan>;
  assetValueSnapshots: ReadonlyArray<AssetValueSnapshot>;
  todayIso: string;
}): (dateIso: string) => number | null {
  return (dateIso) => {
    const acct = sumLatestOnOrBefore(input.snapshots, dateIso);
    if (acct === null) return null;
    let total = acct;
    for (const [assets, ownerType] of [
      [input.properties, 'PROPERTY'],
      [input.vehicles, 'VEHICLE'],
    ] as const) {
      for (const a of assets) {
        if (a.excludedFromNetWorth || a.id == null) continue;
        total += assetValuesAsOf(input.assetValueSnapshots, ownerType, a.id, [dateIso], {
          purchaseDate: a.purchaseDate,
          purchasePrice: a.purchasePrice,
          currentEstimatedValue: a.currentEstimatedValue,
        })[0];
      }
    }
    for (const l of input.loans) {
      // Window must span dateIso → today so the anchor (today, currentBalance)
      // back-walks to dateIso. A single-bucket [dateIso, dateIso] window would
      // make dateIso itself the anchor and return TODAY'S balance for every
      // historical date (bug caught in Task 8 quality review).
      const walked = loanBalanceHistory(l, dateIso, input.todayIso, 'DAY', input.todayIso);
      total -= walked[0]?.balance ?? l.currentBalance;
    }
    return total;
  };
}
