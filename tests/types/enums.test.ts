import { describe, it, expect } from 'vitest';
import {
  FilingStatus,
  AccountType,
  LoanType,
  PropertyType,
  GoalType,
  ContributionSource,
  SnapshotSource,
  AssetClass,
  DependentType,
  JurisdictionType,
} from '@/types/enums';

describe('enums', () => {
  it('FilingStatus has all required values', () => {
    expect(FilingStatus.SINGLE).toBe('SINGLE');
    expect(FilingStatus.MFJ).toBe('MFJ');
    expect(FilingStatus.MFS).toBe('MFS');
    expect(FilingStatus.HOH).toBe('HOH');
  });

  it('AccountType has all required values', () => {
    expect(AccountType.ACCOUNT_401K).toBe('ACCOUNT_401K');
    expect(AccountType.ACCOUNT_ROTH_IRA).toBe('ACCOUNT_ROTH_IRA');
    expect(AccountType.ACCOUNT_TRAD_IRA).toBe('ACCOUNT_TRAD_IRA');
    expect(AccountType.ACCOUNT_BROKERAGE).toBe('ACCOUNT_BROKERAGE');
    expect(AccountType.ACCOUNT_HSA).toBe('ACCOUNT_HSA');
    expect(AccountType.ACCOUNT_CRYPTO).toBe('ACCOUNT_CRYPTO');
    expect(AccountType.ACCOUNT_CASH).toBe('ACCOUNT_CASH');
    expect(AccountType.ACCOUNT_SAVINGS).toBe('ACCOUNT_SAVINGS');
    expect(AccountType.ACCOUNT_529).toBe('ACCOUNT_529');
  });

  it('AssetClass includes all required values', () => {
    expect(AssetClass.US_TOTAL_MARKET).toBe('US_TOTAL_MARKET');
    expect(AssetClass.CRYPTO).toBe('CRYPTO');
    expect(AssetClass.CASH).toBe('CASH');
  });

  it('DependentType has CHILD and OTHER', () => {
    expect(DependentType.CHILD).toBe('CHILD');
    expect(DependentType.OTHER).toBe('OTHER');
  });
});
