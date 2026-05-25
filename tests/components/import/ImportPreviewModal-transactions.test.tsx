import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImportPreviewModal } from '@/components/import/ImportPreviewModal';
import type { ParseResultLite } from '@/stores/import-preview-store';

vi.mock('@/lib/import/commit', () => ({
  commitSnapshotImport: vi.fn(),
  commitTransactionImport: vi.fn().mockResolvedValue({ inserted: 1, updated: 0, skipped: 0 }),
}));

vi.mock('@/stores/snapshots-store', () => ({
  useSnapshotsStore: Object.assign(
    (selector: (s: { load: () => Promise<void> }) => unknown) =>
      selector({ load: vi.fn().mockResolvedValue(undefined) }),
    { getState: () => ({ load: vi.fn().mockResolvedValue(undefined) }) },
  ),
}));

vi.mock('@/stores/transactions-store', () => ({
  useTransactionsStore: Object.assign(
    (selector: (s: { load: () => Promise<void> }) => unknown) =>
      selector({ load: vi.fn().mockResolvedValue(undefined) }),
    { getState: () => ({ load: vi.fn().mockResolvedValue(undefined) }) },
  ),
}));

vi.mock('@/stores/household-store', () => ({
  useHouseholdStore: Object.assign(
    (selector: (s: { household: { id: number } | null }) => unknown) =>
      selector({ household: { id: 1 } }),
    { getState: () => ({ household: { id: 1 } }) },
  ),
}));

vi.mock('@/db/db', () => ({
  getDatabase: () => ({
    execute: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
    select: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

const ctx = {
  accounts: [{ id: 1, name: 'Checking' }],
  categories: [{ id: 1, name: 'Groceries' }],
  existingTransactionKeys: new Set(['1|2024-03-15|54.23|amazon']),
};

const cleanParsed: ParseResultLite = {
  headers: ['date', 'account', 'amount', 'merchant', 'category', 'reimbursable'],
  rows: [
    {
      date: '2024-03-15',
      account: 'Checking',
      amount: '20.00',
      merchant: 'STARBUCKS',
      category: 'Groceries',
      reimbursable: 'no',
    },
  ],
  errors: [],
};

const duplicateParsed: ParseResultLite = {
  headers: ['date', 'account', 'amount', 'merchant', 'category', 'reimbursable'],
  rows: [
    {
      date: '2024-03-15',
      account: 'Checking',
      amount: '54.23',
      merchant: 'AMAZON',
      category: 'Groceries',
      reimbursable: 'no',
    },
  ],
  errors: [],
};

describe('ImportPreviewModal — transaction mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the transaction title and a row', () => {
    render(
      <ImportPreviewModal
        entity="transaction"
        parsed={cleanParsed}
        ctx={ctx}
        open
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/import transactions from csv/i)).toBeInTheDocument();
    expect(screen.getByText('STARBUCKS')).toBeInTheDocument();
  });

  it('shows the DUPLICATE pill when a row matches existingTransactionKeys', () => {
    render(
      <ImportPreviewModal
        entity="transaction"
        parsed={duplicateParsed}
        ctx={ctx}
        open
        onOpenChange={vi.fn()}
      />,
    );
    // The summary pill
    expect(screen.getByText(/1 duplicate/i)).toBeInTheDocument();
    // The row badge
    expect(screen.getByText(/^DUPLICATE$/)).toBeInTheDocument();
  });

  it('commits transactions and closes', async () => {
    const onOpenChange = vi.fn();
    render(
      <ImportPreviewModal
        entity="transaction"
        parsed={cleanParsed}
        ctx={ctx}
        open
        onOpenChange={onOpenChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^commit/i }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const { commitTransactionImport } = await import('@/lib/import/commit');
    expect(commitTransactionImport).toHaveBeenCalled();
  });

  it('Commit is disabled when only a duplicate row exists with default skip mode', () => {
    render(
      <ImportPreviewModal
        entity="transaction"
        parsed={duplicateParsed}
        ctx={ctx}
        open
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /^commit/i })).toBeDisabled();
  });
});
