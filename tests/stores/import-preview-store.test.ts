import { describe, it, expect, beforeEach } from 'vitest';
import { createImportPreviewStore } from '@/stores/import-preview-store';
import type { ValidationContext } from '@/lib/import/types';

const ctx: ValidationContext = {
  accounts: [
    { id: 1, name: 'Fidelity 401k' },
    { id: 2, name: 'Vanguard' },
  ],
  existingSnapshots: new Map([['2|2022-03-31', 87_250]]),
};

const headers = ['account', 'snapshot_date', 'total_value'];
const rows = [
  { account: 'Fidelity 401k', snapshot_date: '2023-06-30', total_value: '60000' },
  { account: 'Vanguard', snapshot_date: '2022-03-31', total_value: '90000' },
  { account: 'Unknown Account', snapshot_date: '2023-06-30', total_value: '50000' },
];

describe('createImportPreviewStore — snapshot mode', () => {
  let store: ReturnType<typeof createImportPreviewStore<'snapshot'>>;

  beforeEach(() => {
    store = createImportPreviewStore('snapshot', { headers, rows, errors: [] }, ctx);
  });

  it('derives initial summary by status', () => {
    const s = store.getState();
    expect(s.summary.new).toBe(1);
    expect(s.summary.update).toBe(1);
    expect(s.summary.error).toBe(1);
    expect(s.summary.deleted).toBe(0);
    expect(s.derivedRows).toHaveLength(3);
  });

  it('edit() updates the row and re-derives status', () => {
    store.getState().edit(2, { account: 'Fidelity 401k' });
    const s = store.getState();
    const row2 = s.derivedRows.find((r) => r.rowId === 2)!;
    expect(row2.status).toBe('new');
    expect(s.summary.new).toBe(2);
    expect(s.summary.error).toBe(0);
  });

  it('delete() removes the row and updates summary', () => {
    store.getState().delete(0);
    const s = store.getState();
    expect(s.derivedRows.find((r) => r.rowId === 0)).toBeUndefined();
    expect(s.summary.new).toBe(0);
    expect(s.summary.deleted).toBe(1);
  });

  it('bulkSetConflict() flips all UPDATE rows', () => {
    store.getState().bulkSetConflict('skip');
    const updateRow = store.getState().derivedRows.find((r) => r.status === 'update');
    expect(updateRow).toBeDefined();
    expect(store.getState().conflictMode.get(updateRow!.rowId)).toBe('skip');
  });

  it('setConflictMode() updates a single row', () => {
    const updateRow = store.getState().derivedRows.find((r) => r.status === 'update')!;
    store.getState().setConflictMode(updateRow.rowId, 'skip');
    expect(store.getState().conflictMode.get(updateRow.rowId)).toBe('skip');
  });

  it('deleteAllErrors() removes only ERROR rows', () => {
    store.getState().deleteAllErrors();
    const remaining = store.getState().derivedRows;
    expect(remaining.every((r) => r.status !== 'error')).toBe(true);
    expect(remaining).toHaveLength(2);
  });

  it('committableRows excludes errors and skip-flagged conflicts', () => {
    store.getState().bulkSetConflict('skip');
    const c = store.getState().committableRows();
    expect(c).toHaveLength(1);
    expect(c[0].status).toBe('new');
  });

  it('committableRows includes UPDATE rows by default (update mode is default)', () => {
    const c = store.getState().committableRows();
    // 1 NEW + 1 UPDATE = 2 committable; ERROR excluded
    expect(c).toHaveLength(2);
  });
});
