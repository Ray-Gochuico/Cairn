import { describe, it, expect } from 'vitest';
import { validateAccountRow, accountTemplateCsv } from '@/lib/import/validators/account';
import type { ValidationContext } from '@/lib/import/types';
import type { Account } from '@/types/schema';
import { AccountType } from '@/types/enums';

function ctx(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return {
    accounts: [],
    persons: [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ],
    categories: [],
    properties: [],
    vehicles: [],
    ...overrides,
  };
}

describe('validateAccountRow', () => {
  it('parses a minimal valid row as status=new', () => {
    const row = validateAccountRow(
      { name: 'Chase Checking', type: AccountType.ACCOUNT_CASH },
      0,
      ctx(),
    );
    expect(row.errors).toHaveLength(0);
    expect(row.status).toBe('new');
    expect(row.resolved.name).toBe('Chase Checking');
    expect(row.resolved.type).toBe(AccountType.ACCOUNT_CASH);
  });

  it('errors when name is missing', () => {
    const row = validateAccountRow(
      { name: '', type: AccountType.ACCOUNT_CASH },
      0,
      ctx(),
    );
    expect(row.status).toBe('error');
    expect(row.errors.some((e) => e.field === 'name')).toBe(true);
  });

  it('errors on unknown type with a helpful message', () => {
    const row = validateAccountRow(
      { name: 'X', type: 'CHECKINNG' },
      0,
      ctx(),
    );
    expect(row.errors.some((e) => e.field === 'type' && /ACCOUNT_/.test(e.message))).toBe(true);
  });

  it('coerces current_balance string to a non-negative number (no error)', () => {
    const row = validateAccountRow(
      { name: 'X', type: AccountType.ACCOUNT_CASH, current_balance: '2500' },
      0,
      ctx(),
    );
    expect(row.errors).toHaveLength(0);
  });

  it('errors when current_balance is negative', () => {
    const row = validateAccountRow(
      { name: 'X', type: AccountType.ACCOUNT_CASH, current_balance: '-1' },
      0,
      ctx(),
    );
    expect(row.errors.some((e) => e.field === 'current_balance')).toBe(true);
  });

  it('resolves owner_person_name via case-insensitive lookup', () => {
    const row = validateAccountRow(
      {
        name: 'X',
        type: AccountType.ACCOUNT_CASH,
        owner_person_name: 'alice',
      },
      0,
      ctx(),
    );
    expect(row.errors).toHaveLength(0);
    expect(row.resolved.ownerPersonId).toBe(1);
  });

  it('errors when owner_person_name does not match', () => {
    const row = validateAccountRow(
      {
        name: 'X',
        type: AccountType.ACCOUNT_CASH,
        owner_person_name: 'Carol',
      },
      0,
      ctx(),
    );
    expect(row.errors.some((e) => e.field === 'owner_person_name')).toBe(true);
  });

  it('errors on a bad accent_color', () => {
    const row = validateAccountRow(
      {
        name: 'X',
        type: AccountType.ACCOUNT_CASH,
        accent_color: 'red',
      },
      0,
      ctx(),
    );
    expect(row.errors.some((e) => e.field === 'accent_color')).toBe(true);
  });

  it('errors on apy_rate outside 0..1', () => {
    const row = validateAccountRow(
      {
        name: 'X',
        type: AccountType.ACCOUNT_CASH,
        apy_rate: '2',
      },
      0,
      ctx(),
    );
    expect(row.errors.some((e) => e.field === 'apy_rate')).toBe(true);
  });

  it('detects conflicts and emits status=update with existingId', () => {
    const existing = new Map<string, Account>();
    existing.set('chase checking', {
      id: 42,
      householdId: 1,
      name: 'Chase Checking',
      type: AccountType.ACCOUNT_CASH,
    } as Account);
    const row = validateAccountRow(
      { name: 'Chase Checking', type: AccountType.ACCOUNT_CASH },
      0,
      ctx({ existingAccountConflicts: existing }),
    );
    expect(row.status).toBe('update');
    expect(row.existingId).toBe(42);
  });
});

describe('accountTemplateCsv', () => {
  it('returns a CSV string with the header and at least one example row', () => {
    const csv = accountTemplateCsv();
    expect(csv).toContain('name');
    expect(csv).toContain('type');
    expect(csv.split('\n').length).toBeGreaterThanOrEqual(2);
  });
});
