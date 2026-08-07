import { describe, it, expect } from 'vitest';
import { computeMatchSummary, monthsRemainingInCalendarYear } from '@/lib/interview/match-value';
import { AccountType, ContributionSource } from '@/types/enums';
import { makeAccount, makePerson } from '../../factories';
import { fixtureCtx } from './fixture';

const matched401k = makeAccount({
  id: 10, type: AccountType.ACCOUNT_401K, name: '401(k)', ownerPersonId: 1,
  hasEmployerMatch: true, employerMatchPct: 0.03, employerMatchLimitPct: 0.06,
});

describe('monthsRemainingInCalendarYear', () => {
  it('counts the current month through December', () => {
    expect(monthsRemainingInCalendarYear(new Date('2026-08-01T12:00:00Z'))).toBe(5); // Aug..Dec
    expect(monthsRemainingInCalendarYear(new Date('2026-01-15T12:00:00Z'))).toBe(12);
    expect(monthsRemainingInCalendarYear(new Date('2026-12-31T12:00:00Z'))).toBe(1);
  });
});

describe('computeMatchSummary', () => {
  it('active: run-rate = remaining employee target / months left; value = min(matchPct, limitPct) × salary', () => {
    const ctx = fixtureCtx({
      persons: [makePerson({ id: 1, annualSalaryPretax: 100000, jobStability: null })],
      accounts: [matched401k],
      contributions: [
        { accountId: 10, date: '2026-03-15', amount: 2000, source: ContributionSource.PAYCHECK },
        { accountId: 10, date: '2025-12-15', amount: 9999, source: ContributionSource.PAYCHECK }, // prior year — excluded
        // Non-PAYCHECK/MANUAL — excluded (EMPLOYER_MATCH is a real non-counting
        // ContributionSource member, mirroring section1.ts's PAYCHECK|MANUAL filter).
        { accountId: 10, date: '2026-04-01', amount: 500, source: ContributionSource.EMPLOYER_MATCH },
      ] as never,
    });
    const m = computeMatchSummary(ctx);
    expect(m.state).toBe('active');
    // target = 100,000 × 0.06 = $6,000; YTD = $2,000; remaining = $4,000;
    // Aug → 5 months left → $800/mo = 80,000¢.
    expect(m.runRateCentsPerMonth).toBe(80000);
    // value = min(0.03, 0.06) × 100,000 = $3,000 (D-GI17).
    expect(m.annualMatchValueDollars).toBe(3000);
    expect(m.accounts).toHaveLength(1);
  });

  it('unknown: any retirement account with a null flag and none matched', () => {
    const ctx = fixtureCtx({
      accounts: [makeAccount({ id: 11, type: AccountType.ACCOUNT_ROTH_IRA, hasEmployerMatch: null })],
    });
    expect(computeMatchSummary(ctx).state).toBe('unknown');
  });

  it('none: no retirement accounts at all (the waterfall fixture)', () => {
    expect(computeMatchSummary(fixtureCtx()).state).toBe('none');
  });

  it('CI-15: a matched account missing salary/limit is EXCLUDED with a named reason, not fatal', () => {
    const ctx = fixtureCtx({
      persons: [makePerson({ id: 1, name: 'Sam', annualSalaryPretax: 0 })],
      accounts: [matched401k],
    });
    const m = computeMatchSummary(ctx);
    expect(m.runRateCentsPerMonth).toBe(0);
    expect(m.excluded).toEqual([
      { accountName: '401(k)', reason: "401(k) skipped — set Sam's salary and the plan's match limit to include it." },
    ]);
  });
});
