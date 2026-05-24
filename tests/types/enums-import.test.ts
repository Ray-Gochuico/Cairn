import { describe, it, expect } from 'vitest';
import { SnapshotSource, TransactionSource, ContributionSource } from '@/types/enums';

describe('source enums — CSV import additions', () => {
  it('SnapshotSource includes CSV_IMPORT', () => {
    expect(SnapshotSource.CSV_IMPORT).toBe('CSV_IMPORT');
  });

  it('TransactionSource includes CSV_IMPORT', () => {
    expect(TransactionSource.CSV_IMPORT).toBe('CSV_IMPORT');
  });

  it('ContributionSource includes ANNUAL_TOTAL', () => {
    expect(ContributionSource.ANNUAL_TOTAL).toBe('ANNUAL_TOTAL');
  });
});
