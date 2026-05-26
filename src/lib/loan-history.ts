import type { Loan } from '@/types/schema';
import type { Granularity } from '@/lib/snapshot-bucketing';

/**
 * Walk a loan's balance backward from `loan.currentBalance` using the standard
 * amortization formula. Returns one entry per bucket between fromISO and toISO,
 * inclusive (sorted ascending by bucketEnd).
 *
 * v1 assumes:
 *  - Constant `interestRate` over the entire window.
 *  - Constant `monthlyPayment` (no extras, no refinances, no payment skips).
 *
 * Amortization formula (per month, walking BACKWARD from a known balance):
 *   interest_n   = balance_n * (annualRate / 12)
 *   principal_n  = monthlyPayment - interest_n
 *   balance_{n-1} = balance_n + principal_n
 *
 * Bucket-end semantics mirror `src/lib/snapshot-bucketing.ts:bucketEndFor`:
 *  - DAY     → the date itself
 *  - WEEK    → next Saturday on or after the date
 *  - MONTH   → last day of that month
 *  - QUARTER → last day of the quarter
 *  - YEAR    → Dec 31 of that year
 *
 * Anchor: the most recent bucketEnd ≤ today carries `loan.currentBalance`. The
 * back-walk produces earlier-bucket balances. Future buckets (after the anchor)
 * v1 holds flat at `currentBalance` — no forward projection.
 *
 * "Walked past origination": when the back-walked balance exceeds
 * `loan.originalAmount + $1` (rounding tolerance), the loan didn't exist that
 * far back — those (and earlier) buckets emit 0.
 *
 * If `loan.currentBalance` is 0 (fully paid), every bucket is 0.
 */
export function loanBalanceHistory(
  loan: Loan,
  fromISO: string,
  toISO: string,
  granularity: Granularity,
): Array<{ bucketEnd: string; balance: number }> {
  const buckets = enumerateBucketEnds(fromISO, toISO, granularity);
  if (buckets.length === 0) return [];

  if (loan.currentBalance <= 0) {
    return buckets.map((bucketEnd) => ({ bucketEnd, balance: 0 }));
  }

  const today = new Date().toISOString().slice(0, 10);
  const anchorIdx = findAnchor(buckets, today);
  const monthlyRate = loan.interestRate / 12;
  const pmt = loan.monthlyPayment;
  const originalCap = loan.originalAmount + 1; // $1 rounding tolerance

  const out: Array<{ bucketEnd: string; balance: number }> = new Array(buckets.length);

  // Future buckets (after the anchor, or all buckets if anchor is before-window):
  // hold flat at currentBalance — v1 doesn't project forward.
  const futureStart = anchorIdx < 0 ? 0 : anchorIdx + 1;
  for (let i = futureStart; i < buckets.length; i++) {
    out[i] = { bucketEnd: buckets[i], balance: loan.currentBalance };
  }

  // If the entire window is in the future of "today", we're done.
  if (anchorIdx < 0) return out;

  // Anchor bucket gets currentBalance verbatim.
  let bal = loan.currentBalance;
  out[anchorIdx] = { bucketEnd: buckets[anchorIdx], balance: bal };

  // Walk backward bucket-by-bucket, compounding the amortization step
  // `monthsBetweenBuckets` times between each adjacent pair.
  let stoppedAtOrigination = false;
  for (let i = anchorIdx - 1; i >= 0; i--) {
    if (stoppedAtOrigination) {
      out[i] = { bucketEnd: buckets[i], balance: 0 };
      continue;
    }
    const months = monthsBetweenBuckets(buckets[i + 1], buckets[i], granularity);
    for (let m = 0; m < months; m++) {
      const interest = bal * monthlyRate;
      const principal = pmt - interest;
      bal = bal + principal;
      if (bal > originalCap) {
        bal = 0;
        stoppedAtOrigination = true;
        break;
      }
    }
    out[i] = { bucketEnd: buckets[i], balance: stoppedAtOrigination ? 0 : bal };
  }

  return out;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Last day of period containing `dateIso`, per granularity. Mirrors the
 * `bucketEndFor` logic in `src/lib/snapshot-bucketing.ts`. UTC math for
 * timezone stability.
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

/**
 * Step from one bucket-end to the next, per granularity. Used to enumerate
 * bucket ends between `fromISO` and `toISO`.
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
 * Enumerate bucket-end ISO dates in ascending order spanning [fromISO, toISO]
 * inclusive. The first bucket-end is `bucketEndFor(fromISO, g)`; subsequent
 * ends step forward per granularity until we pass `toISO`.
 */
function enumerateBucketEnds(fromISO: string, toISO: string, g: Granularity): string[] {
  if (fromISO > toISO) return [];
  const out: string[] = [];
  let cur = bucketEndFor(fromISO, g);
  // Safety cap: ~4000 entries comfortably covers >10y at DAY granularity.
  const SAFETY_CAP = 10_000;
  while (cur <= toISO && out.length < SAFETY_CAP) {
    out.push(cur);
    cur = nextBucketEnd(cur, g);
  }
  return out;
}

/**
 * Index of the largest bucket whose bucketEnd ≤ today. Returns -1 if every
 * bucket is in the future of today.
 */
function findAnchor(buckets: string[], today: string): number {
  for (let i = buckets.length - 1; i >= 0; i--) {
    if (buckets[i] <= today) return i;
  }
  return -1;
}

/**
 * Number of monthly compounding steps between two adjacent bucket ends.
 * `later` and `earlier` are both ISO bucket-end dates with `earlier < later`.
 *
 * For granularity = MONTH/QUARTER/YEAR the gap is fixed (1, 3, 12 months
 * respectively). For DAY/WEEK we approximate via days / 30 (rounded up to at
 * least 1 step when there's any gap at all), so the back-walk still advances.
 */
function monthsBetweenBuckets(later: string, earlier: string, g: Granularity): number {
  if (g === 'MONTH') return 1;
  if (g === 'QUARTER') return 3;
  if (g === 'YEAR') return 12;
  // DAY or WEEK — compute calendar-day gap, divide by 30, floor with min 1.
  const a = Date.parse(earlier + 'T00:00:00Z');
  const b = Date.parse(later + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  const days = Math.round((b - a) / 86_400_000);
  const months = Math.floor(days / 30);
  return Math.max(1, months);
}
