import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImportCsvButton } from '@/components/import/ImportCsvButton';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';

vi.mock('@/lib/import/commit', () => ({
  commitSnapshotImport: vi.fn().mockResolvedValue({ inserted: 1, updated: 0, skipped: 0 }),
}));

vi.mock('@/lib/csv', () => ({
  downloadCsv: vi.fn(),
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

  it('skipping file 1 of N does NOT silently drop the remaining files (M4)', async () => {
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

    // The per-file dismiss is "Skip this file" (not a bulk Cancel) when a
    // batch is queued — and it advances to the next file instead of dropping.
    fireEvent.click(screen.getByRole('button', { name: /skip this file/i }));
    await waitFor(() => expect(screen.getByText(/File 2 of 3/)).toBeInTheDocument());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('offers an explicit "Cancel all" that drops the whole remaining batch (M4)', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: /cancel all/i }));
    await waitFor(() => {
      expect(screen.queryByText(/File \d+ of \d+/)).toBeNull();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('single-file Cancel closes the modal (no batch, plain Cancel)', async () => {
    render(<ImportCsvButton entity="snapshot" />);
    const input = screen.getByTestId('import-csv-file-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', {
      value: [csvFile('a.csv', VALID_SNAPSHOT_CSV)],
      configurable: true,
    });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    // No batch → a single "Cancel" (no "Skip this file"/"Cancel all" split).
    expect(screen.queryByRole('button', { name: /skip this file/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /cancel all/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });
});

describe('ImportCsvButton template downloads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAccountsStore.setState({
      accounts: [{ id: 1, name: 'Fidelity 401k' } as never],
    });
    useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null });
  });

  it('does NOT render a Download template link for snapshot (no template defined)', () => {
    render(<ImportCsvButton entity="snapshot" />);
    expect(screen.queryByTestId('download-template-link')).toBeNull();
  });

  it('does NOT render a Download template link for transaction', () => {
    render(<ImportCsvButton entity="transaction" />);
    expect(screen.queryByTestId('download-template-link')).toBeNull();
  });

  it('renders a Download template link for entity=account and calls downloadCsv with account-template.csv', async () => {
    render(<ImportCsvButton entity="account" />);
    const link = screen.getByTestId('download-template-link');
    expect(link).toHaveTextContent(/Download account template/i);
    fireEvent.click(link);
    const { downloadCsv } = await import('@/lib/csv') as unknown as { downloadCsv: ReturnType<typeof vi.fn> };
    expect(downloadCsv).toHaveBeenCalledTimes(1);
    expect(downloadCsv).toHaveBeenCalledWith(
      'account-template.csv',
      expect.stringContaining('name'),
    );
  });

  it('uses the correct filename per entity (loan)', async () => {
    render(<ImportCsvButton entity="loan" />);
    fireEvent.click(screen.getByTestId('download-template-link'));
    const { downloadCsv } = await import('@/lib/csv') as unknown as { downloadCsv: ReturnType<typeof vi.fn> };
    expect(downloadCsv).toHaveBeenCalledWith(
      'loan-template.csv',
      expect.stringContaining('term_months'),
    );
  });

  it('emits the equity_grant template with vesting_schedule_json in the header', async () => {
    render(<ImportCsvButton entity="equity_grant" />);
    fireEvent.click(screen.getByTestId('download-template-link'));
    const { downloadCsv } = await import('@/lib/csv') as unknown as { downloadCsv: ReturnType<typeof vi.fn> };
    expect(downloadCsv).toHaveBeenCalledWith(
      'equity_grant-template.csv',
      expect.stringContaining('vesting_schedule_json'),
    );
  });
});
