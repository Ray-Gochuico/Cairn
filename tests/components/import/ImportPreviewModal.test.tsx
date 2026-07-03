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
    // Wave-4: the queue position is a live region so batch advancement is
    // announced as the modal re-renders for each file.
    expect(screen.getByRole('status')).toHaveTextContent('File 2 of 5');
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

describe('ImportPreviewModal — N2 entity routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseCtx = {
    accounts: [{ id: 10, name: 'Brokerage' }],
    persons: [{ id: 1, name: 'Alice' }],
    categories: [],
    properties: [{ id: 5, name: 'Main Residence' }],
    vehicles: [{ id: 9, name: 'Daily' }],
  };

  it('renders AccountPreviewTable when entity=account (shows the Type column)', () => {
    render(
      <ImportPreviewModal
        entity="account"
        parsed={{
          headers: ['name', 'type'],
          rows: [{ name: 'Chase Checking', type: 'ACCOUNT_CASH' }],
          errors: [],
        }}
        ctx={baseCtx}
        open
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/Import accounts from CSV/i)).toBeInTheDocument();
    expect(screen.getByText('Type')).toBeInTheDocument();
  });

  it('renders HoldingPreviewTable when entity=holding', () => {
    render(
      <ImportPreviewModal
        entity="holding"
        parsed={{
          headers: ['account_name', 'ticker', 'share_count'],
          rows: [{ account_name: 'Brokerage', ticker: 'AAPL', share_count: '10' }],
          errors: [],
        }}
        ctx={baseCtx}
        open
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Ticker')).toBeInTheDocument();
  });

  it('renders LoanPreviewTable when entity=loan', () => {
    render(
      <ImportPreviewModal
        entity="loan"
        parsed={{
          headers: ['name'],
          rows: [{ name: 'X' }],
          errors: [],
        }}
        ctx={baseCtx}
        open
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Term')).toBeInTheDocument();
  });

  it('renders PropertyPreviewTable when entity=property', () => {
    render(
      <ImportPreviewModal
        entity="property"
        parsed={{
          headers: ['name'],
          rows: [{ name: 'X' }],
          errors: [],
        }}
        ctx={baseCtx}
        open
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Est. value')).toBeInTheDocument();
  });

  it('renders VehiclePreviewTable when entity=vehicle', () => {
    render(
      <ImportPreviewModal
        entity="vehicle"
        parsed={{
          headers: ['name'],
          rows: [{ name: 'X' }],
          errors: [],
        }}
        ctx={baseCtx}
        open
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/Make \/ Model \/ Year/)).toBeInTheDocument();
  });

  it('renders EquityGrantPreviewTable when entity=equity_grant', () => {
    render(
      <ImportPreviewModal
        entity="equity_grant"
        parsed={{
          headers: ['name'],
          rows: [{ name: 'X' }],
          errors: [],
        }}
        ctx={baseCtx}
        open
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Vesting')).toBeInTheDocument();
  });

  it('renders ContributionPreviewTable when entity=contribution', () => {
    render(
      <ImportPreviewModal
        entity="contribution"
        parsed={{
          headers: ['account_name'],
          rows: [{ account_name: 'Brokerage' }],
          errors: [],
        }}
        ctx={baseCtx}
        open
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Source')).toBeInTheDocument();
  });

  it('renders AssetValueSnapshotPreviewTable when entity=asset_value_snapshot', () => {
    render(
      <ImportPreviewModal
        entity="asset_value_snapshot"
        parsed={{
          headers: ['owner_type'],
          rows: [{ owner_type: 'PROPERTY' }],
          errors: [],
        }}
        ctx={baseCtx}
        open
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Owner type')).toBeInTheDocument();
  });
});

describe('ImportPreviewModal — parse-error line list (L3 truncation)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('truncates the inline line list to 10 + "and N more" on a heavily malformed CSV', () => {
    const manyErrors: ParseResultLite = {
      headers: ['account', 'snapshot_date', 'total_value'],
      rows: [],
      errors: Array.from({ length: 15 }, (_, i) => ({
        line: i + 2,
        message: 'wrong column count',
      })),
    };
    render(
      <ImportPreviewModal
        entity="snapshot"
        parsed={manyErrors}
        ctx={{ accounts }}
        open
        onOpenChange={vi.fn()}
      />,
    );
    // First ten line numbers listed, then a "and 5 more" summary.
    expect(screen.getByText(/and 5 more/i)).toBeInTheDocument();
    // The 15th line number must NOT be dumped inline.
    expect(screen.queryByText(/\b16\b/)).toBeNull();
  });
});

describe('ImportPreviewModal — batch dismiss controls (M4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('splits Cancel into "Skip this file" + "Cancel all" when queueLength > 1', () => {
    const onCancelAll = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ImportPreviewModal
        entity="snapshot"
        parsed={cleanParsed}
        ctx={{ accounts }}
        open
        onOpenChange={onOpenChange}
        queueLength={3}
        onCancelAll={onCancelAll}
        onSaved={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /skip this file/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onCancelAll).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /cancel all 3 files/i }));
    expect(onCancelAll).toHaveBeenCalledTimes(1);
  });

  it('shows a single Cancel when queueLength is 1 (no batch split)', () => {
    render(
      <ImportPreviewModal
        entity="snapshot"
        parsed={cleanParsed}
        ctx={{ accounts }}
        open
        onOpenChange={vi.fn()}
        queueLength={1}
      />,
    );
    expect(screen.queryByRole('button', { name: /skip this file/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /cancel all/i })).toBeNull();
    expect(screen.getByRole('button', { name: /^cancel$/i })).toBeInTheDocument();
  });
});
