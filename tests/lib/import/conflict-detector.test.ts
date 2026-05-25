import { describe, it, expect } from 'vitest';
import {
  buildSnapshotConflictMap,
  buildTransactionDuplicateKeys,
} from '@/lib/import/conflict-detector';

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
