/**
 * Pure logic backing the "Portfolio by account" card on the Investments page
 * (see src/components/charts/AccountBreakdownCard.tsx). The card breaks the
 * portfolio down per account: each account's current value, its share of the
 * portfolio, and its change versus one month ago.
 *
 * Like growth-horizons.ts, everything here is deterministic and side-effect
 * free so it can be unit tested without a DB or React — the caller injects
 * `now` (no Date.now() inside). Keeping the math here keeps the component
 * purely presentational.
 *
 * Numbers stay consistent with the growth card by reusing the SAME 1-month
 * baseline-date logic (GROWTH_HORIZONS' '1m' horizon) and the SAME
 * per-account latest-snapshot lookup (latestPerAccountOnOrBefore).
 */

import type { Account, AccountSnapshot } from '@/types/schema';
import { AccountType } from '@/types/enums';
import {
  GROWTH_HORIZONS,
  latestPerAccountOnOrBefore,
} from '@/lib/growth-horizons';

/**
 * Cash-like account types excluded by the "Investable only" toggle. These are
 * the two non-investment types in the schema — everything else (401k, IRAs,
 * brokerage, HSA, crypto, 529) is treated as investable here.
 */
const CASH_LIKE_TYPES: ReadonlySet<AccountType> = new Set<AccountType>([
  AccountType.ACCOUNT_CASH,
  AccountType.ACCOUNT_SAVINGS,
]);

export interface AccountBreakdownRow {
  accountId: number;
  name: string;
  type: AccountType;
  /** Latest snapshot total_value; null when the account has no snapshot. */
  currentValue: number | null;
  /**
   * Value as of one month ago: the account's latest snapshot on-or-before the
   * 1-month baseline date. Null when there's no snapshot that far back.
   */
  valueAsOf: number | null;
  /**
   * Share of the included portfolio (currentValue / total). Null when the
   * account has no current value, or when the total is <= 0 (divide-by-zero
   * guard) — never NaN/Infinity.
   */
  pctOfTotal: number | null;
  /** currentValue - valueAsOf; null unless both are present. */
  changeAbs: number | null;
  /** Fraction (0.1 = +10%); null when valueAsOf is 0 or either side is null. */
  changePct: number | null;
}

export interface AccountBreakdownTotal {
  /** Sum of included rows' currentValue (treating null as absent). */
  currentValue: number;
  /**
   * Sum of included rows' valueAsOf; null when NO included account has a
   * baseline value (so the header renders an em-dash, not $0).
   */
  valueAsOf: number | null;
  /** Always 1 (100%) — the whole is the whole. */
  pctOfTotal: number;
  /** currentValue - valueAsOf; null when valueAsOf is null. */
  changeAbs: number | null;
  /** Fraction; null when valueAsOf is null or 0 (divide-by-zero guard). */
  changePct: number | null;
}

export interface AccountBreakdown {
  rows: AccountBreakdownRow[];
  total: AccountBreakdownTotal;
}

export interface ComputeAccountBreakdownOptions {
  /**
   * When true, additionally exclude cash-like accounts (CASH/SAVINGS) from the
   * rows AND the % denominator. Default false, so % sums to 100% across
   * everything held.
   */
  investableOnly?: boolean;
}

/**
 * Build the per-account portfolio breakdown.
 *
 * Included accounts = the passed `accounts` minus any flagged
 * `excludedFromNetWorth`, minus cash-like accounts when `investableOnly` is on.
 * (The caller is expected to pass an already owner-filtered account set — e.g.
 * the page's `visibleAccounts` — so the household/person view flows through.)
 *
 * Metric definitions (kept identical to the growth card for consistency):
 *  - currentValue = latest snapshot total_value per account (null if none).
 *  - valueAsOf = latest snapshot on-or-before (now - 1 month), using the SAME
 *    baseline date as GROWTH_HORIZONS' '1m' horizon.
 *  - changeAbs = currentValue - valueAsOf (null unless both present).
 *  - changePct = changeAbs / valueAsOf (null when valueAsOf is 0 or null).
 *  - pctOfTotal = currentValue / Σ(included currentValue), guarded so a
 *    non-positive total yields null rather than dividing.
 *  - total = sums of the included rows' currentValue and valueAsOf; its change
 *    and pct (=1) are derived from those sums, NOT from summing per-row values.
 */
export function computeAccountBreakdown(
  accounts: ReadonlyArray<Account>,
  snapshots: ReadonlyArray<AccountSnapshot>,
  now: Date,
  opts: ComputeAccountBreakdownOptions = {},
): AccountBreakdown {
  const { investableOnly = false } = opts;

  // 1) Decide which accounts are in scope. Always drop excludedFromNetWorth;
  //    drop cash-like types too when investableOnly is on. Accounts with no
  //    persisted id can't be matched to snapshots, so they're skipped.
  const includedAccounts = accounts.filter((a): a is Account & { id: number } => {
    if (a.id == null) return false;
    if (a.excludedFromNetWorth) return false;
    if (investableOnly && CASH_LIKE_TYPES.has(a.type)) return false;
    return true;
  });
  const includedIds = new Set(includedAccounts.map((a) => a.id));

  // 2) Resolve current and one-month-ago values per account, scoped to the
  //    included ids. Reusing latestPerAccountOnOrBefore (the same routine the
  //    growth card sums) keeps the breakdown numerically consistent with it.
  //    `now`'s UTC calendar day is the cutoff for "current"; the 1m horizon's
  //    baselineDate is the cutoff for "as of last month".
  const todayIso = toIsoDay(now);
  const baselineIso = oneMonthBaselineDate(now);
  const currentMap = latestPerAccountOnOrBefore(snapshots, todayIso, includedIds);
  const baselineMap = latestPerAccountOnOrBefore(snapshots, baselineIso, includedIds);

  // 3) Denominator first: Σ current value across included accounts that have
  //    one. Guarded later so total <= 0 never divides.
  let totalCurrent = 0;
  for (const a of includedAccounts) {
    const cur = currentMap.get(a.id);
    if (cur) totalCurrent += cur.value;
  }
  const totalIsDivisible = totalCurrent > 0;

  // 4) One row per included account, preserving the caller's order so the card
  //    list and the legend line up with however accounts were sorted upstream.
  const rows: AccountBreakdownRow[] = includedAccounts.map((a) => {
    const cur = currentMap.get(a.id);
    const base = baselineMap.get(a.id);
    const currentValue = cur ? cur.value : null;
    const valueAsOf = base ? base.value : null;

    const changeAbs =
      currentValue != null && valueAsOf != null ? currentValue - valueAsOf : null;
    // Fraction; a zero baseline can't yield a meaningful percentage, so we
    // suppress it (the card shows the absolute change instead).
    const changePct =
      currentValue != null && valueAsOf != null && valueAsOf !== 0
        ? (currentValue - valueAsOf) / valueAsOf
        : null;

    // A null current value can't be a share of the total; and if the total
    // isn't positive we don't divide at all.
    const pctOfTotal =
      currentValue != null && totalIsDivisible ? currentValue / totalCurrent : null;

    return {
      accountId: a.id,
      name: a.name,
      type: a.type,
      currentValue,
      valueAsOf,
      pctOfTotal,
      changeAbs,
      changePct,
    };
  });

  // 5) Totals from the SUMS (not summed per-row percentages). The baseline sum
  //    is null when no included account has any baseline value, so the header
  //    renders "—" rather than a misleading $0 change.
  let totalBaseline = 0;
  let anyBaseline = false;
  for (const a of includedAccounts) {
    const base = baselineMap.get(a.id);
    if (base) {
      totalBaseline += base.value;
      anyBaseline = true;
    }
  }
  const totalValueAsOf = anyBaseline ? totalBaseline : null;
  const totalChangeAbs = totalValueAsOf != null ? totalCurrent - totalValueAsOf : null;
  const totalChangePct =
    totalValueAsOf != null && totalValueAsOf !== 0
      ? (totalCurrent - totalValueAsOf) / totalValueAsOf
      : null;

  return {
    rows,
    total: {
      currentValue: totalCurrent,
      valueAsOf: totalValueAsOf,
      pctOfTotal: 1,
      changeAbs: totalChangeAbs,
      changePct: totalChangePct,
    },
  };
}

/** Slice a Date to its UTC calendar day as YYYY-MM-DD (mirrors growth-horizons). */
function toIsoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The 1-month baseline date, delegated to GROWTH_HORIZONS' '1m' horizon so the
 * breakdown's "change vs last month" lines up exactly with the growth card's
 * "Past month" figure. Falls back to a local minus-one-month only if the '1m'
 * horizon were ever removed (defensive; GROWTH_HORIZONS always defines it).
 */
function oneMonthBaselineDate(now: Date): string {
  const oneMonth = GROWTH_HORIZONS.find((h) => h.key === '1m');
  return oneMonth ? oneMonth.baselineDate(now) : toIsoDay(now);
}
