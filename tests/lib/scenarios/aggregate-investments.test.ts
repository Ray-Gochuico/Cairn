import { describe, it, expect } from 'vitest';
import { totalInvestments, aggregateByTaxBucket } from '@/lib/scenarios/aggregate-investments';
import type { MonthlyState } from '@/lib/scenarios/engine';
import type { Account } from '@/types/schema';
import { AccountType } from '@/types/enums';

function makeState(investmentsByAccount: Record<number, number>): MonthlyState {
  return {
    monthISO: '2026-01',
    investmentsByAccount,
    homeEquity: 0,
    cash: 0,
    debtByLoan: {},
    netWorth: 0,
    incomeAfterTax: 0,
    expenses: 0,
    savings: 0,
    events: [],
  };
}

const acct = (id: number, type: string): Account =>
  ({ id, householdId: 1, type, name: `Acct${id}`, excludedFromNetWorth: false } as unknown as Account);

describe('totalInvestments', () => {
  it('returns 0 for an empty map', () => {
    expect(totalInvestments(makeState({}))).toBe(0);
  });

  it('sums all per-account balances', () => {
    expect(totalInvestments(makeState({ 1: 100_000, 2: 50_000, 3: 25_000 }))).toBe(175_000);
  });

  it('handles a single account', () => {
    expect(totalInvestments(makeState({ 42: 999 }))).toBe(999);
  });
});

describe('aggregateByTaxBucket', () => {
  const accounts: Account[] = [
    acct(1, AccountType.ACCOUNT_401K),        // taxAdvantaged
    acct(2, AccountType.ACCOUNT_BROKERAGE),   // taxable
    acct(3, AccountType.ACCOUNT_ROTH_IRA),    // taxAdvantaged
  ];

  it('groups balances into taxAdvantaged and taxable', () => {
    const state = makeState({ 1: 80_000, 2: 40_000, 3: 20_000 });
    const result = aggregateByTaxBucket(state, accounts);
    expect(result.taxAdvantaged).toBe(100_000); // 80k + 20k
    expect(result.taxable).toBe(40_000);
  });

  it('returns zeros when accounts have no balances in the state', () => {
    const result = aggregateByTaxBucket(makeState({}), accounts);
    expect(result.taxAdvantaged).toBe(0);
    expect(result.taxable).toBe(0);
  });

  it('ignores balances for account IDs not in the accounts list', () => {
    const state = makeState({ 1: 10_000, 99: 999_999 });
    const result = aggregateByTaxBucket(state, accounts);
    expect(result.taxAdvantaged).toBe(10_000);
    expect(result.taxable).toBe(0);
  });

  it('ignores null-bucket accounts (cash/savings) — they have no entry in investmentsByAccount anyway', () => {
    const cashAcct = acct(4, AccountType.ACCOUNT_CASH);
    const state = makeState({ 1: 10_000 });
    const result = aggregateByTaxBucket(state, [...accounts, cashAcct]);
    expect(result.taxAdvantaged).toBe(10_000);
    expect(result.taxable).toBe(0);
  });
});
