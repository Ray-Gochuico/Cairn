import { AccountType, ContributionSource } from '@/types/enums';
import { monthsBetween } from '@/lib/business-days';
import { assertNever } from '@/lib/assert';
import type { Account, Contribution } from '@/types/schema';

/**
 * Stacked monthly contributions chart on the Investments page buckets
 * contributions by destination — Brokerage, 401k, 401k Match, Roth IRA,
 * Trad IRA, HSA, 529. The bucket is derived from (account.type,
 * contribution.source): employer-match contributions go into "401k Match"
 * regardless of the host account, every other source rolls up by account
 * type. Accounts that aren't investments (CASH, SAVINGS, CRYPTO) are
 * excluded — the chart is about retirement / brokerage flows, not
 * everyday banking.
 */
export const CONTRIBUTION_BUCKETS = [
  'Brokerage',
  '401k',
  '401k Match',
  'Roth IRA',
  'Trad IRA',
  'HSA',
  '529',
] as const;

export type ContributionBucket = typeof CONTRIBUTION_BUCKETS[number];

export function bucketForContribution(
  contribution: Contribution,
  account: Account,
): ContributionBucket | null {
  if (
    account.type === AccountType.ACCOUNT_401K ||
    account.type === AccountType.ACCOUNT_ROTH_401K
  ) {
    return contribution.source === ContributionSource.EMPLOYER_MATCH
      ? '401k Match'
      : '401k';
  }
  switch (account.type) {
    case AccountType.ACCOUNT_BROKERAGE: return 'Brokerage';
    case AccountType.ACCOUNT_ROTH_IRA:  return 'Roth IRA';
    case AccountType.ACCOUNT_TRAD_IRA:  return 'Trad IRA';
    case AccountType.ACCOUNT_HSA:       return 'HSA';
    case AccountType.ACCOUNT_529:       return '529';
    // Non-investment accounts are intentionally excluded from the chart.
    case AccountType.ACCOUNT_CASH:
    case AccountType.ACCOUNT_SAVINGS:
    case AccountType.ACCOUNT_CRYPTO:
      return null;
    // ACCOUNT_401K is handled above, before the switch; every other AccountType
    // has an explicit case. Adding a new member makes `account.type` non-`never`
    // here, so `tsc` errors instead of its contributions silently vanishing.
    default:
      return assertNever(account.type);
  }
}

export interface MonthlyContributionsByBucket {
  month: string;
  Brokerage: number;
  '401k': number;
  '401k Match': number;
  'Roth IRA': number;
  'Trad IRA': number;
  HSA: number;
  '529': number;
  // Index signature matches BarChartPoint so the row type is directly usable
  // as chart input without an unsafe cast at the boundary.
  [key: string]: string | number;
}

/**
 * Aggregate contributions into a month × bucket matrix suitable for a stacked
 * bar chart. Months are filled in inclusively from `fromYyyymm` to `toYyyymm`
 * so the chart renders zero bars for months with no contributions instead of
 * silently dropping them. Accounts not in `accounts` are skipped (their bucket
 * can't be determined) — same posture as a unknown ticker on the donut.
 */
export function aggregateContributionsByBucket(
  contributions: ReadonlyArray<Contribution>,
  accounts: ReadonlyArray<Account>,
  fromYyyymm: string,
  toYyyymm: string,
): MonthlyContributionsByBucket[] {
  const accountById = new Map<number, Account>(
    accounts.filter((a) => a.id != null).map((a) => [a.id as number, a]),
  );
  const months = monthsBetween(fromYyyymm, toYyyymm);
  const result: MonthlyContributionsByBucket[] = months.map((month) => ({
    month,
    Brokerage: 0,
    '401k': 0,
    '401k Match': 0,
    'Roth IRA': 0,
    'Trad IRA': 0,
    HSA: 0,
    '529': 0,
  }));
  const rowByMonth = new Map<string, MonthlyContributionsByBucket>(
    result.map((r) => [r.month, r]),
  );
  for (const c of contributions) {
    const account = accountById.get(c.accountId);
    if (!account) continue;
    const bucket = bucketForContribution(c, account);
    if (!bucket) continue;
    const row = rowByMonth.get(c.date.slice(0, 7));
    if (!row) continue;
    row[bucket] += c.amount;
  }
  return result;
}
