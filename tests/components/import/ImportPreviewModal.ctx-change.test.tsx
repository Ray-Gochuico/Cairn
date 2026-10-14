import { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportPreviewModal } from '@/components/import/ImportPreviewModal';
import type { ParseResultLite } from '@/stores/import-preview-store';
import type { ValidationContext } from '@/lib/import/types';

// Same module mocks as tests/components/import/ImportPreviewModal-transactions.test.tsx.
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

import { commitTransactionImport } from '@/lib/import/commit';

const ctx: ValidationContext = {
  accounts: [
    { id: 1, name: 'Checking' },
    { id: 2, name: 'Savings' },
  ],
  categories: [{ id: 1, name: 'Groceries' }],
  existingTransactionKeys: new Set<string>(),
};

// A bank-debit file: every amount negative, so the Flip signs prompt shows.
const negativeParsed: ParseResultLite = {
  headers: ['date', 'account', 'amount', 'merchant'],
  rows: [
    { date: '2024-04-01', account: 'Checking', amount: '-12.00', merchant: 'A' },
    { date: '2024-04-02', account: 'Checking', amount: '-8.50', merchant: 'B' },
    { date: '2024-04-03', account: 'Checking', amount: '-3.25', merchant: 'C' },
  ],
  errors: [],
};

type User = ReturnType<typeof userEvent.setup>;

// StrictMode as in src/main.tsx: it runs the modal's layout effect twice on
// mount, and rerender() keeps the wrapper.
function renderModal(ui: React.ReactElement) {
  return render(ui, { wrapper: StrictMode });
}

/** Row 0: the Account dropdown picks Savings and the merchant becomes ACME. */
async function editRow0(user: User) {
  await user.click(screen.getAllByText('Checking')[0]);
  const picker = screen
    .getAllByRole('combobox')
    .find((el) => within(el).queryByRole('option', { name: 'Savings' }))!;
  await user.selectOptions(picker, 'Savings');
  await user.click(screen.getByText('A'));
  const merchant = screen.getByDisplayValue('A');
  await user.clear(merchant);
  await user.type(merchant, 'ACME{Enter}');
  expect(screen.getByText('ACME')).toBeInTheDocument();
  expect(screen.getByText('Savings')).toBeInTheDocument();
}

function committedRows() {
  return vi.mocked(commitTransactionImport).mock.calls[0][0] as unknown as Array<{
    resolved: { accountId?: number; merchant?: string; amount?: number };
  }>;
}

describe('v1.8.0 O1 (RC1): the import preview keeps every row edit when its context changes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('Flip signs keeps an account pick, a merchant edit and a removed row, and Commit carries them with the flipped amounts', async () => {
    const user = userEvent.setup();
    renderModal(<ImportPreviewModal entity="transaction" parsed={negativeParsed} ctx={ctx} open onOpenChange={vi.fn()} />);
    await editRow0(user);
    await user.click(screen.getAllByRole('button', { name: 'Remove row' })[2]);
    expect(screen.queryByText('C')).toBeNull();

    await user.click(screen.getByLabelText(/flip signs/i));

    expect(await screen.findByText('→ 12.00')).toBeInTheDocument();
    expect(screen.getByText('ACME')).toBeInTheDocument();
    expect(screen.getByText('Savings')).toBeInTheDocument();
    expect(screen.queryByText('C')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Commit (2 rows)' }));
    await waitFor(() => expect(commitTransactionImport).toHaveBeenCalledTimes(1));
    const rows = committedRows();
    expect(rows).toHaveLength(2);
    expect(rows[0].resolved).toMatchObject({ accountId: 2, merchant: 'ACME', amount: 12 });
    expect(rows[1].resolved).toMatchObject({ accountId: 1, merchant: 'B', amount: 8.5 });
  });

  it('turning Flip signs off again keeps the edits, restores the file\'s signs and keeps the same checkbox', async () => {
    const user = userEvent.setup();
    renderModal(<ImportPreviewModal entity="transaction" parsed={negativeParsed} ctx={ctx} open onOpenChange={vi.fn()} />);
    await editRow0(user);
    const flip = screen.getByLabelText(/flip signs/i);

    await user.click(flip);
    await user.click(flip);

    expect(flip.isConnected).toBe(true); // never unmounted between the two states
    expect(flip).not.toBeChecked();
    expect(flip).toHaveFocus();
    expect(screen.queryByText(/^→ /)).toBeNull();
    expect(screen.getByText('ACME')).toBeInTheDocument();
    expect(screen.getByText('Savings')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Commit (3 rows)' }));
    await waitFor(() => expect(commitTransactionImport).toHaveBeenCalledTimes(1));
    expect(committedRows()[0].resolved).toMatchObject({ accountId: 2, merchant: 'ACME', amount: -12 });
  });

  it('a new context object from the parent keeps every edit (a store reload behind the preview)', async () => {
    const user = userEvent.setup();
    const { rerender } = renderModal(
      <ImportPreviewModal entity="transaction" parsed={negativeParsed} ctx={ctx} open onOpenChange={vi.fn()} />,
    );
    await editRow0(user);

    rerender(<ImportPreviewModal entity="transaction" parsed={negativeParsed} ctx={{ ...ctx }} open onOpenChange={vi.fn()} />);

    expect(screen.getByText('ACME')).toBeInTheDocument();
    expect(screen.getByText('Savings')).toBeInTheDocument();
  });

  it('a kept account pick is checked again under the new context: gone, it shows its error; back, it resolves again', async () => {
    const user = userEvent.setup();
    const { rerender } = renderModal(
      <ImportPreviewModal entity="transaction" parsed={negativeParsed} ctx={ctx} open onOpenChange={vi.fn()} />,
    );
    await editRow0(user);

    rerender(
      <ImportPreviewModal
        entity="transaction"
        parsed={negativeParsed}
        ctx={{ ...ctx, accounts: [{ id: 1, name: 'Checking' }] }}
        open
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByText('No account named "Savings"')).toBeInTheDocument();
    expect(screen.getByText('ACME')).toBeInTheDocument();

    rerender(<ImportPreviewModal entity="transaction" parsed={negativeParsed} ctx={{ ...ctx }} open onOpenChange={vi.fn()} />);
    expect(screen.queryByText('No account named "Savings"')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Commit (3 rows)' }));
    await waitFor(() => expect(commitTransactionImport).toHaveBeenCalledTimes(1));
    expect(committedRows()[0].resolved).toMatchObject({ accountId: 2, merchant: 'ACME' });
  });

  it('the next file in a batch still opens a fresh preview', async () => {
    const user = userEvent.setup();
    const { rerender } = renderModal(
      <ImportPreviewModal entity="transaction" parsed={negativeParsed} ctx={ctx} open onOpenChange={vi.fn()} />,
    );
    await editRow0(user);

    rerender(
      <ImportPreviewModal entity="transaction" parsed={{ ...negativeParsed }} ctx={ctx} open onOpenChange={vi.fn()} />,
    );

    expect(screen.queryByText('ACME')).toBeNull();
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.queryByText('Savings')).toBeNull();
  });

  it('an edited amount is kept as typed through Flip signs and commits negated', async () => {
    const user = userEvent.setup();
    renderModal(<ImportPreviewModal entity="transaction" parsed={negativeParsed} ctx={ctx} open onOpenChange={vi.fn()} />);
    await user.click(screen.getByText('-12.00'));
    const amount = screen.getByDisplayValue('-12.00');
    await user.clear(amount);
    await user.type(amount, '-20.00{Enter}');
    expect(screen.getByText('-20.00')).toBeInTheDocument();

    await user.click(screen.getByLabelText(/flip signs/i));

    expect(await screen.findByText('→ 20.00')).toBeInTheDocument();
    expect(screen.getByText('-20.00')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Commit (3 rows)' }));
    await waitFor(() => expect(commitTransactionImport).toHaveBeenCalledTimes(1));
    expect(committedRows()[0].resolved).toMatchObject({ amount: 20 });
  });
});
