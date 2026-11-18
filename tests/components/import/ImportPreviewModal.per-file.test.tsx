/**
 * v1.8.0 W4 (PG-3 / O1 chip (g) ⚑, folded in task_90fd839b): each file of a
 * CSV batch opens with its own Flip signs and its own commit message.
 *
 * The batch shows every file in one open preview, and the preview kept its
 * Flip signs tick and its "Commit failed: …" line across files: file 2 opened
 * already flipped when file 1 was, and showed file 1's failure. The rows'
 * store was already per file (v1.8.0 O1); these two now are too. Within one
 * file nothing changes. Clock-free.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/import/commit', () => ({
  commitSnapshotImport: vi.fn(),
  commitTransactionImport: vi.fn(),
}));
vi.mock('@/lib/csv', () => ({ downloadCsv: vi.fn() }));
vi.mock('@/db/db', () => ({
  getDatabase: () => ({
    execute: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
    select: vi.fn().mockResolvedValue([]),
    executeBatch: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportCsvButton } from '@/components/import/ImportCsvButton';
import { commitTransactionImport } from '@/lib/import/commit';
import { useAccountsStore } from '@/stores/accounts-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useCategoriesStore } from '@/stores/categories-store';
import { usePersonsStore } from '@/stores/persons-store';

const FLIP = 'Flip signs (treat negatives as spending)';
const negatives = (a: string, b: string) =>
  `date,account,amount,merchant\n2026-04-01,Chase Checking,-12.00,${a}\n2026-04-02,Chase Checking,-8.50,${b}\n`;

async function queueTwo() {
  const user = userEvent.setup();
  render(<ImportCsvButton entity="transaction" />);
  const input = screen.getByTestId('import-csv-file-input') as HTMLInputElement;
  fireEvent.change(input, {
    target: {
      files: [
        new File([negatives('ALPHA', 'ALPHA TWO')], 'april.csv', { type: 'text/csv' }),
        new File([negatives('BRAVO', 'BRAVO TWO')], 'may.csv', { type: 'text/csv' }),
      ],
    },
  });
  expect(await screen.findByText('ALPHA')).toBeInTheDocument();
  expect(screen.getByText(/File 1 of 2/)).toBeInTheDocument();
  return { user };
}

describe('CSV batch: each file starts with its own Flip signs and commit message (PG-3, O1 (g))', () => {
  beforeEach(() => {
    vi.mocked(commitTransactionImport).mockReset();
    useAccountsStore.setState({ accounts: [{ id: 1, name: 'Chase Checking' } as never], isLoading: false, error: null });
    useTransactionsStore.setState({ transactions: [], isLoading: false, error: null });
    useCategoriesStore.setState({ categories: [], isLoading: false, error: null });
    usePersonsStore.setState({ persons: [], isLoading: false, error: null });
  });

  it('Flip signs ticked on file 1 is not ticked on file 2, and file 2 shows no flipped amounts', async () => {
    const { user } = await queueTwo();
    await user.click(screen.getByRole('checkbox', { name: FLIP }));
    expect(screen.getByRole('checkbox', { name: FLIP })).toBeChecked();
    expect(screen.getAllByLabelText('amount after sign flip')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Skip this file' }));
    expect(await screen.findByText('BRAVO')).toBeInTheDocument();
    expect(screen.getByText(/File 2 of 2/)).toBeInTheDocument();
    // File 2 is majority negative too, so it offers Flip signs, unticked.
    expect(screen.getByRole('checkbox', { name: FLIP })).not.toBeChecked();
    expect(screen.queryAllByLabelText('amount after sign flip')).toHaveLength(0);
  });

  it("file 1's failed commit message does not show on file 2", async () => {
    vi.mocked(commitTransactionImport).mockRejectedValueOnce(new Error('disk full'));
    const { user } = await queueTwo();
    await user.click(screen.getByRole('button', { name: /^Commit \(/ }));
    expect(await screen.findByText('Commit failed: disk full')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Skip this file' }));
    expect(await screen.findByText('BRAVO')).toBeInTheDocument();
    expect(screen.queryByText(/Commit failed/)).toBeNull();
  });

  it('within one file, Flip signs and a failed commit message stay as they were', async () => {
    vi.mocked(commitTransactionImport).mockRejectedValueOnce(new Error('disk full'));
    const { user } = await queueTwo();
    await user.click(screen.getByRole('checkbox', { name: FLIP }));
    await user.click(screen.getByRole('button', { name: /^Commit \(/ }));
    expect(await screen.findByText('Commit failed: disk full')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Remove row' })[0]);
    expect(screen.getByText('Commit failed: disk full')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: FLIP })).toBeChecked();
  });
});
