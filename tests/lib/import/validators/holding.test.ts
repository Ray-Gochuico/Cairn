import { describe, it, expect } from 'vitest';
import { validateHoldingRow, holdingTemplateCsv } from '@/lib/import/validators/holding';
import type { ValidationContext } from '@/lib/import/types';
import type { Holding } from '@/types/schema';

function ctx(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return {
    accounts: [
      { id: 10, name: 'Brokerage' },
      { id: 11, name: 'IRA' },
    ],
    persons: [],
    categories: [],
    properties: [],
    vehicles: [],
    ...overrides,
  };
}

describe('validateHoldingRow', () => {
  it('parses a minimal valid row as status=new', () => {
    const row = validateHoldingRow(
      { account_name: 'Brokerage', ticker: 'AAPL', share_count: '10' },
      0,
      ctx(),
    );
    expect(row.errors).toHaveLength(0);
    expect(row.status).toBe('new');
    expect(row.resolved.accountId).toBe(10);
    expect(row.resolved.ticker).toBe('AAPL');
    expect(row.resolved.shareCount).toBe(10);
  });

  it('errors when account_name does not match', () => {
    const row = validateHoldingRow(
      { account_name: 'Unknown', ticker: 'AAPL', share_count: '10' },
      0,
      ctx(),
    );
    expect(row.status).toBe('error');
    expect(row.errors.some((e) => e.field === 'account_name')).toBe(true);
  });

  it('errors when ticker is missing', () => {
    const row = validateHoldingRow(
      { account_name: 'Brokerage', ticker: '', share_count: '10' },
      0,
      ctx(),
    );
    expect(row.errors.some((e) => e.field === 'ticker')).toBe(true);
  });

  it('uppercases ticker', () => {
    const row = validateHoldingRow(
      { account_name: 'Brokerage', ticker: 'aapl', share_count: '10' },
      0,
      ctx(),
    );
    expect(row.resolved.ticker).toBe('AAPL');
  });

  it('errors on negative share_count', () => {
    const row = validateHoldingRow(
      { account_name: 'Brokerage', ticker: 'AAPL', share_count: '-1' },
      0,
      ctx(),
    );
    expect(row.errors.some((e) => e.field === 'share_count')).toBe(true);
  });

  it('allows share_count = 0 (tracked-but-not-held position)', () => {
    const row = validateHoldingRow(
      { account_name: 'Brokerage', ticker: 'AAPL', share_count: '0' },
      0,
      ctx(),
    );
    expect(row.errors).toHaveLength(0);
  });

  it('errors on target_allocation_pct outside 0..1', () => {
    const row = validateHoldingRow(
      { account_name: 'Brokerage', ticker: 'AAPL', share_count: '10', target_allocation_pct: '2' },
      0,
      ctx(),
    );
    expect(row.errors.some((e) => e.field === 'target_allocation_pct')).toBe(true);
  });

  it('detects (accountId, ticker) conflicts as status=update', () => {
    const existing = new Map<string, Holding>();
    existing.set('10::AAPL', { id: 99, accountId: 10, ticker: 'AAPL' } as Holding);
    const row = validateHoldingRow(
      { account_name: 'Brokerage', ticker: 'AAPL', share_count: '5' },
      0,
      ctx({ existingHoldingConflicts: existing }),
    );
    expect(row.status).toBe('update');
    expect(row.existingId).toBe(99);
  });
});

describe('holdingTemplateCsv', () => {
  it('has a header and at least one sample row', () => {
    const csv = holdingTemplateCsv();
    expect(csv).toContain('account_name');
    expect(csv).toContain('ticker');
    expect(csv.split('\n').length).toBeGreaterThanOrEqual(2);
  });
});
