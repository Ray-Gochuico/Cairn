import {
  bucketEndFor,
  type Granularity,
  type TimeWindow,
} from '@/lib/snapshot-bucketing';
import { assetValuesAsOf } from '@/lib/asset-snapshot-bucketing';
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
 * As-of semantics over a CONTIGUOUS spine (spec §5.1):
 *
 * The spine is every consecutive bucket end from
 * max(cutoff, earliest observation among selected entities) through the
 * bucket containing `today` — no gaps, so a categorical x-axis is
 * time-honest. Observation starts: accounts → first snapshot;
 * property/vehicle → min(first asset snapshot, purchaseDate). Loans and
 * estimate-only assets don't define a start; if ONLY those are selected
 * the spine falls back to the last 12 buckets ending at today.
 *
 * Per-bucket values are AS-OF — the latest observation ≤ bucketEnd, never
 * a later one (no look-ahead). Snapshots before the cutoff still carry IN
 * to the baseline bucket, an entity is 0 before its first observation,
 * and a stale entity's last value persists through the newest bucket (the
 * "current" reading is window-stable):
 *   - account → latest account snapshot ≤ bucketEnd (same-date duplicates:
 *     higher id, i.e. later insert, wins)
 *   - property/vehicle → assetValuesAsOf (purchase anchoring 0 →
 *     purchasePrice → snapshots; flat currentEstimatedValue only for
 *     entities with no snapshots at all)
 *   - loan → loanBalanceHistory back-walk anchored at `today` (negated so
 *     the bar stacks downward)
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

  // ----- Observation starts (spec §5.1) -----
  // The spine begins at the first date any selected entity has real data:
  // accounts → first snapshot; property/vehicle → min(first snapshot,
  // purchaseDate). Estimate-only entities (no snapshots, no purchaseDate)
  // and loans don't define a start — they render across whatever spine the
  // others establish (or the synthetic fallback below).
  const starts: string[] = [];
  const selectedAccountIds = new Set(
    resolved.filter((r) => r.kind === 'account').map((r) => r.id),
  );
  const firstSnapByAccount = new Map<number, string>();
  for (const s of snapshots) {
    if (!selectedAccountIds.has(s.accountId)) continue;
    const prev = firstSnapByAccount.get(s.accountId);
    if (!prev || s.snapshotDate < prev) firstSnapByAccount.set(s.accountId, s.snapshotDate);
  }
  starts.push(...firstSnapByAccount.values());
  for (const r of resolved) {
    if (r.kind !== 'property' && r.kind !== 'vehicle') continue;
    const ownerType = r.kind === 'property' ? 'PROPERTY' : 'VEHICLE';
    let first: string | null = null;
    for (const s of assetValueSnapshots) {
      if (s.ownerType !== ownerType || s.ownerId !== r.id) continue;
      if (first === null || s.snapshotDate < first) first = s.snapshotDate;
    }
    const purchase = r.kind === 'property' ? r.property?.purchaseDate : r.vehicle?.purchaseDate;
    const start = [first, purchase ?? null].filter((d): d is string => d != null).sort()[0];
    if (start) starts.push(start);
  }

  // ----- Contiguous spine: window start → today, every bucket present -----
  let spineStart: string;
  if (starts.length === 0) {
    // Loans-only / estimate-only selection: synthesize 12 buckets ending today.
    let cursor = bucketEndFor(today, granularity);
    for (let i = 0; i < 11; i++) {
      const prev = prevBucketEnd(cursor, granularity);
      if (cutoff && prev < cutoff) break;
      cursor = prev;
    }
    spineStart = cursor;
  } else {
    const earliest = [...starts].sort()[0];
    spineStart = cutoff && cutoff > earliest ? cutoff : earliest;
  }
  const todayEnd = bucketEndFor(today, granularity);
  const bucketEnds: string[] = [];
  let cur = bucketEndFor(spineStart, granularity);
  const SAFETY_CAP = 10_000;
  while (cur <= todayEnd && bucketEnds.length < SAFETY_CAP) {
    bucketEnds.push(cur);
    cur = nextBucketEnd(cur, granularity);
  }
  const spine = bucketEnds.slice(-MAX_BUCKETS);
  if (spine.length === 0) return [];
  const from = spine[0];
  const to = spine[spine.length - 1];

  // ----- Per-account as-of series (carry-in included; 0 before first) -----
  const accountValuesByKey = new Map<string, number[]>();
  for (const accountId of selectedAccountIds) {
    const sorted = snapshots
      .filter((s) => s.accountId === accountId)
      // Ascending id breaks same-date ties so a later insert (correction)
      // wins — mirrors assetValuesAsOf's convention.
      .sort(
        (a, b) =>
          a.snapshotDate.localeCompare(b.snapshotDate) ||
          (a.id ?? 0) - (b.id ?? 0),
      );
    const series: number[] = new Array(spine.length);
    let j = 0;
    let last: number | null = null;
    for (let i = 0; i < spine.length; i++) {
      while (j < sorted.length && sorted[j].snapshotDate <= spine[i]) {
        last = sorted[j].totalValue;
        j++;
      }
      series[i] = last ?? 0;
    }
    accountValuesByKey.set(entityKey('account', accountId), series);
  }

  // ----- Per-asset as-of series (purchase anchoring) -----
  const assetValuesByKey = new Map<string, number[]>();
  for (const r of resolved) {
    if (r.kind !== 'property' && r.kind !== 'vehicle') continue;
    const ownerType = r.kind === 'property' ? 'PROPERTY' : 'VEHICLE';
    const entity = r.kind === 'property' ? r.property! : r.vehicle!;
    assetValuesByKey.set(
      r.key,
      assetValuesAsOf(assetValueSnapshots, ownerType, r.id, spine, {
        purchaseDate: entity.purchaseDate,
        purchasePrice: entity.purchasePrice,
        currentEstimatedValue: entity.currentEstimatedValue,
      }),
    );
  }

  // ----- Per-loan back-walk via loanBalanceHistory -----
  const loanValuesByKey = new Map<string, number[]>();
  for (const r of resolved) {
    if (r.kind !== 'loan' || !r.loan) continue;
    // Thread the injected clock so the anchor bucket (= currentBalance)
    // is placed by OUR `today`, not the real wall clock.
    const walks = loanBalanceHistory(r.loan, from, to, granularity, today);
    // Align walks to the spine with carry-forward semantics — walks
    // already produces one entry per bucketEnd in [from, to] per its
    // contract, and the spine is generated by the same bucket-end logic
    // so they should match 1:1. We still defensively look up by date.
    const byEnd = new Map<string, number>();
    for (const w of walks) byEnd.set(w.bucketEnd, w.balance);
    const series: number[] = new Array(spine.length);
    let last = r.loan.currentBalance;
    for (let i = 0; i < spine.length; i++) {
      const v = byEnd.get(spine[i]);
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
  for (let i = 0; i < spine.length; i++) {
    const bEnd = spine[i];
    const row: NetWorthChartRow = { bucketEnd: bEnd, netWorth: 0 };
    let assets = 0;
    let liabilities = 0;

    for (const r of resolved) {
      if (r.kind === 'account') {
        const v = accountValuesByKey.get(r.key)?.[i] ?? 0;
        row[r.key] = v;
        assets += v;
      } else if (r.kind === 'property' || r.kind === 'vehicle') {
        const v = assetValuesByKey.get(r.key)![i];
        row[r.key] = v;
        assets += v;
      } else if (r.kind === 'loan' && r.loan) {
        const v = loanValuesByKey.get(r.key)?.[i] ?? 0;
        // Stack downward — recharts stacks negative values below zero
        // separately from positive ones (controlled by stackId). Guard
        // v === 0 (pre-origination buckets): plain negation would store
        // -0, which breaks Object.is/toBe(0) checks downstream.
        row[r.key] = v === 0 ? 0 : -v;
        liabilities += v;
      }
    }

    row.netWorth = assets - liabilities;
    rows.push(row);
  }

  return rows;
}

/**
 * Step from one bucket-end to the next, per granularity. Used to enumerate
 * the contiguous spine. Mirrors the private `nextBucketEnd` in
 * `src/lib/loan-history.ts` so spine buckets and loan-walk buckets are
 * generated by identical logic and match 1:1.
 */
function nextBucketEnd(bucketEndIso: string, g: Granularity): string {
  const d = new Date(bucketEndIso + 'T00:00:00Z');
  if (g === 'DAY') {
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }
  if (g === 'WEEK') {
    // bucketEnd is a Saturday; add 7 days.
    d.setUTCDate(d.getUTCDate() + 7);
    return d.toISOString().slice(0, 10);
  }
  if (g === 'MONTH') {
    // bucketEnd is last day of month; first of next month is +1 day; bucket-end of that is last day of next month.
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 0));
    return end.toISOString().slice(0, 10);
  }
  if (g === 'QUARTER') {
    // bucketEnd is last day of quarter; next quarter ends three months later.
    const m = d.getUTCMonth(); // 2, 5, 8, or 11
    const end = new Date(Date.UTC(d.getUTCFullYear(), m + 4, 0));
    return end.toISOString().slice(0, 10);
  }
  // YEAR
  return `${d.getUTCFullYear() + 1}-12-31`;
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
