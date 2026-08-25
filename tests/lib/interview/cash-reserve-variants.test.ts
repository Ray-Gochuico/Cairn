import { describe, it, expect } from 'vitest';
import { cashSavingsReserve, computeEfOverlap } from '@/lib/interview/cash-reserve-variants';
import { AccountType } from '@/types/enums';
import { makeAccount, makeHousehold, makePerson } from '../../factories';
import { fixtureCtx, snap } from './fixture';

describe('cashSavingsReserve — HSA must NOT count toward a down payment', () => {
  it('fixture reserve = savings 22,000 + cash 8,000 = 30,000', () => {
    const ctx = fixtureCtx();
    expect(cashSavingsReserve(ctx.accounts, ctx.snapshots)).toBe(30000);
  });

  it('an HSA with a snapshot is EXCLUDED (the EF set would count it — the variant must not)', () => {
    const base = fixtureCtx();
    const ctx = fixtureCtx({
      accounts: [...base.accounts, makeAccount({ id: 3, type: AccountType.ACCOUNT_HSA, name: 'HSA' })],
      snapshots: [...base.snapshots, snap(3, 5000)],
    });
    expect(cashSavingsReserve(ctx.accounts, ctx.snapshots)).toBe(30000);
  });

  it('excludedFromNetWorth accounts are dropped (the account-inclusion contract)', () => {
    const ctx = fixtureCtx({
      accounts: [
        makeAccount({ id: 1, type: AccountType.ACCOUNT_SAVINGS, name: 'Savings', excludedFromNetWorth: true }),
        makeAccount({ id: 2, type: AccountType.ACCOUNT_CASH, name: 'Checking' }),
      ],
    });
    expect(cashSavingsReserve(ctx.accounts, ctx.snapshots)).toBe(8000);
  });

  it('negative snapshot values clamp to 0 per account (the totalCashReserve clamp inherited)', () => {
    const ctx = fixtureCtx({ snapshots: [snap(1, -500), snap(2, 8000)] });
    expect(cashSavingsReserve(ctx.accounts, ctx.snapshots)).toBe(8000);
  });

  it('no eligible accounts → 0 (an honest $0, stated with its basis in CI-H4)', () => {
    expect(cashSavingsReserve([], [])).toBe(0);
  });
});

describe('computeEfOverlap — overlap = min(cashSavingsReserve, moderate EF target)', () => {
  it('unanswered jobStability → 6× ASSUMED: min(30,000, 6×6,000=36,000) = 30,000', () => {
    expect(computeEfOverlap(fixtureCtx(), 30000)).toEqual({
      overlapDollars: 30000, efTargetDollars: 36000, multiple: 6, assumed: true, baselineSource: 'household',
    });
  });

  it('every person stable → 3×: min(30,000, 18,000) = 18,000, not assumed', () => {
    const ctx = fixtureCtx({ persons: [makePerson({ id: 1, jobStability: 'stable' })] });
    expect(computeEfOverlap(ctx, 30000)).toEqual({
      overlapDollars: 18000, efTargetDollars: 18000, multiple: 3, assumed: false, baselineSource: 'household',
    });
  });

  it("no baseline → target 0, overlap 0, source 'none' (the reply renders CI-H5b)", () => {
    const ctx = fixtureCtx({ household: makeHousehold({ monthlyExpenseBaseline: 0 }) });
    const o = computeEfOverlap(ctx, 30000);
    expect(o.baselineSource).toBe('none');
    expect(o.overlapDollars).toBe(0);
    expect(o.efTargetDollars).toBe(0);
  });
});
