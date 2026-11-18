/**
 * v1.8.0 W4 (O1 chip (e), folded in task_90fd839b): an open import preview
 * checks its rows again only when a store its own rows are checked against
 * reloads.
 *
 * ImportCsvButton rebuilt the preview's context on a reload of any of its 12
 * stores, whatever the entity, and since v1.8.0 O1 a new context re-checks
 * every row: correct, but a 10,000-row preview behind an unrelated reload (a
 * market refresh reloads snapshots) was checked again in full for nothing.
 * The context now depends only on the stores the entity's validator and
 * preview table read (src/lib/import/ctx-sources.ts). The account validator
 * is wrapped to count its calls. Clock-free.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/import/validators/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/import/validators/account')>();
  return { ...actual, validateAccountRow: vi.fn(actual.validateAccountRow) };
});
vi.mock('@/lib/csv', () => ({ downloadCsv: vi.fn() }));

import { act, fireEvent, render, screen } from '@testing-library/react';
import { ImportCsvButton } from '@/components/import/ImportCsvButton';
import { validateAccountRow } from '@/lib/import/validators/account';
import { useAccountsStore } from '@/stores/accounts-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useCategoriesStore } from '@/stores/categories-store';
import { useHoldingsStore } from '@/stores/holdings-store';

const accountsCsv =
  'name,type,current_balance,owner_person_name\nJoint Checking,ACCOUNT_CASH,2500,Sam\n';

async function openAccountPreview() {
  render(<ImportCsvButton entity="account" />);
  const input = screen.getByTestId('import-csv-file-input') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File([accountsCsv], 'accounts.csv', { type: 'text/csv' })] } });
  await screen.findByRole('dialog');
}

describe('ImportCsvButton: a preview is checked again only for the stores its rows read (O1 (e))', () => {
  beforeEach(() => {
    vi.mocked(validateAccountRow).mockClear();
    useAccountsStore.setState({ accounts: [], isLoading: false, error: null });
    usePersonsStore.setState({ persons: [{ id: 1, name: 'Alex' } as never], isLoading: false, error: null });
    useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null });
    useTransactionsStore.setState({ transactions: [], isLoading: false, error: null });
    useCategoriesStore.setState({ categories: [], isLoading: false, error: null });
    useHoldingsStore.setState({ holdings: [], isLoading: false, error: null });
  });

  it('a reload of stores the account rows never read leaves the open preview unchecked again', async () => {
    await openAccountPreview();
    expect(screen.getByText('No person named "Sam".')).toBeInTheDocument();
    vi.mocked(validateAccountRow).mockClear();
    act(() => {
      useSnapshotsStore.setState({ snapshots: [] });
      useTransactionsStore.setState({ transactions: [] });
      useCategoriesStore.setState({ categories: [] });
      useHoldingsStore.setState({ holdings: [] });
    });
    expect(validateAccountRow).not.toHaveBeenCalled();
    expect(screen.getByText('No person named "Sam".')).toBeInTheDocument();
  });

  it('a reload of the persons store the account rows read still checks them again', async () => {
    await openAccountPreview();
    expect(screen.getByText('No person named "Sam".')).toBeInTheDocument();
    vi.mocked(validateAccountRow).mockClear();
    act(() => {
      usePersonsStore.setState({ persons: [{ id: 1, name: 'Alex' }, { id: 2, name: 'Sam' }] as never });
    });
    expect(validateAccountRow).toHaveBeenCalled();
    expect(screen.queryByText('No person named "Sam".')).toBeNull();
  });

  it('a reload of the accounts store (the name-clash check) still checks them again', async () => {
    await openAccountPreview();
    vi.mocked(validateAccountRow).mockClear();
    act(() => {
      useAccountsStore.setState({ accounts: [{ id: 7, name: 'Joint Checking' } as never] });
    });
    expect(validateAccountRow).toHaveBeenCalled();
  });
});
