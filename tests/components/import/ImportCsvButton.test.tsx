import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImportCsvButton } from '@/components/import/ImportCsvButton';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';

vi.mock('@/lib/import/commit', () => ({
  commitSnapshotImport: vi.fn().mockResolvedValue({ inserted: 1, updated: 0, skipped: 0 }),
}));

vi.mock('@/db/db', () => ({
  getDatabase: () => ({
    execute: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
    select: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

describe('ImportCsvButton', () => {
  beforeEach(() => {
    useAccountsStore.setState({
      // minimal Account shape; cast through unknown for the test
      accounts: [{ id: 1, name: 'Fidelity 401k' } as never],
    });
    useSnapshotsStore.setState({
      snapshots: [],
      isLoading: false,
      error: null,
    });
  });

  it('renders an Import CSV button', () => {
    render(<ImportCsvButton entity="snapshot" />);
    expect(screen.getByRole('button', { name: /import csv/i })).toBeInTheDocument();
  });

  it('opens the modal after a file is chosen', async () => {
    render(<ImportCsvButton entity="snapshot" />);
    const file = new File(
      ['account,snapshot_date,total_value\nFidelity 401k,2023-06-30,60000\n'],
      'snap.csv',
      { type: 'text/csv' },
    );
    const input = screen.getByTestId('import-csv-file-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(screen.getByText(/import account snapshots from csv/i)).toBeInTheDocument();
  });

  it('shows a parse-error banner when the CSV is malformed', async () => {
    render(<ImportCsvButton entity="snapshot" />);
    const file = new File(['"unterminated\n'], 'bad.csv', { type: 'text/csv' });
    const input = screen.getByTestId('import-csv-file-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByText(/fix and re-upload/i)).toBeInTheDocument());
  });
});
