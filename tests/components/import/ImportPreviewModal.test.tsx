import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImportPreviewModal } from '@/components/import/ImportPreviewModal';
import type { ParseResultLite } from '@/stores/import-preview-store';

vi.mock('@/lib/import/commit', () => ({
  commitSnapshotImport: vi.fn().mockResolvedValue({ inserted: 1, updated: 0, skipped: 0 }),
}));

vi.mock('@/stores/snapshots-store', () => ({
  useSnapshotsStore: Object.assign(
    (selector: (s: { load: () => Promise<void> }) => unknown) =>
      selector({ load: vi.fn().mockResolvedValue(undefined) }),
    { getState: () => ({ load: vi.fn().mockResolvedValue(undefined) }) },
  ),
}));

vi.mock('@/db/db', () => ({
  getDatabase: () => ({
    execute: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
    select: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

const accounts = [{ id: 1, name: 'Fidelity 401k' }];

const cleanParsed: ParseResultLite = {
  headers: ['account', 'snapshot_date', 'total_value'],
  rows: [{ account: 'Fidelity 401k', snapshot_date: '2023-06-30', total_value: '60000' }],
  errors: [],
};

const badParsed: ParseResultLite = {
  headers: ['account', 'snapshot_date', 'total_value'],
  rows: [{ account: 'Unknown', snapshot_date: '2023-06-30', total_value: '60000' }],
  errors: [],
};

describe('ImportPreviewModal — snapshot mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the modal title and a row when opened', () => {
    render(
      <ImportPreviewModal
        entity="snapshot"
        parsed={cleanParsed}
        ctx={{ accounts }}
        open
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/import account snapshots from csv/i)).toBeInTheDocument();
    expect(screen.getByText('Fidelity 401k')).toBeInTheDocument();
  });

  it('disables Commit when an error row is present', () => {
    render(
      <ImportPreviewModal
        entity="snapshot"
        parsed={badParsed}
        ctx={{ accounts }}
        open
        onOpenChange={vi.fn()}
      />,
    );
    const commit = screen.getByRole('button', { name: /^commit/i });
    expect(commit).toBeDisabled();
    expect(screen.getByText(/resolve 1 errors? before committing/i)).toBeInTheDocument();
  });

  it('commits and closes when Commit is clicked on a clean import', async () => {
    const onOpenChange = vi.fn();
    render(
      <ImportPreviewModal
        entity="snapshot"
        parsed={cleanParsed}
        ctx={{ accounts }}
        open
        onOpenChange={onOpenChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^commit/i }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const { commitSnapshotImport } = await import('@/lib/import/commit');
    expect(commitSnapshotImport).toHaveBeenCalled();
  });

  it('shows a parse-error banner when parsed.errors is non-empty', () => {
    const withParseErrors: ParseResultLite = {
      ...cleanParsed,
      errors: [{ line: 3, message: 'unterminated quoted string' }],
    };
    render(
      <ImportPreviewModal
        entity="snapshot"
        parsed={withParseErrors}
        ctx={{ accounts }}
        open
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/fix and re-upload/i)).toBeInTheDocument();
  });
});

describe('ImportPreviewModal queuePosition + onSaved props', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render "File N of M" when queuePosition is undefined', () => {
    render(
      <ImportPreviewModal
        entity="snapshot"
        parsed={cleanParsed}
        ctx={{ accounts }}
        open
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.queryByText(/File \d+ of \d+/)).toBeNull();
  });

  it('renders "File N of M" subtitle when queuePosition.total > 1', () => {
    render(
      <ImportPreviewModal
        entity="snapshot"
        parsed={cleanParsed}
        ctx={{ accounts }}
        open
        onOpenChange={vi.fn()}
        queuePosition={{ current: 2, total: 5 }}
      />,
    );
    expect(screen.getByText(/File 2 of 5/)).toBeInTheDocument();
  });

  it('does NOT render "File 1 of 1" when total is 1 (single-file caller)', () => {
    render(
      <ImportPreviewModal
        entity="snapshot"
        parsed={cleanParsed}
        ctx={{ accounts }}
        open
        onOpenChange={vi.fn()}
        queuePosition={{ current: 1, total: 1 }}
      />,
    );
    expect(screen.queryByText(/File 1 of 1/)).toBeNull();
  });

  it('calls onSaved (not onOpenChange(false)) after a successful commit when onSaved is provided', async () => {
    const onOpenChange = vi.fn();
    const onSaved = vi.fn();
    render(
      <ImportPreviewModal
        entity="snapshot"
        parsed={cleanParsed}
        ctx={{ accounts }}
        open
        onOpenChange={onOpenChange}
        onSaved={onSaved}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^commit/i }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('calls onOpenChange(false) after a successful commit when onSaved is NOT provided (backwards-compat)', async () => {
    const onOpenChange = vi.fn();
    render(
      <ImportPreviewModal
        entity="snapshot"
        parsed={cleanParsed}
        ctx={{ accounts }}
        open
        onOpenChange={onOpenChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^commit/i }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
