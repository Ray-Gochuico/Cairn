import { describe, it, expect } from 'vitest';
import { createImportPreviewStore } from '@/stores/import-preview-store';
import type { ValidationContext } from '@/lib/import/types';

// The fixture of tests/stores/import-preview-store.test.ts: row 0 is new, row 1
// updates the existing Vanguard snapshot of 2022-03-31, row 2 names no account.
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

function makeStore() {
  return createImportPreviewStore('snapshot', { headers, rows, errors: [] }, ctx);
}

describe('v1.8.0 O1 (RC1): setCtx re-checks the preview under a new context and keeps the user\'s work', () => {
  it('keeps every edit, deletion and conflict choice, and re-checks an edited row against the new context', () => {
    const store = makeStore();
    store.getState().edit(2, { account: 'Brokerage' }); // no such account yet
    store.getState().setConflictMode(1, 'skip');
    store.getState().delete(0);
    expect(store.getState().derivedRows.find((r) => r.rowId === 2)!.status).toBe('error');

    const next: ValidationContext = {
      accounts: [...ctx.accounts!, { id: 3, name: 'Brokerage' }],
      existingSnapshots: new Map([['2|2022-03-31', 87_250]]),
    };
    store.getState().setCtx(next);

    const s = store.getState();
    expect(s.ctx).toBe(next);
    expect(s.edits.get(2)).toEqual({ account: 'Brokerage' });
    expect([...s.deletions]).toEqual([0]);
    expect(s.conflictMode.get(1)).toBe('skip');
    expect(s.derivedRows.map((r) => r.rowId)).toEqual([1, 2]);
    const row2 = s.derivedRows.find((r) => r.rowId === 2)!;
    expect(row2.status).toBe('new');
    expect(row2.resolved).toMatchObject({ accountId: 3 });
    expect(s.summary).toEqual({ new: 1, update: 1, duplicate: 0, error: 0, deleted: 1 });
    expect(s.committableRows().map((r) => r.rowId)).toEqual([2]); // row 1 is still skipped
  });

  it('re-checks an unedited row too: a snapshot that is no longer there makes its row new', () => {
    const store = makeStore();
    expect(store.getState().derivedRows.find((r) => r.rowId === 1)!.status).toBe('update');

    store.getState().setCtx({ ...ctx, existingSnapshots: new Map() });

    expect(store.getState().derivedRows.find((r) => r.rowId === 1)!.status).toBe('new');
    expect(store.getState().summary.update).toBe(0);
  });

  it('pushing the context the store already has changes nothing', () => {
    const store = makeStore();
    store.getState().edit(0, { total_value: '61000' });
    const before = store.getState();

    store.getState().setCtx(before.ctx);

    expect(store.getState()).toBe(before);
  });
});
