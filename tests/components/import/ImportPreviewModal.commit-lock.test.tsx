/**
 * v1.8.0 W4 (PG-4, task_90fd839b PRIORITY; C041): while a CSV commit is in
 * flight, nothing dismisses the import preview.
 *
 * Only the Commit button was disabled. Skip this file, Cancel all, Cancel,
 * the X and Escape all still reached onOpenChange(false): the "skipped" file
 * was saved anyway (nothing aborts the write), the queue moved to file 2, and
 * when file 1's commit landed its onSaved advanced the queue again, so file 2
 * vanished unreviewed.
 *
 * The real ImportCsvButton (balance snapshots) with the commit held open.
 * Clock-free.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({ release: null as (() => void) | null }));

vi.mock('@/lib/import/commit', () => ({
  commitTransactionImport: vi.fn(),
  commitSnapshotImport: vi.fn(
    () => new Promise((resolve) => { h.release = () => resolve({ inserted: 2, updated: 0, skipped: 0 }); }),
  ),
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

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportCsvButton } from '@/components/import/ImportCsvButton';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';

const ASK = 'Discard unsaved entries?';
const csv = (a: string, b: string) =>
  `account,snapshot_date,total_value\nFidelity 401k,2026-09-30,${a}\nFidelity 401k,2026-10-31,${b}\n`;

async function startCommit(files: 1 | 2, opts: { removeARow?: boolean } = {}) {
  const user = userEvent.setup();
  render(<ImportCsvButton entity="snapshot" />);
  const input = screen.getByTestId('import-csv-file-input') as HTMLInputElement;
  const list = [new File([csv('1000', '1100')], 'october.csv', { type: 'text/csv' })];
  if (files === 2) list.push(new File([csv('2000', '2100')], 'november.csv', { type: 'text/csv' }));
  fireEvent.change(input, { target: { files: list } });
  await screen.findByRole('dialog');
  if (files === 2) expect(screen.getByText(/File 1 of 2/)).toBeInTheDocument();
  if (opts.removeARow) await user.click(screen.getAllByRole('button', { name: 'Remove row' })[0]);
  await user.click(screen.getByRole('button', { name: /^Commit \(/ }));
  await waitFor(() => expect(h.release).not.toBeNull());
  expect(screen.getByRole('button', { name: 'Committing…' })).toBeDisabled();
  return { user };
}

/** Releases the held commit, then flushes one 50 ms macrotask so every
 *  microtask continuation of the commit (onSaved, the queue advance) has run
 *  before a "nothing more happens" check. Positive checks after it still
 *  poll (findBy / waitFor), so a later macrotask cannot make them flaky. */
async function land() {
  await act(async () => { h.release!(); });
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
}

describe('CSV import preview: locked while its commit is in flight (PG-4, C041)', () => {
  beforeEach(() => {
    h.release = null;
    useAccountsStore.setState({ accounts: [{ id: 1, name: 'Fidelity 401k' } as never] });
    useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null });
  });

  it('the X mid-commit does nothing; once file 1 lands, file 2 of 2 opens and stays', async () => {
    const { user } = await startCommit(2);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByText(/File 1 of 2/)).toBeInTheDocument();
    expect(screen.getByText('1000')).toBeInTheDocument();
    await land();
    expect(await screen.findByText(/File 2 of 2/)).toBeInTheDocument();
    expect(screen.getByText('2000')).toBeInTheDocument();
  });

  it('Escape mid-commit on an untouched preview does nothing; file 2 of 2 follows and stays', async () => {
    const { user } = await startCommit(2);
    await user.keyboard('{Escape}');
    expect(screen.getByText(/File 1 of 2/)).toBeInTheDocument();
    await land();
    expect(await screen.findByText(/File 2 of 2/)).toBeInTheDocument();
    expect(screen.getByText('2000')).toBeInTheDocument();
  });

  it('Escape mid-commit after a row edit asks nothing', async () => {
    const { user } = await startCommit(2, { removeARow: true });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: ASK })).toBeNull();
    expect(screen.getByText(/File 1 of 2/)).toBeInTheDocument();
    await land();
    expect(await screen.findByText(/File 2 of 2/)).toBeInTheDocument();
  });

  it('in a batch, Skip this file and Cancel all are disabled mid-commit, and live again on file 2', async () => {
    await startCommit(2);
    expect(screen.getByRole('button', { name: 'Skip this file' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel all 2 files' })).toBeDisabled();
    await land();
    expect(await screen.findByText(/File 2 of 2/)).toBeInTheDocument();
    // File 2 is the last one, so its footer offers a plain Cancel.
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });

  it('a single file: Cancel is disabled mid-commit, and the preview closes once the commit lands', async () => {
    await startCommit(1);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await land();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
