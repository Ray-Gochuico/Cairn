import { isRetirementAccount } from '@/domain/roadmap/rules/section1';
import { ContributionSource } from '@/types/enums';
import type { InterviewContext } from '@/types/interview';
import { toCents } from './gaps';

export interface MatchAccountValue {
  accountId: number;
  accountName: string;
  ownerName: string;
  /** salary × limitPct — the EMPLOYEE contribution that unlocks the full match. */
  targetDollars: number;
  ytdDollars: number;
  remainingDollars: number;
  runRateCentsPerMonth: number;
  /** min(matchPct ?? limitPct, limitPct) × salary — D-GI17. */
  annualMatchValueDollars: number;
}

export interface MatchSummary {
  state: 'active' | 'unknown' | 'none';
  accounts: MatchAccountValue[];
  excluded: { accountName: string; reason: string }[];
  runRateCentsPerMonth: number;
  annualMatchValueDollars: number;
}

/** Months left in the calendar year INCLUDING the current month (Aug → 5). */
export function monthsRemainingInCalendarYear(today: Date): number {
  return 12 - today.getMonth();
}

/**
 * The design's confirmed engine gap: employerMatchPct is stored but never
 * multiplied anywhere today. Target/YTD math clones evaluateEmployerMatch
 * (section1.ts:202-207: calendar-year PAYCHECK|MANUAL rows per account);
 * missing salary/limit EXCLUDES that account with a CI-15 reason instead
 * of failing the whole bucket (per-account honesty — deliberately more
 * granular than the roadmap node, which goes 'unanswered' wholesale).
 */
export function computeMatchSummary(ctx: InterviewContext): MatchSummary {
  const matched = ctx.accounts.filter((a) => a.hasEmployerMatch === true);
  if (matched.length === 0) {
    const anyUnanswered = ctx.accounts.some(
      (a) => isRetirementAccount(a.type) && a.hasEmployerMatch === null,
    );
    return {
      state: anyUnanswered ? 'unknown' : 'none',
      accounts: [], excluded: [], runRateCentsPerMonth: 0, annualMatchValueDollars: 0,
    };
  }
  const year = ctx.today.getFullYear();
  const yearPrefix = `${year}-`;
  const monthsLeft = monthsRemainingInCalendarYear(ctx.today);
  const accounts: MatchAccountValue[] = [];
  const excluded: { accountName: string; reason: string }[] = [];
  for (const acct of matched) {
    if (acct.id == null) continue;
    const owner = ctx.persons.find((p) => p.id === acct.ownerPersonId);
    const salary = owner?.annualSalaryPretax ?? 0;
    const limitPct = acct.employerMatchLimitPct ?? 0;
    if (salary <= 0 || limitPct <= 0) {
      excluded.push({
        accountName: acct.name,
        reason: `${acct.name} skipped — set ${owner?.name ?? 'the owner'}'s salary and the plan's match limit to include it.`,
      });
      continue;
    }
    const targetDollars = salary * limitPct;
    const ytdDollars = ctx.contributions
      .filter((c) => c.accountId === acct.id)
      .filter((c) => c.date.startsWith(yearPrefix))
      .filter((c) => c.source === ContributionSource.PAYCHECK || c.source === ContributionSource.MANUAL)
      .reduce((s, c) => s + c.amount, 0);
    const remainingDollars = Math.max(0, targetDollars - ytdDollars);
    const matchPct = acct.employerMatchPct ?? limitPct;
    accounts.push({
      accountId: acct.id,
      accountName: acct.name,
      ownerName: owner?.name ?? '',
      targetDollars,
      ytdDollars,
      remainingDollars,
      runRateCentsPerMonth: Math.round(toCents(remainingDollars) / monthsLeft),
      annualMatchValueDollars: Math.min(matchPct, limitPct) * salary,
    });
  }
  return {
    state: 'active',
    accounts,
    excluded,
    runRateCentsPerMonth: accounts.reduce((s, a) => s + a.runRateCentsPerMonth, 0),
    annualMatchValueDollars: accounts.reduce((s, a) => s + a.annualMatchValueDollars, 0),
  };
}
