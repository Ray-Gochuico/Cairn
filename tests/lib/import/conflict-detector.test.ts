import { describe, it, expect } from 'vitest';
import {
  buildSnapshotConflictMap,
  buildTransactionDuplicateKeys,
  buildAccountConflictMap,
  buildHoldingConflictMap,
  buildLoanConflictMap,
  buildPropertyConflictMap,
  buildVehicleConflictMap,
  buildEquityGrantConflictMap,
  buildContributionDuplicateKeys,
  buildAssetValueSnapshotConflictMap,
} from '@/lib/import/conflict-detector';
import type {
  Account,
  Holding,
  Loan,
  Property,
  Vehicle,
  EquityGrant,
  Contribution,
  AssetValueSnapshot,
} from '@/types/schema';

describe('buildSnapshotConflictMap', () => {
  it('keys by accountId|snapshotDate → totalValue', () => {
    const map = buildSnapshotConflictMap([
      { accountId: 1, snapshotDate: '2022-03-31', totalValue: 50000 },
      { accountId: 2, snapshotDate: '2022-03-31', totalValue: 87250 },
      { accountId: 1, snapshotDate: '2022-04-30', totalValue: 51000 },
    ]);
    expect(map.get('1|2022-03-31')).toBe(50000);
    expect(map.get('2|2022-03-31')).toBe(87250);
    expect(map.get('1|2022-04-30')).toBe(51000);
    expect(map.size).toBe(3);
  });

  it('returns an empty map for no snapshots', () => {
    expect(buildSnapshotConflictMap([]).size).toBe(0);
  });
});

describe('buildTransactionDuplicateKeys', () => {
  it('keys by accountId|date|amount|lowercased+trimmed merchant', () => {
    const set = buildTransactionDuplicateKeys([
      { accountId: 1, date: '2024-01-15', amount: -42.5, merchant: '  Whole Foods  ' },
      { accountId: 2, date: '2024-01-16', amount: -100, merchant: 'AMAZON' },
    ]);
    expect(set.has('1|2024-01-15|-42.5|whole foods')).toBe(true);
    expect(set.has('2|2024-01-16|-100|amazon')).toBe(true);
    expect(set.size).toBe(2);
  });

  it('returns an empty set for no transactions', () => {
    expect(buildTransactionDuplicateKeys([]).size).toBe(0);
  });
});

describe('buildAccountConflictMap', () => {
  it('keys by lower-cased name', () => {
    const map = buildAccountConflictMap([
      { id: 1, name: 'Chase Checking' } as Account,
      { id: 2, name: 'Vanguard Brokerage' } as Account,
    ]);
    expect(map.get('chase checking')?.id).toBe(1);
    expect(map.get('vanguard brokerage')?.id).toBe(2);
  });

  it('uses case-folded keys', () => {
    const map = buildAccountConflictMap([
      { id: 1, name: 'Chase Checking' } as Account,
    ]);
    // Key is lower-cased; original casing not present
    expect(map.get('CHASE CHECKING')).toBeUndefined();
    expect(map.get('chase checking')?.id).toBe(1);
  });

  it('returns empty map for empty input', () => {
    expect(buildAccountConflictMap([]).size).toBe(0);
  });
});

describe('buildHoldingConflictMap', () => {
  it('keys by `${accountId}::${ticker}`', () => {
    const map = buildHoldingConflictMap([
      { id: 1, accountId: 10, ticker: 'AAPL' } as Holding,
      { id: 2, accountId: 11, ticker: 'AAPL' } as Holding,
    ]);
    expect(map.get('10::AAPL')?.id).toBe(1);
    expect(map.get('11::AAPL')?.id).toBe(2);
  });

  it('returns empty map for empty input', () => {
    expect(buildHoldingConflictMap([]).size).toBe(0);
  });
});

describe('buildLoanConflictMap', () => {
  it('keys by lower-cased name', () => {
    const map = buildLoanConflictMap([{ id: 5, name: 'Mortgage' } as Loan]);
    expect(map.get('mortgage')?.id).toBe(5);
  });

  it('returns empty map for empty input', () => {
    expect(buildLoanConflictMap([]).size).toBe(0);
  });
});

describe('buildPropertyConflictMap', () => {
  it('keys by lower-cased name', () => {
    const map = buildPropertyConflictMap([
      { id: 7, name: 'Main Residence' } as Property,
    ]);
    expect(map.get('main residence')?.id).toBe(7);
  });

  it('returns empty map for empty input', () => {
    expect(buildPropertyConflictMap([]).size).toBe(0);
  });
});

describe('buildVehicleConflictMap', () => {
  it('keys by lower-cased name', () => {
    const map = buildVehicleConflictMap([
      { id: 9, name: 'My Car' } as Vehicle,
    ]);
    expect(map.get('my car')?.id).toBe(9);
  });

  it('returns empty map for empty input', () => {
    expect(buildVehicleConflictMap([]).size).toBe(0);
  });
});

describe('buildEquityGrantConflictMap', () => {
  it('keys by lower-cased name', () => {
    const map = buildEquityGrantConflictMap([
      { id: 3, name: 'Series A RSUs' } as EquityGrant,
    ]);
    expect(map.get('series a rsus')?.id).toBe(3);
  });

  it('returns empty map for empty input', () => {
    expect(buildEquityGrantConflictMap([]).size).toBe(0);
  });
});

describe('buildContributionDuplicateKeys', () => {
  it('keys as `${accountId}::${date}::${amount}`', () => {
    const set = buildContributionDuplicateKeys([
      { accountId: 1, date: '2026-01-15', amount: 500 } as Contribution,
      { accountId: 1, date: '2026-02-15', amount: 500 } as Contribution,
    ]);
    expect(set.has('1::2026-01-15::500')).toBe(true);
    expect(set.has('1::2026-02-15::500')).toBe(true);
    expect(set.has('1::2026-03-15::500')).toBe(false);
  });

  it('returns empty set for empty input', () => {
    expect(buildContributionDuplicateKeys([]).size).toBe(0);
  });
});

describe('buildAssetValueSnapshotConflictMap', () => {
  it('keys as `${ownerType}::${ownerId}::${snapshotDate}`', () => {
    const map = buildAssetValueSnapshotConflictMap([
      { id: 1, ownerType: 'PROPERTY', ownerId: 5, snapshotDate: '2026-04-30' } as AssetValueSnapshot,
      { id: 2, ownerType: 'VEHICLE', ownerId: 5, snapshotDate: '2026-04-30' } as AssetValueSnapshot,
    ]);
    expect(map.get('PROPERTY::5::2026-04-30')?.id).toBe(1);
    expect(map.get('VEHICLE::5::2026-04-30')?.id).toBe(2);
  });

  it('returns empty map for empty input', () => {
    expect(buildAssetValueSnapshotConflictMap([]).size).toBe(0);
  });
});
