import { AccountType } from '@/types/enums';
import { includedAccountIds } from '@/lib/account-inclusion';
import { efContext, latestSnapshotValue, type BaselineSource } from '@/domain/roadmap/rules/emergencyFund';
import { moderateEfMultiple } from '@/domain/interview/frameworks';
import type { Account, AccountSnapshot } from '@/types/schema';
import type { InterviewContext } from '@/types/interview';

/**
 * Down-payment reserve (Appendix A, wave T2): CASH + SAVINGS only. This is
 * deliberately NOT the emergency-fund reserve set (emergencyFund.ts
 * CASH_TYPES), which includes HSA — HSA dollars are medically earmarked and
 * must not count toward a down payment. Same inclusion/clamp mechanics as
 * totalCashReserve: excludedFromNetWorth accounts dropped, latest snapshot
 * per account, negatives clamped to 0. Pure.
 */
const CASH_SAVINGS_TYPES = new Set<AccountType>([
  AccountType.ACCOUNT_CASH,
  AccountType.ACCOUNT_SAVINGS,
]);

export function cashSavingsReserve(accounts: Account[], snapshots: AccountSnapshot[]): number {
  const included = includedAccountIds(accounts);
  return accounts
    .filter((a) => CASH_SAVINGS_TYPES.has(a.type) && a.id != null && included.has(a.id))
    .reduce((sum, a) => sum + Math.max(0, latestSnapshotValue(snapshots, a.id ?? -1)), 0);
}

export interface EfOverlap {
  /** min(reserve, efTarget) — the dollars serving two jobs (CI-H5). */
  overlapDollars: number;
  efTargetDollars: number;
  multiple: 3 | 6;
  /** True when 6× came from an unanswered jobStability (D-GI5 semantics). */
  assumed: boolean;
  baselineSource: BaselineSource;
}

/**
 * The MANDATORY double-count input (Appendix A): how much of the counted
 * cash+savings reserve is also the Moderate framework's emergency reserve.
 * Baseline + multiple come from the SAME engines the bar uses (efContext,
 * moderateEfMultiple) — never re-derived. Pure over ctx.
 */
export function computeEfOverlap(ctx: InterviewContext, reserveDollars: number): EfOverlap {
  const { baseline, baselineSource } = efContext(ctx);
  const ef = moderateEfMultiple(ctx.persons);
  const efTargetDollars = baselineSource === 'none' ? 0 : ef.multiple * baseline;
  return {
    overlapDollars: Math.min(reserveDollars, efTargetDollars),
    efTargetDollars,
    multiple: ef.multiple,
    assumed: ef.assumed,
    baselineSource,
  };
}
