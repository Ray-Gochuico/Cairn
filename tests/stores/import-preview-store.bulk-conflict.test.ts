/**
 * v1.8.0 W4 (O1 chip (j) ⚑, folded in task_90fd839b): Skip all (and Skip all
 * duplicates) also covers a conflict that appears after it was pressed. Update
 * all and Insert all duplicates still act only on the rows shown at the click,
 * so a duplicate that turns up later is never written without its own choice.
 *
 * Since v1.8.0 O1 the preview re-checks its rows when the stores behind it
 * reload, or when a row is edited, so a row that was new can become an
 * update. bulkSetConflict recorded its choice only for the rows that were
 * conflicts at the click, and a later one fell back to its status default
 * (an update writes, a duplicate is skipped): after Skip all, that row
 * overwrote the saved balance. A choice made on the row itself still wins.
 * Clock-free.
 */
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
/** The same stores after a reload that saved Fidelity's 2023-06-30 balance. */
const reloaded: ValidationContext = {
  ...ctx,
  existingSnapshots: new Map([
    ['2|2022-03-31', 87_250],
    ['1|2023-06-30', 59_000],
  ]),
};

function makeStore() {
  return createImportPreviewStore('snapshot', { headers, rows, errors: [] }, ctx);
}

describe('a bulk conflict choice covers conflicts that appear later (O1 (j))', () => {
  it('Skip all, then a reload makes row 0 an update: row 0 is skipped too', () => {
    const store = makeStore();
    store.getState().bulkSetConflict('skip');
    store.getState().setCtx(reloaded);
    const s = store.getState();
    expect(s.derivedRows.find((r) => r.rowId === 0)!.status).toBe('update');
    expect(s.conflictMode.get(0)).toBe('skip');
    expect(s.committableRows()).toEqual([]);
  });

  it('Skip all, then an edit makes row 2 an update: row 2 is skipped too', () => {
    const store = makeStore();
    store.getState().bulkSetConflict('skip');
    store.getState().edit(2, { account: 'Vanguard', snapshot_date: '2022-03-31' });
    const s = store.getState();
    expect(s.derivedRows.find((r) => r.rowId === 2)!.status).toBe('update');
    expect(s.conflictMode.get(2)).toBe('skip');
    expect(s.committableRows().map((r) => r.rowId)).toEqual([0]);
  });

  it("a row's own choice made after Skip all is kept when the rows are checked again", () => {
    const store = makeStore();
    store.getState().bulkSetConflict('skip');
    store.getState().setConflictMode(1, 'update');
    store.getState().setCtx(reloaded);
    const s = store.getState();
    expect(s.conflictMode.get(1)).toBe('update');
    expect(s.conflictMode.get(0)).toBe('skip');
    expect(s.committableRows().map((r) => r.rowId)).toEqual([1]);
  });

  it('with no bulk choice, a later conflict takes its status default, as before (an update writes)', () => {
    const store = makeStore();
    store.getState().setCtx(reloaded);
    const s = store.getState();
    expect(s.conflictMode.size).toBe(0);
    expect(s.committableRows().map((r) => r.rowId)).toEqual([0, 1]);
  });

  it('Insert all duplicates covers only the duplicates shown at the click: one that appears later is skipped by default', () => {
    const store = createImportPreviewStore(
      'contribution',
      {
        headers: ['account_name', 'contribution_date', 'amount'],
        rows: [
          { account_name: '401k', contribution_date: '2026-09-30', amount: '250' },
          { account_name: '401k', contribution_date: '2026-10-31', amount: '250' },
        ],
        errors: [],
      },
      { accounts: [{ id: 1, name: '401k' }], existingContributionDupKeys: new Set(['1::2026-09-30::250']) },
    );
    store.getState().bulkSetConflict('update');
    store.getState().setCtx({
      accounts: [{ id: 1, name: '401k' }],
      existingContributionDupKeys: new Set(['1::2026-09-30::250', '1::2026-10-31::250']),
    });
    const s = store.getState();
    expect(s.derivedRows.map((r) => r.status)).toEqual(['duplicate', 'duplicate']);
    expect(s.conflictMode.has(1)).toBe(false);
    expect(s.committableRows().map((r) => r.rowId)).toEqual([0]);
  });

  it('Update all after Skip all ends the carry: a later update takes its status default (it writes)', () => {
    const store = makeStore();
    store.getState().bulkSetConflict('skip');
    store.getState().bulkSetConflict('update');
    store.getState().setCtx(reloaded);
    const s = store.getState();
    expect(s.derivedRows.find((r) => r.rowId === 0)!.status).toBe('update');
    expect(s.conflictMode.has(0)).toBe(false);
    expect(s.committableRows().map((r) => r.rowId)).toEqual([0, 1]);
  });
});
