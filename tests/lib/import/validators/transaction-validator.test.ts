import { describe, it, expect } from 'vitest';
import { validateTransactionRow } from '@/lib/import/validators/transaction-validator';
import type { ValidationContext } from '@/lib/import/types';

const ctx: ValidationContext = {
  accounts: [{ id: 1, name: 'Chase Checking' }, { id: 2, name: 'Amex' }],
  persons: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }],
  categories: [{ id: 10, name: 'Groceries' }, { id: 11, name: 'Dining' }],
  existingTransactionKeys: new Set([
    '1|2024-01-15|-42.5|whole foods',
  ]),
};

describe('validateTransactionRow', () => {
  it('marks a clean row as status=new', () => {
    const row = {
      date: '2024-02-01', account: 'Chase Checking', amount: '-30',
      merchant: 'Trader Joes', category: 'Groceries',
    };
    const r = validateTransactionRow(row, 1, ctx);
    expect(r.status).toBe('new');
    expect(r.resolved).toMatchObject({
      accountId: 1,
      date: '2024-02-01',
      amount: -30,
      merchant: 'Trader Joes',
      categoryId: 10,
    });
  });

  it('flags duplicate when (account,date,amount,lowercased+trimmed merchant) matches existing', () => {
    const row = {
      date: '2024-01-15', account: 'Chase Checking', amount: '-42.50',
      merchant: '  Whole Foods  ',
    };
    const r = validateTransactionRow(row, 2, ctx);
    expect(r.status).toBe('duplicate');
  });

  it('requires merchant', () => {
    const row = { date: '2024-02-01', account: 'Chase Checking', amount: '-30', merchant: '' };
    const r = validateTransactionRow(row, 3, ctx);
    expect(r.status).toBe('error');
    expect(r.errors).toContainEqual({ field: 'merchant', message: expect.stringMatching(/required/i) });
  });

  it('allows missing category (categoryId stays undefined, no error)', () => {
    const row = { date: '2024-02-01', account: 'Chase Checking', amount: '-30', merchant: 'Misc' };
    const r = validateTransactionRow(row, 4, ctx);
    expect(r.status).toBe('new');
    expect(r.resolved.categoryId).toBeUndefined();
  });

  it('errors on unknown category', () => {
    const row = {
      date: '2024-02-01', account: 'Chase Checking', amount: '-30',
      merchant: 'X', category: 'Made Up',
    };
    const r = validateTransactionRow(row, 5, ctx);
    expect(r.status).toBe('error');
    expect(r.errors).toContainEqual({ field: 'category', message: expect.stringMatching(/no.*category/i) });
  });

  it('parses reimbursable leniently', () => {
    const cases: [string, boolean][] = [
      ['true', true], ['TRUE', true], ['1', true], ['yes', true], ['y', true],
      ['false', false], ['0', false], ['no', false], ['n', false], ['', false],
    ];
    for (const [input, expected] of cases) {
      const row = {
        date: '2024-02-01', account: 'Chase Checking', amount: '-30',
        merchant: 'X', reimbursable: input,
      };
      const r = validateTransactionRow(row, 6, ctx);
      expect(r.resolved.reimbursable).toBe(expected);
    }
  });

  it('errors on unparseable reimbursable value', () => {
    const row = {
      date: '2024-02-01', account: 'Chase Checking', amount: '-30',
      merchant: 'X', reimbursable: 'maybe',
    };
    const r = validateTransactionRow(row, 7, ctx);
    expect(r.status).toBe('error');
    expect(r.errors).toContainEqual({ field: 'reimbursable', message: expect.stringMatching(/true.*false/i) });
  });

  it('resolves person by name; empty person → null (joint)', () => {
    const r1 = validateTransactionRow(
      { date: '2024-02-01', account: 'Chase Checking', amount: '-30', merchant: 'X', person: 'Alice' },
      8, ctx,
    );
    expect(r1.resolved.personId).toBe(1);

    const r2 = validateTransactionRow(
      { date: '2024-02-01', account: 'Chase Checking', amount: '-30', merchant: 'X' },
      9, ctx,
    );
    expect(r2.resolved.personId).toBeNull();
  });

  it('errors on unknown person', () => {
    const row = {
      date: '2024-02-01', account: 'Chase Checking', amount: '-30',
      merchant: 'X', person: 'Carol',
    };
    const r = validateTransactionRow(row, 10, ctx);
    expect(r.status).toBe('error');
    expect(r.errors).toContainEqual({ field: 'person', message: expect.stringMatching(/no.*person/i) });
  });
});

describe('locale-aware amounts (wave-9 S78)', () => {
  it('a European "1.234,56" amount resolves to 1234.56 with no error', () => {
    const row = {
      date: '2024-02-01', account: 'Chase Checking', amount: '1.234,56',
      merchant: 'EU Store',
    };
    const r = validateTransactionRow(row, 9, ctx);
    expect(r.errors).toEqual([]);
    expect(r.resolved.amount).toBeCloseTo(1234.56, 10);
  });

  it('an unparseable amount becomes a row error, not a silently-wrong number', () => {
    const row = {
      date: '2024-02-01', account: 'Chase Checking', amount: '1,23,45',
      merchant: 'Weird',
    };
    const r = validateTransactionRow(row, 10, ctx);
    expect(r.status).toBe('error');
    expect(r.errors.some((e) => e.field === 'amount')).toBe(true);
  });
});

describe('transactionAmountSign (wave-9 chip b)', () => {
  it('FLIP negates parsed amounts so negative-debit CSVs count as spending', () => {
    const row = {
      date: '2024-02-01', account: 'Chase Checking', amount: '-42.50',
      merchant: 'Coffee',
    };
    const r = validateTransactionRow(row, 11, { ...ctx, transactionAmountSign: 'FLIP' });
    expect(r.resolved.amount).toBe(42.5);
  });

  it('AS_IS (default) leaves the sign untouched', () => {
    const row = {
      date: '2024-02-01', account: 'Chase Checking', amount: '-42.50',
      merchant: 'Coffee',
    };
    const r = validateTransactionRow(row, 12, ctx);
    expect(r.resolved.amount).toBe(-42.5);
  });
});

describe('reimbursement round-trip (wave-9 S79)', () => {
  it('parses reimbursed_at/reimbursed_amount and implies reimbursable', () => {
    const row = {
      date: '2024-02-01', account: 'Chase Checking', amount: '100',
      merchant: 'Hotel', reimbursable: 'false',
      reimbursed_at: '2026-05-01', reimbursed_amount: '40',
    };
    const r = validateTransactionRow(row, 13, ctx);
    expect(r.errors).toEqual([]);
    expect(r.resolved).toMatchObject({
      reimbursable: true, reimbursedAt: '2026-05-01', reimbursedAmount: 40,
    });
  });

  it('defaults the reimbursement fields to null when the columns are absent', () => {
    const row = {
      date: '2024-02-01', account: 'Chase Checking', amount: '100', merchant: 'Hotel',
    };
    const r = validateTransactionRow(row, 14, ctx);
    expect(r.resolved.reimbursedAt).toBeNull();
    expect(r.resolved.reimbursedAmount).toBeNull();
  });

  it('rejects a malformed reimbursed_at date', () => {
    const row = {
      date: '2024-02-01', account: 'Chase Checking', amount: '100',
      merchant: 'Hotel', reimbursed_at: 'not-a-date',
    };
    const r = validateTransactionRow(row, 15, ctx);
    expect(r.status).toBe('error');
    expect(r.errors.some((e) => e.field === 'reimbursed_at')).toBe(true);
  });
});
