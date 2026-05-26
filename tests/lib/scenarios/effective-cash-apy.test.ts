import { describe, it, expect } from 'vitest';
import { effectiveCashApy } from '@/lib/scenarios/effective-cash-apy';
import type { Account, AppSettings } from '@/types/schema';
import { AccountType, RefreshCadence, FiPillsPosition, ProjectionDetailLevel } from '@/types/enums';
import { emptyLeverPayload } from '@/lib/scenarios/lever-types';
import type { Scenario } from '@/types/scenario';

function makeAccount(id: number, apyRate: number | null, type = AccountType.ACCOUNT_SAVINGS): Account {
  return {
    id,
    householdId: 1,
    ownerPersonId: null,
    beneficiaryDependentId: null,
    name: `Account ${id}`,
    institution: null,
    type,
    cryptoWalletAddress: null,
    autoFetchEnabled: false,
    excludedFromNetWorth: false,
    allowMargin: false,
    stateOfPlan: null,
    accentColor: null,
    hasEmployerMatch: null,
    employerMatchPct: null,
    employerMatchLimitPct: null,
    allowsMegaBackdoorRollover: null,
    hasHighFees: null,
    apyRate,
  } as Account;
}

function makeSettings(defaultCashApy: number | null): AppSettings {
  return {
    id: 1,
    sidebarLayout: null,
    notificationsEnabled: true,
    notificationDay: 1,
    refreshCadence: RefreshCadence.EVERY_LAUNCH,
    lastRefreshAt: null,
    statementsFolderPath: null,
    defaultInflation: null,
    defaultReturnRate: null,
    defaultFiPillsPosition: FiPillsPosition.ABOVE,
    defaultProjectionDetailLevel: ProjectionDetailLevel.TAX_BUCKET,
    defaultCashApy,
  } as AppSettings;
}

function makeScenario(cashRate: number | null): Scenario {
  const payload = emptyLeverPayload();
  payload.returns = { ...payload.returns, cashRate };
  return { id: 1, name: 'Test', isBaseline: false, color: '#000', lineStyle: 'solid', visible: true, isActive: true, sortOrder: 0, leverPayload: payload, createdAt: 't', updatedAt: 't' } as unknown as Scenario;
}

describe('effectiveCashApy', () => {
  it('returns scenario.returns.cashRate when set (override wins)', () => {
    const cashAccountsWithBalances = [
      { account: makeAccount(1, 0.02), balance: 10_000 },
    ];
    const result = effectiveCashApy(makeScenario(0.06), cashAccountsWithBalances, makeSettings(0.03));
    expect(result).toBeCloseTo(0.06, 6);
  });

  it('scenario cashRate: 0 still wins (explicit zero override)', () => {
    const cashAccountsWithBalances = [{ account: makeAccount(1, 0.05), balance: 10_000 }];
    const result = effectiveCashApy(makeScenario(0), cashAccountsWithBalances, makeSettings(0.04));
    expect(result).toBe(0);
  });

  it('returns balance-weighted average when no scenario override', () => {
    // Account A: $10k @ 4%; Account B: $10k @ 6% → weighted avg = 5%
    const cashAccountsWithBalances = [
      { account: makeAccount(1, 0.04), balance: 10_000 },
      { account: makeAccount(2, 0.06), balance: 10_000 },
    ];
    const result = effectiveCashApy(null, cashAccountsWithBalances, makeSettings(null));
    expect(result).toBeCloseTo(0.05, 6);
  });

  it('accounts with null apyRate fall through to settings.defaultCashApy', () => {
    // Account A: $20k @ null (→ 3% from settings); Account B: $10k @ 6%
    // Weighted: (20k * 0.03 + 10k * 0.06) / 30k = (600 + 600) / 30k = 0.04
    const cashAccountsWithBalances = [
      { account: makeAccount(1, null), balance: 20_000 },
      { account: makeAccount(2, 0.06), balance: 10_000 },
    ];
    const result = effectiveCashApy(null, cashAccountsWithBalances, makeSettings(0.03));
    expect(result).toBeCloseTo(0.04, 6);
  });

  it('null apyRate + null settings.defaultCashApy → treated as 0% for that account', () => {
    // Account A: $10k @ null; Account B: $10k @ 4%
    // settings also null → Account A contributes 0 APY
    // Weighted: (10k * 0 + 10k * 0.04) / 20k = 0.02
    const cashAccountsWithBalances = [
      { account: makeAccount(1, null), balance: 10_000 },
      { account: makeAccount(2, 0.04), balance: 10_000 },
    ];
    const result = effectiveCashApy(null, cashAccountsWithBalances, null);
    expect(result).toBeCloseTo(0.02, 6);
  });

  it('returns 0 when there are no cash accounts', () => {
    expect(effectiveCashApy(null, [], makeSettings(0.04))).toBe(0);
  });

  it('returns 0 when all cash account balances are zero', () => {
    const cashAccountsWithBalances = [
      { account: makeAccount(1, 0.04), balance: 0 },
    ];
    expect(effectiveCashApy(null, cashAccountsWithBalances, makeSettings(0.04))).toBe(0);
  });

  it('returns 0 when scenario is null and no accounts and no settings', () => {
    expect(effectiveCashApy(null, [], null)).toBe(0);
  });

  it('scenario cashRate null with no accounts falls through to 0', () => {
    expect(effectiveCashApy(makeScenario(null), [], makeSettings(0.05))).toBe(0);
  });
});
