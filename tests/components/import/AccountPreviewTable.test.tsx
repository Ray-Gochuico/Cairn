import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AccountPreviewTable } from '@/components/import/AccountPreviewTable';
import { createImportPreviewStore, type ImportPreviewState } from '@/stores/import-preview-store';
import { useStore } from 'zustand';
import { AccountType } from '@/types/enums';

function Harness({ state }: { state: ImportPreviewState<'account'> }) {
  return <AccountPreviewTable state={state} />;
}

function setup(rows: Array<Record<string, string>>, opts: { existingAccountConflicts?: Map<string, any> } = {}) {
  const store = createImportPreviewStore(
    'account',
    {
      headers: Object.keys(rows[0] ?? {}),
      rows,
      errors: [],
    },
    {
      accounts: [],
      persons: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
      categories: [],
      properties: [],
      vehicles: [],
      existingAccountConflicts: opts.existingAccountConflicts,
    },
  );
  return store;
}

function Render({ store }: { store: ReturnType<typeof setup> }) {
  const state = useStore(store);
  return <Harness state={state} />;
}

describe('AccountPreviewTable', () => {
  it('renders one row per row in state.derivedRows', () => {
    const store = setup([
      { name: 'Chase Checking', type: AccountType.ACCOUNT_CASH, current_balance: '2500' },
    ]);
    render(<Render store={store} />);
    expect(screen.getByText(/Chase Checking/)).toBeInTheDocument();
    expect(screen.getByText(/2,500|2500/)).toBeInTheDocument();
  });

  it('shows error rows with the cell-error message inline', () => {
    const store = setup([
      { name: '', type: 'X', current_balance: '-5' },
    ]);
    render(<Render store={store} />);
    expect(screen.getByText(/Name is required/)).toBeInTheDocument();
  });

  it('renders the "No rows" empty state when all rows are deleted', () => {
    const store = setup([
      { name: 'Chase Checking', type: AccountType.ACCOUNT_CASH },
    ]);
    store.getState().delete(0);
    render(<Render store={store} />);
    expect(screen.getByText(/No rows to preview/)).toBeInTheDocument();
  });

  it('renders an UPDATE badge when a conflict is detected', () => {
    const existing = new Map<string, any>();
    existing.set('chase checking', { id: 7, name: 'Chase Checking' });
    const store = setup(
      [{ name: 'Chase Checking', type: AccountType.ACCOUNT_CASH }],
      { existingAccountConflicts: existing },
    );
    render(<Render store={store} />);
    expect(screen.getByText('UPDATE')).toBeInTheDocument();
  });
});
