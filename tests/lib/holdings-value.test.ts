import { describe, it, expect } from 'vitest';
import { valueHoldings } from '@/lib/holdings-value';
import { AccountType, AssetClass } from '@/types/enums';
import type { Account, Holding } from '@/types/schema';

function mkAccount(id: number, name: string, overrides: Partial<Account> = {}): Account {
  return {
    id,
    householdId: 1,
    ownerPersonId: null,
    beneficiaryDependentId: null,
    name,
    institution: null,
    type: AccountType.ACCOUNT_BROKERAGE,
    cryptoWalletAddress: null,
    autoFetchEnabled: false,
    excludedFromNetWorth: false,
    stateOfPlan: null,
      accentColor: null,
    ...overrides,
  };
}

function mkHolding(
  accountId: number,
  ticker: string,
  shareCount: number,
  overrides: Partial<Holding> = {},
): Holding {
  return {
    id: undefined,
    accountId,
    ticker,
    shareCount,
    targetAllocationPct: null,
    costBasis: null,
    ...overrides,
  };
}

describe('valueHoldings', () => {
  it('returns an empty array when there are no holdings', () => {
    const accounts = [mkAccount(1, 'Brokerage')];
    const result = valueHoldings(accounts, [], new Map([[1, 100_000]]), new Map());
    expect(result).toEqual([]);
  });

  it('assigns the full snapshot.totalValue to a single holding in an account', () => {
    const accounts = [mkAccount(1, 'Brokerage')];
    const holdings = [mkHolding(1, 'VTI', 10)];
    const latestPerAccount = new Map([[1, 50_000]]);
    const assetClassByTicker = new Map<string, AssetClass>([['VTI', AssetClass.US_TOTAL_MARKET]]);

    const result = valueHoldings(accounts, holdings, latestPerAccount, assetClassByTicker);

    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(50_000);
    expect(result[0].assetClass).toBe(AssetClass.US_TOTAL_MARKET);
    expect(result[0].accountName).toBe('Brokerage');
    expect(result[0].holding.ticker).toBe('VTI');
  });

  it('splits an account snapshot proportionally across holdings by share count', () => {
    const accounts = [mkAccount(1, 'Brokerage')];
    // 30 shares VTI + 70 shares BND = 100 shares; $100k splits 30/70.
    const holdings = [
      mkHolding(1, 'VTI', 30),
      mkHolding(1, 'BND', 70),
    ];
    const latestPerAccount = new Map([[1, 100_000]]);
    const assetClassByTicker = new Map<string, AssetClass>([
      ['VTI', AssetClass.US_TOTAL_MARKET],
      ['BND', AssetClass.US_BONDS],
    ]);

    const result = valueHoldings(accounts, holdings, latestPerAccount, assetClassByTicker);

    expect(result).toHaveLength(2);
    const vti = result.find((r) => r.holding.ticker === 'VTI')!;
    const bnd = result.find((r) => r.holding.ticker === 'BND')!;
    expect(vti.value).toBeCloseTo(30_000, 6);
    expect(bnd.value).toBeCloseTo(70_000, 6);
    // Sum of values matches the snapshot.
    expect(vti.value + bnd.value).toBeCloseTo(100_000, 6);
  });

  it('falls back to AssetClass.OTHER when ticker is not in the asset-class map', () => {
    const accounts = [mkAccount(1, 'Brokerage')];
    const holdings = [mkHolding(1, 'MEME', 5)];
    const latestPerAccount = new Map([[1, 5_000]]);
    const assetClassByTicker = new Map<string, AssetClass>();

    const result = valueHoldings(accounts, holdings, latestPerAccount, assetClassByTicker);

    expect(result).toHaveLength(1);
    expect(result[0].assetClass).toBe(AssetClass.OTHER);
  });

  it('assigns zero value when account has no snapshot', () => {
    const accounts = [mkAccount(1, 'Brokerage')];
    const holdings = [mkHolding(1, 'VTI', 10)];
    // Empty latestPerAccount → snapshot value defaults to 0.
    const result = valueHoldings(accounts, holdings, new Map(), new Map());

    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(0);
  });

  it('assigns zero value when totalShares is zero (defensive divide-by-zero guard)', () => {
    const accounts = [mkAccount(1, 'Brokerage')];
    // A holding with shareCount = 0 — share-weighted split would divide by zero.
    const holdings = [mkHolding(1, 'VTI', 0)];
    const latestPerAccount = new Map([[1, 50_000]]);

    const result = valueHoldings(accounts, holdings, latestPerAccount, new Map());
    expect(result).toHaveLength(1);
    expect(result[0].value).toBe(0);
  });

  it('falls back to "Account #<id>" when account name is missing', () => {
    // Empty accounts array → no name resolution; the holding still gets a row.
    const result = valueHoldings(
      [],
      [mkHolding(42, 'VTI', 10)],
      new Map([[42, 10_000]]),
      new Map(),
    );
    expect(result[0].accountName).toBe('Account #42');
  });
});
