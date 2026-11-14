import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Same module mocks as tests/components/import/ImportCsvButton.test.tsx, with a
// controllable select so the snapshots store's real load() can run.
const select = vi.fn();
vi.mock('@/lib/import/commit', () => ({
  commitSnapshotImport: vi.fn().mockResolvedValue({ inserted: 1, updated: 0, skipped: 0 }),
}));
vi.mock('@/lib/csv', () => ({ downloadCsv: vi.fn() }));
vi.mock('@/db/db', () => ({
  getDatabase: () => ({
    execute: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
    select,
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

import { ImportCsvButton } from '@/components/import/ImportCsvButton';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';

const CSV =
  'account,snapshot_date,total_value\n' +
  'Fidelity 401k,2023-06-30,60000\n' +
  'Fidelity 401k,2023-07-31,61000\n';

describe('v1.8.0 O1 (RC1): a store reload behind an open import preview keeps its edits', () => {
  beforeEach(() => {
    select.mockReset();
    select.mockResolvedValue([]);
    useAccountsStore.setState({ accounts: [{ id: 1, name: 'Fidelity 401k' } as never] });
    useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null });
  });

  it('the market refresh\'s snapshots reload keeps a cell edit and re-checks every row against the reloaded snapshots', async () => {
    const user = userEvent.setup();
    render(<ImportCsvButton entity="snapshot" />);
    const input = screen.getByTestId('import-csv-file-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File([CSV], 'snap.csv', { type: 'text/csv' })] });
    fireEvent.change(input);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    expect(screen.getByText('2 new')).toBeInTheDocument();
    await user.click(screen.getByText('60000'));
    const cell = screen.getByDisplayValue('60000');
    await user.clear(cell);
    await user.type(cell, '60500{Enter}');
    expect(screen.getByText('60500')).toBeInTheDocument();

    // What run-market-data-refresh.ts does after the daily snapshot upserts a row.
    select.mockResolvedValue([
      { id: 9, account_id: 1, snapshot_date: '2023-07-31', total_value: 59000, source: 'AUTO_DERIVED' },
    ]);
    await act(async () => {
      await useSnapshotsStore.getState().load();
    });

    expect(screen.getByText('60500')).toBeInTheDocument();
    expect(screen.queryByText('60000')).toBeNull();
    expect(screen.getByText('1 new')).toBeInTheDocument();
    expect(screen.getByText('1 update')).toBeInTheDocument();
  });
});
