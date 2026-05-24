import type { NodeResult, RoadmapContext } from '@/types/roadmap';
import { AccountType } from '@/types/enums';
import type { Account, AccountSnapshot } from '@/types/schema';

/**
 * Emergency-fund evaluators for the three EF nodes in Section 1.
 *
 * Cash-bucket convention: we count CASH + SAVINGS + HSA balances as
 * the EF reserve. HSA is included because it functions as a backup
 * emergency fund once you accumulate qualified-expense receipts —
 * matches how the source chart treats it.
 *
 * Targets:
 *   small  → max($1,000, 1 × monthlyExpenseBaseline)
 *   3 mo   → 3  × monthlyExpenseBaseline
 *   6–12mo → 6  × monthlyExpenseBaseline (use 6 as the lower bound)
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

export function totalCashReserve(accounts: Account[], snapshots: AccountSnapshot[]): number {
  return accounts
    .filter((a) => CASH_TYPES.has(a.type))
    .reduce((sum, a) => sum + Math.max(0, latestSnapshotValue(snapshots, a.id ?? -1)), 0);
}

function formatUSD(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

function efContext(ctx: RoadmapContext): { baseline: number; cash: number } {
  return {
    baseline: ctx.household.monthlyExpenseBaseline,
    cash: totalCashReserve(ctx.accounts, ctx.snapshots),
  };
}

export function evaluateSmallEmergencyFund(ctx: RoadmapContext): NodeResult {
  const { baseline, cash } = efContext(ctx);
  if (baseline <= 0) {
    return {
      status: 'unanswered',
      evidence: 'Set your monthly expense baseline in Household first',
      cta: { label: 'Open Household →', href: '/household' },
    };
  }
  const target = Math.max(1000, baseline);
  if (cash >= target) {
    return {
      status: 'done',
      evidence: `${formatUSD(cash)} cash ≥ ${formatUSD(target)} target`,
    };
  }
  return {
    status: 'active',
    evidence: `${formatUSD(cash)} / ${formatUSD(target)} (${Math.round((cash / target) * 100)}%)`,
    cta: { label: 'Open Accounts →', href: '/accounts' },
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
  const { baseline, cash } = efContext(ctx);
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
  if (cash >= target) {
    return { status: 'done', evidence: `${formatUSD(cash)} cash ≥ ${formatUSD(target)} (3-mo) target` };
  }
  return {
    status: 'active',
    evidence: `${formatUSD(cash)} / ${formatUSD(target)} (3-mo target, ${Math.round((cash / target) * 100)}%)`,
    cta: { label: 'Open Accounts →', href: '/accounts' },
  };
}

export function evaluateEmergencyFund6To12Months(ctx: RoadmapContext): NodeResult {
  const { baseline, cash } = efContext(ctx);
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
  if (cash >= target) {
    const ceiling = 12 * baseline;
    const evidence = cash >= ceiling
      ? `${formatUSD(cash)} cash ≥ ${formatUSD(ceiling)} (12-mo ceiling)`
      : `${formatUSD(cash)} cash ≥ ${formatUSD(target)} (6-mo floor)`;
    return { status: 'done', evidence };
  }
  return {
    status: 'active',
    evidence: `${formatUSD(cash)} / ${formatUSD(target)} (6-mo floor, ${Math.round((cash / target) * 100)}%)`,
    cta: { label: 'Open Accounts →', href: '/accounts' },
  };
}
