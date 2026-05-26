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

describe('ImportCsvButton multi-file', () => {
  beforeEach(() => {
    useAccountsStore.setState({
      accounts: [{ id: 1, name: 'Fidelity 401k' } as never],
    });
    useSnapshotsStore.setState({
      snapshots: [],
      isLoading: false,
      error: null,
    });
  });

  const VALID_SNAPSHOT_CSV =
    'account,snapshot_date,total_value\n' +
    'Fidelity 401k,2023-06-30,60000\n';

  function csvFile(name: string, content: string): File {
    return new File([content], name, { type: 'text/csv' });
  }

  it('input has the multiple attribute', () => {
    render(<ImportCsvButton entity="snapshot" />);
    const input = screen.getByTestId('import-csv-file-input') as HTMLInputElement;
    expect(input.multiple).toBe(true);
  });

  it('does not render the "File N of M" subtitle when only one file is selected', async () => {
    render(<ImportCsvButton entity="snapshot" />);
    const input = screen.getByTestId('import-csv-file-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [csvFile('a.csv', VALID_SNAPSHOT_CSV)],
      configurable: true,
    });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(screen.queryByText(/File 1 of 1/)).toBeNull();
    expect(screen.queryByText(/File \d+ of \d+/)).toBeNull();
  });

  it('renders "File 1 of 3" subtitle and advances to "File 2 of 3" on Commit', async () => {
    render(<ImportCsvButton entity="snapshot" />);
    const input = screen.getByTestId('import-csv-file-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [
        csvFile('a.csv', VALID_SNAPSHOT_CSV),
        csvFile('b.csv', VALID_SNAPSHOT_CSV),
        csvFile('c.csv', VALID_SNAPSHOT_CSV),
      ],
      configurable: true,
    });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByText(/File 1 of 3/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /^commit/i }));
    await waitFor(() => expect(screen.getByText(/File 2 of 3/)).toBeInTheDocument());
  });

  it('shows an error pane for files that fail to read', async () => {
    render(<ImportCsvButton entity="snapshot" />);
    const goodFile = csvFile('good.csv', VALID_SNAPSHOT_CSV);
    const badFile = csvFile('bad.csv', VALID_SNAPSHOT_CSV);
    // Force the bad file's `.text()` to reject — simulates a file-read failure.
    Object.defineProperty(badFile, 'text', {
      value: () => Promise.reject(new Error('read failed')),
      configurable: true,
    });
    const input = screen.getByTestId('import-csv-file-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [goodFile, badFile],
      configurable: true,
    });
    fireEvent.change(input);
    // Error pane shows the bad filename.
    await waitFor(() => expect(screen.getByText(/bad\.csv/)).toBeInTheDocument());
    // The good file still opens a modal.
    expect(screen.getByText(/import account snapshots from csv/i)).toBeInTheDocument();
  });

  it('clicking Dismiss removes the error pane', async () => {
    render(<ImportCsvButton entity="snapshot" />);
    const badFile = csvFile('bad.csv', VALID_SNAPSHOT_CSV);
    Object.defineProperty(badFile, 'text', {
      value: () => Promise.reject(new Error('read failed')),
      configurable: true,
    });
    const input = screen.getByTestId('import-csv-file-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [badFile],
      configurable: true,
    });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByText(/bad\.csv/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    await waitFor(() => expect(screen.queryByText(/bad\.csv/)).toBeNull());
  });

  it('closing the modal via Cancel drops the remaining queue', async () => {
    render(<ImportCsvButton entity="snapshot" />);
    const input = screen.getByTestId('import-csv-file-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [
        csvFile('a.csv', VALID_SNAPSHOT_CSV),
        csvFile('b.csv', VALID_SNAPSHOT_CSV),
        csvFile('c.csv', VALID_SNAPSHOT_CSV),
      ],
      configurable: true,
    });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByText(/File 1 of 3/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    await waitFor(() => {
      expect(screen.queryByText(/File \d+ of \d+/)).toBeNull();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});
