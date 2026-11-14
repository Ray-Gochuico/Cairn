import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ImportPreviewModal } from '@/components/import/ImportPreviewModal';
import { commitSnapshotImport } from '@/lib/import/commit';
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

  it('Escape while file 1 is still committing: the commit moving the batch on to file 2 closes the question, and file 2 is not skipped', async () => {
    let release: () => void = () => {};
    vi.mocked(commitSnapshotImport).mockImplementationOnce(
      () => new Promise((r) => { release = () => r({ inserted: 1, updated: 0, skipped: 0 } as never); }) as never,
    );
    const skipped: string[] = [];
    const committed: string[] = [];
    const fileB: ParseResultLite = { ...twoRows, rows: [{ account: 'Fidelity 401k', snapshot_date: '2024-01-31', total_value: '77777' }] };
    /** The ImportCsvButton / TransactionsSectionImporter queue: one modal
     *  instance, no key; a save and a dismissal both advance the queue. */
    function Queue() {
      const [queue, setQueue] = useState([
        { name: 'a.csv', parsed: twoRows },
        { name: 'b.csv', parsed: fileB },
      ]);
      const current = queue[0];
      const advance = () => setQueue((q) => q.slice(1));
      if (!current) return <p>queue empty</p>;
      return (
        <ImportPreviewModal
          entity="snapshot"
          parsed={current.parsed}
          ctx={{ accounts } as never}
          open
          onOpenChange={(o) => { if (!o) { skipped.push(current.name); advance(); } }}
          queuePosition={{ current: 3 - queue.length, total: 2 }}
          queueLength={queue.length}
          onCancelAll={() => setQueue([])}
          onSaved={() => { committed.push(current.name); advance(); }}
        />
      );
    }
    const user = userEvent.setup();
    render(<Queue />);
    await user.click(screen.getAllByRole('button', { name: 'Remove row' })[0]);
    await user.click(screen.getByRole('button', { name: 'Commit (1 rows)' }));
    await waitFor(() => expect(commitSnapshotImport).toHaveBeenCalledTimes(1));
    await user.keyboard('{Escape}');
    await screen.findByRole('dialog', { name: ASK });
    await act(async () => {
      release();
    });
    await screen.findByText('77777');
    expect(committed).toEqual(['a.csv']);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: ASK })).toBeNull());
    expect(skipped).toEqual([]);
    expect(screen.getByRole('dialog', { name: 'Import account snapshots from CSV' })).toBeInTheDocument();
  });

  it('Skip this file stays an immediate, explicit skip', async () => {
    const { onOpenChange, user } = renderModal();
    await user.click(screen.getAllByRole('button', { name: 'Remove row' })[0]);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Skip this file' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('dialog', { name: ASK })).toBeNull();
  });
});

describe("ImportPreviewModal — a cell's own Escape (CR-O-3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    { cell: 'value', from: '60000', field: () => screen.getByText('60000') },
    { cell: 'date', from: '2023-06-30', field: () => screen.getByText('2023-06-30') },
  ])("Escape while editing the $cell cell cancels only that edit: the file is not skipped and nothing is asked", async ({ from, field }) => {
    const { onOpenChange, user } = renderModal();
    await user.click(field());
    const input = screen.getByDisplayValue(from);
    await user.type(input, '9');
    expect(screen.getByDisplayValue(`${from}9`)).toBe(input);
    await user.keyboard('{Escape}');
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: ASK })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Import account snapshots from CSV' })).toBeInTheDocument();
    expect(screen.queryByDisplayValue(`${from}9`)).toBeNull();
    expect(screen.getByText(from)).toBeInTheDocument();
  });

  const txHeaders = ['date', 'account', 'amount', 'merchant', 'category', 'reimbursable'];
  const txCtx = { accounts: [{ id: 1, name: 'Checking' }], categories: [{ id: 1, name: 'Groceries' }] };
  it.each([
    {
      cell: 'value', entity: 'snapshot' as const, ctx: { accounts },
      parsed: { ...twoRows, rows: [{ account: 'Fidelity 401k', snapshot_date: '2023-06-30', total_value: 'abc' }] },
    },
    {
      cell: 'date', entity: 'snapshot' as const, ctx: { accounts },
      parsed: { ...twoRows, rows: [{ account: 'Fidelity 401k', snapshot_date: 'June 30', total_value: '60000' }] },
    },
    {
      cell: 'merchant', entity: 'transaction' as const, ctx: txCtx,
      parsed: {
        headers: txHeaders,
        rows: [{ date: '2024-03-15', account: 'Checking', amount: '20.00', merchant: '', category: 'Groceries', reimbursable: 'no' }],
        errors: [],
      },
    },
  ])('an untouched file whose $cell cell has an error (it opens focused for a fix) still skips at once on Escape', async ({ entity, parsed, ctx }) => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<ImportPreviewModal entity={entity} parsed={parsed} ctx={ctx as never} open onOpenChange={onOpenChange} />);
    expect(document.activeElement?.tagName).toBe('INPUT');
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: ASK })).toBeNull();
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('a fix typed into an error cell: the first Escape reverts only the cell, the next one skips the untouched file', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ImportPreviewModal
        entity="snapshot"
        parsed={{ ...twoRows, rows: [{ account: 'Fidelity 401k', snapshot_date: '2023-06-30', total_value: 'abc' }] }}
        ctx={{ accounts } as never}
        open
        onOpenChange={onOpenChange}
      />,
    );
    await user.type(screen.getByDisplayValue('abc'), '1');
    expect(screen.getByDisplayValue('abc1')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('abc')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: ASK })).toBeNull();
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('Escape while editing a transaction merchant cancels only that edit', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ImportPreviewModal
        entity="transaction"
        parsed={{
          headers: ['date', 'account', 'amount', 'merchant', 'category', 'reimbursable'],
          rows: [{ date: '2024-03-15', account: 'Checking', amount: '20.00', merchant: 'STARBUCKS', category: 'Groceries', reimbursable: 'no' }],
          errors: [],
        }}
        ctx={{ accounts: [{ id: 1, name: 'Checking' }], categories: [{ id: 1, name: 'Groceries' }] } as never}
        open
        onOpenChange={onOpenChange}
      />,
    );
    await user.click(screen.getByText('STARBUCKS'));
    await user.type(screen.getByDisplayValue('STARBUCKS'), 'X');
    await user.keyboard('{Escape}');
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: ASK })).toBeNull();
    expect(screen.queryByDisplayValue('STARBUCKSX')).toBeNull();
    expect(screen.getByText('STARBUCKS')).toBeInTheDocument();
  });
});

describe('ImportPreviewModal — row edits survive Flip signs (STOP-B, CR-O-2 × CR-O-3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('a committed merchant edit, then Flip signs: Escape still asks, and Stay keeps the edit', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ImportPreviewModal
        entity="transaction"
        parsed={{
          headers: ['date', 'account', 'amount', 'merchant', 'category', 'reimbursable'],
          rows: [{ date: '2024-03-15', account: 'Checking', amount: '-20.00', merchant: 'STARBUCKS', category: 'Groceries', reimbursable: 'no' }],
          errors: [],
        }}
        ctx={{ accounts: [{ id: 1, name: 'Checking' }], categories: [{ id: 1, name: 'Groceries' }] } as never}
        open
        onOpenChange={onOpenChange}
      />,
    );
    await user.click(screen.getByText('STARBUCKS'));
    await user.type(screen.getByDisplayValue('STARBUCKS'), 'X{Enter}');
    expect(screen.getByText('STARBUCKSX')).toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: /Flip signs/ }));
    expect(screen.getByRole('checkbox', { name: /Flip signs/ })).toBeChecked();
    await user.keyboard('{Escape}');
    expect(await screen.findByRole('dialog', { name: ASK })).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Stay' }));
    expect(screen.getByText('STARBUCKSX')).toBeInTheDocument();
  });

  it('Flip signs alone is not a row edit (D-O2-8): Escape on an otherwise untouched file skips it at once, with no question', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(
      <ImportPreviewModal
        entity="transaction"
        parsed={{
          headers: ['date', 'account', 'amount', 'merchant', 'category', 'reimbursable'],
          rows: [{ date: '2024-03-15', account: 'Checking', amount: '-12.00', merchant: 'STARBUCKS', category: 'Groceries', reimbursable: 'no' }],
          errors: [],
        }}
        ctx={{ accounts: [{ id: 1, name: 'Checking' }], categories: [{ id: 1, name: 'Groceries' }] } as never}
        open
        onOpenChange={onOpenChange}
      />,
    );
    await user.click(screen.getByRole('checkbox', { name: /Flip signs/ }));
    expect(screen.getByRole('checkbox', { name: /Flip signs/ })).toBeChecked();
    expect(await screen.findByText('→ 12.00')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: ASK })).toBeNull();
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
