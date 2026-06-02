import { describe, it, expect } from 'vitest';
import { validateSnapshotRow } from '@/lib/import/validators/snapshot-validator';
import type { ValidationContext } from '@/lib/import/types';

const baseCtx: ValidationContext = {
  accounts: [
    { id: 1, name: 'Fidelity 401k' },
    { id: 2, name: 'Vanguard Brokerage' },
  ],
  existingSnapshots: new Map([
    ['1|2022-03-31', 50_000],
    ['2|2022-03-31', 87_250],
  ]),
};

describe('validateSnapshotRow', () => {
  it('marks a clean new row as status=new with resolved values', () => {
    const row = { account: 'Fidelity 401k', snapshot_date: '2023-06-30', total_value: '60000.50' };
    const r = validateSnapshotRow(row, 1, baseCtx);
    expect(r.status).toBe('new');
    expect(r.errors).toEqual([]);
    expect(r.resolved).toEqual({
      accountId: 1,
      snapshotDate: '2023-06-30',
      totalValue: 60000.5,
      source: 'CSV_IMPORT',
    });
  });

  it('marks a row matching an existing snapshot as status=update with existing value', () => {
    const row = { account: 'Vanguard Brokerage', snapshot_date: '2022-03-31', total_value: '90000' };
    const r = validateSnapshotRow(row, 2, baseCtx);
    expect(r.status).toBe('update');
    expect(r.existing).toBe(87_250);
  });

  it('errors when account is missing', () => {
    const row = { account: '', snapshot_date: '2023-06-30', total_value: '60000' };
    const r = validateSnapshotRow(row, 3, baseCtx);
    expect(r.status).toBe('error');
    expect(r.errors).toContainEqual({ field: 'account', message: expect.stringMatching(/required|not.*match/i) });
  });

  it('errors with an actionable message when account does not match any existing account', () => {
    const row = { account: 'Made Up Account', snapshot_date: '2023-06-30', total_value: '60000' };
    const r = validateSnapshotRow(row, 4, baseCtx);
    expect(r.status).toBe('error');
    const accountErr = r.errors.find((e) => e.field === 'account');
    expect(accountErr).toBeDefined();
    // Still names the account (back-compat) …
    expect(accountErr!.message).toMatch(/no account named/i);
    // … and now tells the user where to add it.
    expect(accountErr!.message).toMatch(/section 2/i);
    expect(accountErr!.message).toMatch(/re-?import/i);
  });

  it('errors when the date is not ISO 8601', () => {
    const row = { account: 'Fidelity 401k', snapshot_date: '06/30/2023', total_value: '60000' };
    const r = validateSnapshotRow(row, 5, baseCtx);
    expect(r.status).toBe('error');
    expect(r.errors).toContainEqual({ field: 'snapshot_date', message: expect.stringMatching(/YYYY-MM-DD/i) });
  });

  it('errors when the date is not a real calendar date', () => {
    const row = { account: 'Fidelity 401k', snapshot_date: '2023-02-30', total_value: '60000' };
    const r = validateSnapshotRow(row, 6, baseCtx);
    expect(r.status).toBe('error');
    expect(r.errors[0].field).toBe('snapshot_date');
  });

  it('errors when value is not numeric', () => {
    const row = { account: 'Fidelity 401k', snapshot_date: '2023-06-30', total_value: 'N/A' };
    const r = validateSnapshotRow(row, 7, baseCtx);
    expect(r.status).toBe('error');
    expect(r.errors).toContainEqual({ field: 'total_value', message: expect.stringMatching(/numeric/i) });
  });

  it('accepts negative total_value (e.g. negative cash)', () => {
    const row = { account: 'Fidelity 401k', snapshot_date: '2023-06-30', total_value: '-500' };
    const r = validateSnapshotRow(row, 8, baseCtx);
    expect(r.status).toBe('new');
    expect(r.resolved.totalValue).toBe(-500);
  });

  it('strips $ and commas from total_value', () => {
    const row = { account: 'Fidelity 401k', snapshot_date: '2023-06-30', total_value: '$60,000.50' };
    const r = validateSnapshotRow(row, 9, baseCtx);
    expect(r.status).toBe('new');
    expect(r.resolved.totalValue).toBe(60000.5);
  });

  it('uses account_id fallback when name is missing', () => {
    const row = { account: '', account_id: '2', snapshot_date: '2023-06-30', total_value: '100' };
    const r = validateSnapshotRow(row, 10, baseCtx);
    expect(r.status).toBe('new');
    expect(r.resolved.accountId).toBe(2);
  });

  it('respects user override on source column when present', () => {
    const row = { account: 'Fidelity 401k', snapshot_date: '2023-06-30', total_value: '60000', source: 'BROKER_STATEMENT' };
    const r = validateSnapshotRow(row, 11, baseCtx);
    expect(r.resolved.source).toBe('BROKER_STATEMENT');
  });

  it('preserves the raw row and rowId on the result', () => {
    const row = { account: 'Fidelity 401k', snapshot_date: '2023-06-30', total_value: '60000' };
    const r = validateSnapshotRow(row, 42, baseCtx);
    expect(r.rowId).toBe(42);
    expect(r.raw).toEqual(row);
  });
});
