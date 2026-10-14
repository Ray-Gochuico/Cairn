import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

/**
 * v1.8.0 O2 (CR-O-3): the import preview is reachable from onboarding (the
 * worded Accounts/Home/Vehicles/Equity/Loans/Import gates and every form-view
 * section), and a dismissal there means "Skip this file"
 * (ImportCsvButton.tsx:301-308, TransactionsSectionImporter.tsx:316-320). It
 * no longer skips on an overlay pointer-down, and once its rows are edited
 * Escape asks first.
 */

const ASK = 'Discard unsaved entries?';
const accounts = [{ id: 1, name: 'Fidelity 401k' }];

const twoRows: ParseResultLite = {
  headers: ['account', 'snapshot_date', 'total_value'],
  rows: [
    { account: 'Fidelity 401k', snapshot_date: '2023-06-30', total_value: '60000' },
    { account: 'Fidelity 401k', snapshot_date: '2023-07-31', total_value: '61000' },
  ],
  errors: [],
};

/** Radix adds its document pointerdown listener on a setTimeout(0). */
async function settleRadixListeners() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}

function renderModal(ctx: Record<string, unknown> = { accounts }) {
  const onOpenChange = vi.fn();
  render(
    <ImportPreviewModal
      entity="snapshot"
      parsed={twoRows}
      ctx={ctx as never}
      open
      onOpenChange={onOpenChange}
      queuePosition={{ current: 1, total: 2 }}
      queueLength={2}
      onCancelAll={vi.fn()}
    />,
  );
  return { onOpenChange, user: userEvent.setup() };
}

describe('ImportPreviewModal — keeps row edits (CR-O-3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('a pointer-down on the overlay never skips the file', async () => {
    const { onOpenChange } = renderModal();
    await settleRadixListeners();
    fireEvent.pointerDown(document.querySelector('[data-state="open"].fixed.inset-0')!);
    expect(screen.getByRole('dialog', { name: 'Import account snapshots from CSV' })).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('Escape on an untouched preview skips the file at once, as before', async () => {
    const { onOpenChange, user } = renderModal();
    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('dialog', { name: ASK })).toBeNull();
  });

  it('after Remove row (no field event behind it), Escape asks; Stay keeps the removal; Discard entries skips the file', async () => {
    const { onOpenChange, user } = renderModal();
    await user.click(screen.getAllByRole('button', { name: 'Remove row' })[0]);
    expect(screen.getByRole('button', { name: 'Commit (1 rows)' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(await screen.findByRole('dialog', { name: ASK })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stay' }));
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Commit (1 rows)' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await screen.findByRole('dialog', { name: ASK });
    await user.click(screen.getByRole('button', { name: 'Discard entries' }));
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('a bulk conflict choice (Skip all, no field event) makes Escape ask', async () => {
    const { onOpenChange, user } = renderModal({
      accounts,
      existingSnapshots: new Map([['1|2023-06-30', 59000]]),
    });
    expect(screen.getByRole('button', { name: 'Commit (2 rows)' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Skip all' }));
    expect(screen.getByRole('button', { name: 'Commit (1 rows)' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(await screen.findByRole('dialog', { name: ASK })).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('a committed value-cell edit (typed, then Enter) alone makes Escape ask; Stay keeps it', async () => {
    const { onOpenChange, user } = renderModal();
    await user.click(screen.getByText('60000'));
    await user.type(screen.getByDisplayValue('60000'), '1{Enter}');
    expect(screen.getByText('600001')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(await screen.findByRole('dialog', { name: ASK })).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Stay' }));
    expect(screen.getByText('600001')).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('a value-cell edit committed by leaving the cell (blur) alone makes Escape ask', async () => {
    const { onOpenChange, user } = renderModal();
    await user.click(screen.getByText('60000'));
    await user.type(screen.getByDisplayValue('60000'), '1');
    await user.click(screen.getByRole('heading', { name: 'Import account snapshots from CSV' }));
    expect(screen.getByText('600001')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(await screen.findByRole('dialog', { name: ASK })).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('a per-row native select pick (an account Type) alone makes Escape ask', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ImportPreviewModal
        entity="account"
        parsed={{ headers: ['name', 'type'], rows: [{ name: 'Chase Checking', type: 'ACCOUNT_CASH' }], errors: [] }}
        ctx={{ accounts: [] } as never}
        open
        onOpenChange={onOpenChange}
      />,
    );
    const type = screen.getByDisplayValue('ACCOUNT_CASH') as HTMLSelectElement;
    await user.selectOptions(type, 'ACCOUNT_BROKERAGE');
    expect(type.value).toBe('ACCOUNT_BROKERAGE');
    await user.keyboard('{Escape}');
    expect(await screen.findByRole('dialog', { name: ASK })).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('the next file of a batch, shown in the same open dialog, starts pristine', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    const props = {
      entity: 'snapshot' as const, ctx: { accounts } as never, open: true, onOpenChange,
      queueLength: 2, onCancelAll: vi.fn(),
    };
    const view = render(<ImportPreviewModal {...props} parsed={twoRows} queuePosition={{ current: 1, total: 2 }} />);
    // File 1: a typed cell edit (input events and a store edit), then a removal.
    await user.click(screen.getByText('60000'));
    await user.type(screen.getByDisplayValue('60000'), '1{Enter}');
    await user.click(screen.getAllByRole('button', { name: 'Remove row' })[0]);
    // The queue advances: the same modal instance gets file 2 (ImportCsvButton.tsx:295-313).
    view.rerender(
      <ImportPreviewModal
        {...props}
        parsed={{ ...twoRows, rows: [{ account: 'Fidelity 401k', snapshot_date: '2023-08-31', total_value: '62000' }] }}
        queuePosition={{ current: 2, total: 2 }}
        queueLength={1}
      />,
    );
    expect(screen.getByRole('button', { name: 'Commit (1 rows)' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: ASK })).toBeNull();
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('Skip this file stays an immediate, explicit skip', async () => {
    const { onOpenChange, user } = renderModal();
    await user.click(screen.getAllByRole('button', { name: 'Remove row' })[0]);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Skip this file' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('dialog', { name: ASK })).toBeNull();
  });
});
