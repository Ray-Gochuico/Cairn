import {
  absDays,
  bucketSnapshotsByClosestDate,
  type Granularity,
  type TimeWindow,
} from '@/lib/snapshot-bucketing';
import { bucketAssetSnapshots } from '@/lib/asset-snapshot-bucketing';
import { loanBalanceHistory } from '@/lib/loan-history';
import { entityKey, parseEntityKey } from '@/lib/entity-key';
import type {
  Account,
  AccountSnapshot,
  AssetValueSnapshot,
  Loan,
  Property,
  Vehicle,
} from '@/types/schema';

const MAX_BUCKETS = 90;

/**
 * Last day of period containing `dateIso`, per granularity. Mirrors the
 * private `bucketEndFor` in `src/lib/snapshot-bucketing.ts` and
 * `src/lib/loan-history.ts`. Re-implemented locally because neither file
 * exports it — keeping the two existing modules untouched.
 */
function bucketEndFor(dateIso: string, g: Granularity): string {
  const d = new Date(dateIso + 'T00:00:00Z');
  if (g === 'DAY') return dateIso;
  if (g === 'WEEK') {
    const day = d.getUTCDay();
    d.setUTCDate(d.getUTCDate() + (6 - day)); // Saturday
    return d.toISOString().slice(0, 10);
  }
  if (g === 'MONTH') {
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    return end.toISOString().slice(0, 10);
  }
  if (g === 'QUARTER') {
    const q = Math.floor(d.getUTCMonth() / 3);
    const end = new Date(Date.UTC(d.getUTCFullYear(), q * 3 + 3, 0));
    return end.toISOString().slice(0, 10);
  }
  // YEAR
  return `${d.getUTCFullYear()}-12-31`;
}

export interface NetWorthChartRow {
  bucketEnd: string;
  /** Positive per-entity stack values (`account:42` / `property:7` / `vehicle:3` keys). */
  [entityKey: string]: number | string;
  /** Asset−Liability for this bucket — drives the overlaid Net Worth line. */
  netWorth: number;
}

export interface NetWorthChartInput {
  accounts: Account[];
  snapshots: AccountSnapshot[];
  properties: Property[];
  vehicles: Vehicle[];
  loans: Loan[];
  assetValueSnapshots: AssetValueSnapshot[];
  /** Composite entity keys (e.g., "account:42"). */
  selectedKeys: Set<string>;
  granularity: Granularity;
  /** ISO cutoff date (from `cutoffForWindow`) — null = no lower bound. */
  cutoff: string | null;
  /** Override for "today" — defaults to the system clock. Tests inject. */
  today?: string;
}

/**
 * Build the per-bucket row array consumed by `NetWorthTimeSeriesChart`'s
 * `<ComposedChart data=...>` prop.
 *
 * The bucket spine is the union of every snapshot date attached to a
 * selected entity (account_snapshots + asset_value_snapshots), bucketed
 * per granularity, filtered to >= cutoff. Loans don't contribute discrete
 * snapshot dates — their values are filled in at whatever buckets already
 * exist from the asset side. If selection includes ONLY loans and no
 * snapshots, the spine falls back to the last 12 buckets ending at today.
 *
 * Per-bucket values:
 *   - account → bucketSnapshots' carry-forward series
 *   - property/vehicle → bucketAssetSnapshots (latest snapshot ≤ bucketEnd,
 *     or currentEstimatedValue fallback)
 *   - loan → loanBalanceHistory at that bucketEnd (negated so the bar
 *     stacks downward)
 *
 * Returned rows are sorted ascending by bucketEnd and capped at the most
 * recent MAX_BUCKETS entries (matches InvestmentTimeSeriesChart).
 */
export function buildNetWorthChartData(
  input: NetWorthChartInput,
): NetWorthChartRow[] {
  const {
    accounts,
    snapshots,
    properties,
    vehicles,
    loans,
    assetValueSnapshots,
    selectedKeys,
    granularity,
    cutoff,
    today: todayOverride,
  } = input;

  if (selectedKeys.size === 0) return [];

  const today = todayOverride ?? new Date().toISOString().slice(0, 10);

  // Resolve each selected key to its concrete entity so we can compute
  // values + drop entries that point at deleted entities.
  interface Resolved {
    key: string;
    kind: 'account' | 'property' | 'vehicle' | 'loan';
    id: number;
    account?: Account;
    property?: Property;
    vehicle?: Vehicle;
    loan?: Loan;
  }
  const resolved: Resolved[] = [];
  for (const key of selectedKeys) {
    const parsed = parseEntityKey(key);
    if (!parsed) continue;
    if (parsed.kind === 'account') {
      const account = accounts.find((a) => a.id === parsed.id);
      if (!account) continue;
      resolved.push({ key, kind: 'account', id: parsed.id, account });
    } else if (parsed.kind === 'property') {
      const property = properties.find((p) => p.id === parsed.id);
      if (!property) continue;
      resolved.push({ key, kind: 'property', id: parsed.id, property });
    } else if (parsed.kind === 'vehicle') {
      const vehicle = vehicles.find((v) => v.id === parsed.id);
      if (!vehicle) continue;
      resolved.push({ key, kind: 'vehicle', id: parsed.id, vehicle });
    } else {
      const loan = loans.find((l) => l.id === parsed.id);
      if (!loan) continue;
      resolved.push({ key, kind: 'loan', id: parsed.id, loan });
    }
  }
  if (resolved.length === 0) return [];

  // ----- Build the bucket spine -----
  // Collect all snapshot dates from selected accounts + selected
  // properties/vehicles, filter by cutoff, bucket-end-ify, dedupe + sort.
  const selectedAccountIds = new Set(
    resolved.filter((r) => r.kind === 'account').map((r) => r.id),
  );
  const selectedAssetPairs = new Set(
    resolved
      .filter((r) => r.kind === 'property' || r.kind === 'vehicle')
      .map(
        (r) => `${r.kind === 'property' ? 'PROPERTY' : 'VEHICLE'}:${r.id}`,
      ),
  );

  const bucketEndSet = new Set<string>();
  for (const s of snapshots) {
    if (!selectedAccountIds.has(s.accountId)) continue;
    if (cutoff && s.snapshotDate < cutoff) continue;
    bucketEndSet.add(bucketEndFor(s.snapshotDate, granularity));
  }
  for (const s of assetValueSnapshots) {
    const pair = `${s.ownerType}:${s.ownerId}`;
    if (!selectedAssetPairs.has(pair)) continue;
    if (cutoff && s.snapshotDate < cutoff) continue;
    bucketEndSet.add(bucketEndFor(s.snapshotDate, granularity));
  }

  // Loans-only selection: fall back to a synthesized 12-bucket spine
  // ending at today so the chart still has somewhere to render.
  if (bucketEndSet.size === 0) {
    bucketEndSet.add(bucketEndFor(today, granularity));
    // Walk backwards: 11 prior buckets at the granularity step.
    let cursor = bucketEndFor(today, granularity);
    for (let i = 0; i < 11; i++) {
      cursor = prevBucketEnd(cursor, granularity);
      if (cutoff && cursor < cutoff) break;
      bucketEndSet.add(cursor);
    }
  }

  // Always include a bucket at today so the chart's right edge lines up
  // with the user's mental "now" — same nicety as InvestmentTimeSeriesChart's
  // implicit behavior (its snapshots typically reach today already).
  bucketEndSet.add(bucketEndFor(today, granularity));

  const bucketEnds = [...bucketEndSet].sort().slice(-MAX_BUCKETS);
  if (bucketEnds.length === 0) return [];

  // Cap loan balance walks to start at the earliest bucket.
  const from = bucketEnds[0];
  const to = bucketEnds[bucketEnds.length - 1];

  // ----- Per-account closest-date series via bucketSnapshotsByClosestDate -----
  // The helper builds its own bucketEnds from the input snapshot dates,
  // which may differ from OUR bucketEnds (e.g., the spine includes a
  // "today" bucket beyond the latest snapshot, or starts earlier when
  // loans-only selection synthesizes a 12-bucket spine). We align each
  // account's series to OUR bucketEnds by picking the value at the
  // closest series bucketEnd — same closest-date semantic, just nested.
  const accountValuesByKey = new Map<string, number[]>();
  if (selectedAccountIds.size > 0) {
    const filtered = snapshots.filter(
      (s) =>
        selectedAccountIds.has(s.accountId) &&
        (cutoff === null || s.snapshotDate >= cutoff),
    );
    const series = bucketSnapshotsByClosestDate(
      filtered,
      granularity,
      MAX_BUCKETS,
    );
    for (const accountId of selectedAccountIds) {
      const raw = series.valuesByAccount.get(accountId) ?? [];
      const aligned: number[] = new Array(bucketEnds.length);
      for (let i = 0; i < bucketEnds.length; i++) {
        if (series.bucketEnds.length === 0) {
          aligned[i] = 0;
          continue;
        }
        // Closest series bucketEnd to OUR bucketEnd; later wins ties to
        // match the underlying helper's tiebreaker.
        const target = bucketEnds[i];
        let bestIdx = 0;
        let bestDistance = Number.POSITIVE_INFINITY;
        let bestEnd = '';
        for (let j = 0; j < series.bucketEnds.length; j++) {
          const end = series.bucketEnds[j];
          const d = absDays(end, target);
          if (d < bestDistance || (d === bestDistance && end > bestEnd)) {
            bestDistance = d;
            bestIdx = j;
            bestEnd = end;
          }
        }
        aligned[i] = raw[bestIdx] ?? 0;
      }
      accountValuesByKey.set(entityKey('account', accountId), aligned);
    }
  }

  // ----- Per-loan back-walk via loanBalanceHistory -----
  const loanValuesByKey = new Map<string, number[]>();
  for (const r of resolved) {
    if (r.kind !== 'loan' || !r.loan) continue;
    const walks = loanBalanceHistory(r.loan, from, to, granularity);
    // Align walks to bucketEnds with carry-forward semantics — walks
    // already produces one entry per bucketEnd in [from, to] per its
    // contract, but those bucket ends are generated by the same logic
    // as ours so they should match 1:1. We still defensively look up
    // by date.
    const byEnd = new Map<string, number>();
    for (const w of walks) byEnd.set(w.bucketEnd, w.balance);
    const series: number[] = new Array(bucketEnds.length);
    let last = r.loan.currentBalance;
    for (let i = 0; i < bucketEnds.length; i++) {
      const v = byEnd.get(bucketEnds[i]);
      if (v != null) {
        last = v;
        series[i] = v;
      } else {
        series[i] = last;
      }
    }
    loanValuesByKey.set(entityKey('loan', r.id), series);
  }

  // ----- Build the row array -----
  const rows: NetWorthChartRow[] = [];
  for (let i = 0; i < bucketEnds.length; i++) {
    const bEnd = bucketEnds[i];
    const row: NetWorthChartRow = { bucketEnd: bEnd, netWorth: 0 };
    let assets = 0;
    let liabilities = 0;

    for (const r of resolved) {
      if (r.kind === 'account') {
        const v = accountValuesByKey.get(r.key)?.[i] ?? 0;
        row[r.key] = v;
        assets += v;
      } else if (r.kind === 'property' && r.property) {
        const v = bucketAssetSnapshots(
          assetValueSnapshots,
          'PROPERTY',
          r.id,
          [bEnd],
          granularity,
          r.property.currentEstimatedValue,
        )[0];
        row[r.key] = v;
        assets += v;
      } else if (r.kind === 'vehicle' && r.vehicle) {
        const v = bucketAssetSnapshots(
          assetValueSnapshots,
          'VEHICLE',
          r.id,
          [bEnd],
          granularity,
          r.vehicle.currentEstimatedValue,
        )[0];
        row[r.key] = v;
        assets += v;
      } else if (r.kind === 'loan' && r.loan) {
        const v = loanValuesByKey.get(r.key)?.[i] ?? 0;
        // Stack downward — recharts stacks negative values below zero
        // separately from positive ones (controlled by stackId).
        row[r.key] = -v;
        liabilities += v;
      }
    }

    row.netWorth = assets - liabilities;
    rows.push(row);
  }

  return rows;
}

/**
 * Step backward one bucket end. Used to synthesize a 12-bucket spine when
 * the user selects only loans / has no qualifying snapshots.
 */
function prevBucketEnd(bucketEndIso: string, g: Granularity): string {
  const d = new Date(bucketEndIso + 'T00:00:00Z');
  if (g === 'DAY') {
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }
  if (g === 'WEEK') {
    d.setUTCDate(d.getUTCDate() - 7);
    return d.toISOString().slice(0, 10);
  }
  if (g === 'MONTH') {
    // bucketEnd is last day of month; step to last day of prior month.
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0));
    return end.toISOString().slice(0, 10);
  }
  if (g === 'QUARTER') {
    // bucketEnd is last day of quarter; step to last day of prior quarter.
    const m = d.getUTCMonth(); // 2, 5, 8, or 11
    const end = new Date(Date.UTC(d.getUTCFullYear(), m - 2, 0));
    return end.toISOString().slice(0, 10);
  }
  // YEAR — prior Dec 31.
  return `${d.getUTCFullYear() - 1}-12-31`;
}

// Re-export the time window type for callers that don't want to import
// from snapshot-bucketing directly.
export type { TimeWindow };
