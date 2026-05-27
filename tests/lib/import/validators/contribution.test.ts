import { describe, it, expect } from 'vitest';
import { validateContributionRow, contributionTemplateCsv } from '@/lib/import/validators/contribution';
import type { ValidationContext } from '@/lib/import/types';
import { ContributionSource } from '@/types/enums';

function ctx(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return {
    accounts: [{ id: 10, name: 'Brokerage' }],
    persons: [{ id: 1, name: 'Alice' }],
    categories: [],
    properties: [],
    vehicles: [],
    ...overrides,
  };
}

describe('validateContributionRow', () => {
  it('parses a minimal valid row as status=new', () => {
    const row = validateContributionRow(
      { account_name: 'Brokerage', contribution_date: '2026-01-15', amount: '500' },
      0,
      ctx(),
    );
    expect(row.errors).toHaveLength(0);
    expect(row.status).toBe('new');
    expect(row.resolved.accountId).toBe(10);
    expect(row.resolved.source).toBe(ContributionSource.MANUAL);
  });

  it('errors when account_name does not match', () => {
    const row = validateContributionRow(
      { account_name: 'Unknown', contribution_date: '2026-01-15', amount: '500' },
      0,
      ctx(),
    );
    expect(row.errors.some((e) => e.field === 'account_name')).toBe(true);
  });

  it('errors on bad date format', () => {
    const row = validateContributionRow(
      { account_name: 'Brokerage', contribution_date: '01/15/2026', amount: '500' },
      0,
      ctx(),
    );
    expect(row.errors.some((e) => e.field === 'contribution_date')).toBe(true);
  });

  it('errors on negative amount', () => {
    const row = validateContributionRow(
      { account_name: 'Brokerage', contribution_date: '2026-01-15', amount: '-1' },
      0,
      ctx(),
    );
    expect(row.errors.some((e) => e.field === 'amount')).toBe(true);
  });

  it('errors on unknown source', () => {
    const row = validateContributionRow(
      {
        account_name: 'Brokerage',
        contribution_date: '2026-01-15',
        amount: '500',
        source: 'BAD',
      },
      0,
      ctx(),
    );
    expect(row.errors.some((e) => e.field === 'source')).toBe(true);
  });

  it('parses non-default source', () => {
    const row = validateContributionRow(
      {
        account_name: 'Brokerage',
        contribution_date: '2026-01-15',
        amount: '1500',
        source: ContributionSource.PAYCHECK,
      },
      0,
      ctx(),
    );
    expect(row.errors).toHaveLength(0);
    expect(row.resolved.source).toBe(ContributionSource.PAYCHECK);
  });

  it('detects duplicates as status=duplicate (not update)', () => {
    const dups = new Set<string>();
    dups.add('10::2026-01-15::500');
    const row = validateContributionRow(
      { account_name: 'Brokerage', contribution_date: '2026-01-15', amount: '500' },
      0,
      ctx({ existingContributionDupKeys: dups }),
    );
    expect(row.status).toBe('duplicate');
  });

  it('resolves person_name FK', () => {
    const row = validateContributionRow(
      {
        account_name: 'Brokerage',
        contribution_date: '2026-01-15',
        amount: '500',
        person_name: 'alice',
      },
      0,
      ctx(),
    );
    expect(row.resolved.personId).toBe(1);
  });
});

describe('contributionTemplateCsv', () => {
  it('has account_name, contribution_date, amount in the header', () => {
    const csv = contributionTemplateCsv();
    expect(csv).toContain('account_name');
    expect(csv).toContain('contribution_date');
    expect(csv).toContain('amount');
  });
});
