import type { NodeResult, RoadmapContext } from '@/types/roadmap';
import { AccountType } from '@/types/enums';
import type { Account, AccountSnapshot } from '@/types/schema';
import { computeBaselineExpenses } from '@/lib/expense-baseline';
import { includedAccountIds } from '@/lib/account-inclusion';

/**
 * Emergency-fund evaluators for the three EF nodes in Section 1.
 *
 * Cash-bucket convention: we count CASH + SAVINGS + HSA balances as
 * the EF reserve. HSA is included because it functions as a backup
 * emergency fund once you accumulate qualified-expense receipts —
 * matches how the source chart treats it.
 *
 * Baseline expense source: the rule prefers the 12-month rolling
 * average computed from real transactions. When no transactions are
 * present yet (new user, no imports), we fall back to the household's
 * manually entered `monthlyExpenseBaseline` so the rule still produces
 * a meaningful target. The active source is surfaced in the evidence
 * string so users can see whether the figure is computed or self-set.
 *
 * Targets:
 *   small  → max($1,000, 1 × baseline)
 *   3 mo   → 3  × baseline
 *   6–12mo → 6  × baseline (use 6 as the lower bound)
 *
 * The 3-month and 6-month rules require the user to have answered the
 * job-stability decision node first (so we know which path is on the
 * active branch). Until then, the off-branch rule reports
 * 'not-started' and the on-branch one reports its computed progress.
 */
const CASH_TYPES = new Set<AccountType>([
  AccountType.ACCOUNT_CASH,
  AccountType.ACCOUNT_SAVINGS,
  AccountType.ACCOUNT_HSA,
]);

function latestSnapshotValue(snapshots: AccountSnapshot[], accountId: number): number {
  let winner: AccountSnapshot | undefined;
  for (const s of snapshots) {
    if (s.accountId !== accountId) continue;
    if (!winner || s.snapshotDate > winner.snapshotDate) winner = s;
  }
  return winner?.totalValue ?? 0;
}

/**
 * DECISION (2026-07 wave 1): excluded-from-net-worth accounts do NOT count
 * toward the EF cash reserve. Every other wealth aggregate (net worth,
 * dashboard pills, growth cards) drops them, so counting them here would
 * show a reserve the user cannot reconcile with any other surface — and the
 * common reasons to exclude an account (not the user's money, managed for
 * someone else, double-tracked elsewhere) also disqualify it as an emergency
 * reserve. Counter-argument acknowledged: cash in an excluded account is
 * still spendable in a crisis — users who want it counted can uncheck the
 * exclusion on the account.
 */
export function totalCashReserve(accounts: Account[], snapshots: AccountSnapshot[]): number {
  const included = includedAccountIds(accounts);
  return accounts
    .filter((a) => CASH_TYPES.has(a.type) && a.id != null && included.has(a.id))
    .reduce((sum, a) => sum + Math.max(0, latestSnapshotValue(snapshots, a.id ?? -1)), 0);
}

function formatUSD(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

type BaselineSource = 'transactions' | 'household' | 'none';

function efContext(
  ctx: RoadmapContext,
): { baseline: number; cash: number; baselineSource: BaselineSource } {
  const todayISO = ctx.today.toISOString().slice(0, 10);
  const computed = computeBaselineExpenses(ctx.transactions, todayISO);
  if (computed > 0) {
    return {
      baseline: computed,
      cash: totalCashReserve(ctx.accounts, ctx.snapshots),
      baselineSource: 'transactions',
    };
  }
  const fallback = ctx.household.monthlyExpenseBaseline;
  return {
    baseline: fallback,
    cash: totalCashReserve(ctx.accounts, ctx.snapshots),
    baselineSource: fallback > 0 ? 'household' : 'none',
  };
}

function baselineSuffix(source: BaselineSource): string {
  if (source === 'transactions') return ' from 12-mo avg';
  if (source === 'household') return ' from Household';
  return '';
}

export function evaluateSmallEmergencyFund(ctx: RoadmapContext): NodeResult {
  const { baseline, cash, baselineSource } = efContext(ctx);
  if (baseline <= 0) {
    return {
      status: 'unanswered',
      evidence: 'Set your monthly expense baseline in Household first',
      cta: { label: 'Open Household →', href: '/inputs/household' },
    };
  }
  const target = Math.max(1000, baseline);
  const suffix = baselineSuffix(baselineSource);
  if (cash >= target) {
    return {
      status: 'done',
      evidence: `${formatUSD(cash)} cash ≥ ${formatUSD(target)} target${suffix}`,
    };
  }
  return {
    status: 'active',
    evidence: `${formatUSD(cash)} / ${formatUSD(target)} (${Math.round((cash / target) * 100)}%${suffix})`,
    cta: { label: 'Open Accounts →', href: '/inputs/accounts' },
  };
}

function jobStabilityAnswer(ctx: RoadmapContext): 'stable' | 'unstable' | null {
  // Use the first person's job_stability as the household-level signal.
  // If multiple persons disagree, treat the more conservative (unstable)
  // answer as the household answer.
  if (ctx.persons.length === 0) return null;
  if (ctx.persons.some((p) => p.jobStability === 'unstable')) return 'unstable';
  if (ctx.persons.some((p) => p.jobStability === 'stable')) return 'stable';
  return null;
}

export function evaluateEmergencyFund3Months(ctx: RoadmapContext): NodeResult {
  const { baseline, cash, baselineSource } = efContext(ctx);
  if (baseline <= 0) {
    return { status: 'not-started', evidence: 'Set your monthly expense baseline first' };
  }
  const stability = jobStabilityAnswer(ctx);
  if (stability === null) {
    return {
      status: 'not-started',
      evidence: 'Answer the job-stability question first to choose between 3-month and 6–12-month targets',
    };
  }
  if (stability === 'unstable') {
    // Off-branch — the 6–12 month node owns this path.
    return { status: 'skipped', evidence: 'Unstable income path uses the 6–12-month EF target instead' };
  }
  const target = 3 * baseline;
  const suffix = baselineSuffix(baselineSource);
  if (cash >= target) {
    return { status: 'done', evidence: `${formatUSD(cash)} cash ≥ ${formatUSD(target)} (3-mo target${suffix})` };
  }
  return {
    status: 'active',
    evidence: `${formatUSD(cash)} / ${formatUSD(target)} (3-mo target, ${Math.round((cash / target) * 100)}%${suffix})`,
    cta: { label: 'Open Accounts →', href: '/inputs/accounts' },
  };
}

export function evaluateEmergencyFund6To12Months(ctx: RoadmapContext): NodeResult {
  const { baseline, cash, baselineSource } = efContext(ctx);
  if (baseline <= 0) {
    return { status: 'not-started', evidence: 'Set your monthly expense baseline first' };
  }
  const stability = jobStabilityAnswer(ctx);
  if (stability === null) {
    return {
      status: 'not-started',
      evidence: 'Answer the job-stability question first to choose between 3-month and 6–12-month targets',
    };
  }
  if (stability === 'stable') {
    return { status: 'skipped', evidence: 'Stable income path uses the 3-month EF target instead' };
  }
  // For unstable income, 6 months is the floor; 12 months is the ceiling.
  // We report done at 6 months and active in between with progress %.
  const target = 6 * baseline;
  const suffix = baselineSuffix(baselineSource);
  if (cash >= target) {
    const ceiling = 12 * baseline;
    const evidence = cash >= ceiling
      ? `${formatUSD(cash)} cash ≥ ${formatUSD(ceiling)} (12-mo ceiling${suffix})`
      : `${formatUSD(cash)} cash ≥ ${formatUSD(target)} (6-mo floor${suffix})`;
    return { status: 'done', evidence };
  }
  return {
    status: 'active',
    evidence: `${formatUSD(cash)} / ${formatUSD(target)} (6-mo floor, ${Math.round((cash / target) * 100)}%${suffix})`,
    cta: { label: 'Open Accounts →', href: '/inputs/accounts' },
  };
}
