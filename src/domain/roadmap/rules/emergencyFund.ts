import type { NodeResult, RoadmapContext } from '@/types/roadmap';
import { AccountType } from '@/types/enums';
import type { Account, AccountSnapshot } from '@/types/schema';
import { rolling12mBaselineDetail } from '@/lib/expense-baseline';
import { includedAccountIds } from '@/lib/account-inclusion';
import { localTodayISO } from '@/lib/dates';

/**
 * Emergency-fund evaluators for the three EF nodes in Section 1.
 *
 * Cash-bucket convention: we count CASH + SAVINGS + HSA balances as
 * the EF reserve. HSA is included because it functions as a backup
 * emergency fund once you accumulate qualified-expense receipts —
 * matches how the source chart treats it.
 *
 * Baseline expense source: the rule prefers the average of the COMPLETE
 * calendar months of real spending (rolling12mBaselineDetail — the
 * in-progress month never counts; transfers, income rows and pending
 * reimbursables excluded; reimbursed charges at net) once at least
 * MIN_COMPLETE_MONTHS complete months carry real spending. Otherwise the
 * household's entered `monthlyExpenseBaseline`. The active source AND the
 * number of months behind the figure are stated in the evidence string.
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

export function latestSnapshotValue(snapshots: AccountSnapshot[], accountId: number): number {
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

/** ⚑ R1-F2: complete months with real spending required before transactions
 *  outrank the household's entered baseline. CR-R1-9 (the wizard's hand-off
 *  sentence) is written for 1 — change both together. */
export const MIN_COMPLETE_MONTHS = 1;

export type BaselineSource = 'transactions' | 'household' | 'none';

export interface EfContext {
  baseline: number;
  cash: number;
  baselineSource: BaselineSource;
  /** Complete months behind `baseline` when the source is transactions; 0 otherwise. */
  monthsObserved: number;
}

export function efContext(ctx: RoadmapContext): EfContext {
  // W4 review (MINOR 6): LOCAL day, not UTC. `ctx.today` is a local-midnight
  // Date (context.ts: dateFromLocalISO(useLocalToday())), so east of UTC
  // toISOString() reports the PREVIOUS day — and on the 1st of a month that
  // rolled the as-of month back, dropping the month that JUST COMPLETED out
  // of the window below and sending the household to its Household fallback.
  // localTodayISO is the exact inverse of dateFromLocalISO (the house rule
  // since the T2 UTC lesson).
  const todayISO = localTodayISO(ctx.today);
  // Wave 2 §8 + R1: real-spending baseline over COMPLETE calendar months —
  // same isRealSpending/effectiveSpendingAmount pipeline as the Spending page
  // and the What-If expense basis, so transfers (CC payments) and pending
  // reimbursables can't inflate the EF target. Distinct-months divisor (a
  // 3-month history averages over 3, not 12) and the count comes back with it.
  const detail = rolling12mBaselineDetail(ctx.transactions, ctx.categories ?? [], todayISO);
  const cash = totalCashReserve(ctx.accounts, ctx.snapshots);
  if (detail.monthsObserved >= MIN_COMPLETE_MONTHS && detail.average > 0) {
    return { baseline: detail.average, cash, baselineSource: 'transactions', monthsObserved: detail.monthsObserved };
  }
  const fallback = ctx.household.monthlyExpenseBaseline;
  return { baseline: fallback, cash, baselineSource: fallback > 0 ? 'household' : 'none', monthsObserved: 0 };
}

/** CR-R1-1 / CR-R1-2: the basis with its count. */
export function baselineSuffix(source: BaselineSource, monthsObserved: number): string {
  if (source === 'transactions') {
    return ` from ${monthsObserved} ${monthsObserved === 1 ? 'month' : 'months'} of spending`;
  }
  if (source === 'household') return ' from Household';
  return '';
}

export function evaluateSmallEmergencyFund(ctx: RoadmapContext): NodeResult {
  const { baseline, cash, baselineSource, monthsObserved } = efContext(ctx);
  if (baseline <= 0) {
    return {
      status: 'unanswered',
      evidence: 'Set your monthly expense baseline in Household first',
      cta: { label: 'Open Household →', href: '/inputs/household' },
    };
  }
  const target = Math.max(1000, baseline);
  const suffix = baselineSuffix(baselineSource, monthsObserved);
  if (cash >= target) {
    return {
      status: 'done',
      evidence: `${formatUSD(cash)} cash ≥ ${formatUSD(target)} target${suffix}`,
    };
  }
  return {
    status: 'active',
    evidence: `${formatUSD(cash)} / ${formatUSD(target)} (${Math.round((cash / target) * 100)}%${suffix})`,
    cta: { label: 'Open Accounts →', href: '/investments?manage=accounts' },
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
  const { baseline, cash, baselineSource, monthsObserved } = efContext(ctx);
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
  const suffix = baselineSuffix(baselineSource, monthsObserved);
  if (cash >= target) {
    return { status: 'done', evidence: `${formatUSD(cash)} cash ≥ ${formatUSD(target)} (3-mo target${suffix})` };
  }
  return {
    status: 'active',
    evidence: `${formatUSD(cash)} / ${formatUSD(target)} (3-mo target, ${Math.round((cash / target) * 100)}%${suffix})`,
    cta: { label: 'Open Accounts →', href: '/investments?manage=accounts' },
  };
}

export function evaluateEmergencyFund6To12Months(ctx: RoadmapContext): NodeResult {
  const { baseline, cash, baselineSource, monthsObserved } = efContext(ctx);
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
  const suffix = baselineSuffix(baselineSource, monthsObserved);
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
    cta: { label: 'Open Accounts →', href: '/investments?manage=accounts' },
  };
}
