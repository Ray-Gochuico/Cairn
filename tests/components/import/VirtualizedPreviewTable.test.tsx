import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useStore } from 'zustand';
import { TransactionPreviewTable } from '@/components/import/TransactionPreviewTable';
import { HoldingPreviewTable } from '@/components/import/HoldingPreviewTable';
import {
  createImportPreviewStore,
  type ImportPreviewState,
  type ParseResultLite,
} from '@/stores/import-preview-store';

// ---------------------------------------------------------------------------
// Render-counting instrumentation.
//
// We spy on MerchantCell — a leaf each transaction row renders exactly once —
// and tally how many times it renders per merchant value. This lets us assert
// that editing one row does NOT re-render the (memoized) sibling rows.
// ---------------------------------------------------------------------------
const merchantRenders = new Map<string, number>();

vi.mock('@/components/import/MerchantCell', async () => {
  const actual = await vi.importActual<typeof import('@/components/import/MerchantCell')>(
    '@/components/import/MerchantCell',
  );
  return {
    MerchantCell: (props: Parameters<typeof actual.MerchantCell>[0]) => {
      merchantRenders.set(props.value, (merchantRenders.get(props.value) ?? 0) + 1);
      return actual.MerchantCell(props);
    },
  };
});

const txnCtx = {
  accounts: [{ id: 1, name: 'Checking' }],
  categories: [{ id: 1, name: 'Groceries' }],
};

function makeTxnRows(n: number): ParseResultLite {
  const rows = Array.from({ length: n }, (_, i) => ({
    date: '2024-03-15',
    account: 'Checking',
    amount: String(10 + i),
    merchant: `MERCHANT_${i}`,
    category: 'Groceries',
    reimbursable: 'no',
  }));
  return {
    headers: ['date', 'account', 'amount', 'merchant', 'category', 'reimbursable'],
    rows,
    errors: [],
  };
}

function TxnHarness({ store }: { store: ReturnType<typeof createImportPreviewStore<'transaction'>> }) {
  const state = useStore(store);
  return <TransactionPreviewTable state={state as ImportPreviewState<'transaction'>} />;
}

describe('VirtualizedPreviewTable — windowing', () => {
  it('mounts only a windowed subset of rows for a large import (not all 5000)', () => {
    const store = createImportPreviewStore('transaction', makeTxnRows(5000), txnCtx);
    render(<TxnHarness store={store} />);

    const table = screen.getByRole('table');
    const bodyRows = table.querySelectorAll('tbody tr').length;

    // The jsdom fallback gives the scroll parent a finite 1000x800 viewport,
    // so the virtualizer windows: a generous bound is <50 mounted <tr>s
    // (~18 visible + 2*8 overscan + up to 2 spacer rows), proving the DOM is
    // CLIPPED and we are not mounting all 5000 rows.
    expect(bodyRows).toBeLessThan(50);
    // Sanity: the dataset really has 5000 rows logically (we clipped the DOM,
    // we did not slice the data).
    expect(store.getState().derivedRows.length).toBe(5000);
  });

  it('renders the visible rows via the jsdom-viewport fallback (small set mounts fully)', () => {
    const store = createImportPreviewStore('transaction', makeTxnRows(3), txnCtx);
    render(<TxnHarness store={store} />);
    // All three small-set rows are inside the 800px fallback window, so every
    // existing getByText-style assertion keeps working.
    expect(screen.getByText('MERCHANT_0')).toBeInTheDocument();
    expect(screen.getByText('MERCHANT_1')).toBeInTheDocument();
    expect(screen.getByText('MERCHANT_2')).toBeInTheDocument();
  });

  it('windowed rows still carry a stable padding spacer for scroll height', () => {
    const store = createImportPreviewStore('transaction', makeTxnRows(5000), txnCtx);
    render(<TxnHarness store={store} />);
    const table = screen.getByRole('table');
    // At the top of the list there is a bottom spacer (aria-hidden) holding the
    // height of the ~4970 un-mounted rows so the scrollbar stays accurate.
    const spacers = table.querySelectorAll('tbody tr[aria-hidden="true"]');
    expect(spacers.length).toBeGreaterThan(0);
  });
});

describe('VirtualizedPreviewTable — per-row React.memo', () => {
  it('editing one row does not re-render the other (memoized) rows', () => {
    merchantRenders.clear();
    const store = createImportPreviewStore('transaction', makeTxnRows(3), txnCtx);
    render(<TxnHarness store={store} />);

    // Each of the three rows rendered its MerchantCell once on mount.
    expect(merchantRenders.get('MERCHANT_0')).toBe(1);
    expect(merchantRenders.get('MERCHANT_1')).toBe(1);
    expect(merchantRenders.get('MERCHANT_2')).toBe(1);

    // Edit ONLY row 0's amount (a different field, so MERCHANT_0's cell value
    // is unchanged but row 0's PreviewRow identity changes).
    act(() => {
      store.getState().edit(0, { amount: '999' });
    });

    // Row 0 re-rendered (its PreviewRow changed) — so its MerchantCell ran
    // again (>1; the virtualizer's post-update layout effect can add an extra
    // pass for mounted rows, so we assert "increased", not an exact count).
    expect(merchantRenders.get('MERCHANT_0')).toBeGreaterThan(1);
    // The invariant under test: rows 1 and 2 were untouched, so the store's
    // identity cache kept their PreviewRow references stable and React.memo
    // skipped them ENTIRELY — their render count must be frozen at the mount
    // value of 1. (Without the memo + stable-identity cache this would be 2+.)
    expect(merchantRenders.get('MERCHANT_1')).toBe(1);
    expect(merchantRenders.get('MERCHANT_2')).toBe(1);
  });

  it('keeps the edited value flowing through (memo does not stale the row)', () => {
    const store = createImportPreviewStore('transaction', makeTxnRows(3), txnCtx);
    render(<TxnHarness store={store} />);
    act(() => {
      store.getState().edit(1, { merchant: 'RENAMED' });
    });
    expect(screen.getByText('RENAMED')).toBeInTheDocument();
    expect(screen.queryByText('MERCHANT_1')).not.toBeInTheDocument();
  });
});

// A second entity exercises the shared wrapper with the inline-row table shape
// (Holding has no dedicated Row component file — its row is defined inline and
// memoized in HoldingPreviewTable).
describe('VirtualizedPreviewTable — shared wrapper across entities', () => {
  const holdingCtx = {
    accounts: [{ id: 10, name: 'Brokerage' }],
    persons: [],
    categories: [],
    properties: [],
    vehicles: [],
  };

  function HoldingHarness({ store }: { store: ReturnType<typeof createImportPreviewStore<'holding'>> }) {
    const state = useStore(store);
    return <HoldingPreviewTable state={state as ImportPreviewState<'holding'>} />;
  }

  it('windows a large holding import the same way', () => {
    const rows = Array.from({ length: 4000 }, (_, i) => ({
      account_name: 'Brokerage',
      ticker: `TIC${i}`,
      share_count: '10',
      cost_basis_per_share: '100',
    }));
    const store = createImportPreviewStore(
      'holding',
      { headers: Object.keys(rows[0]), rows, errors: [] },
      holdingCtx,
    );
    render(<HoldingHarness store={store} />);
    const table = screen.getByRole('table');
    expect(table.querySelectorAll('tbody tr').length).toBeLessThan(50);
    expect(store.getState().derivedRows.length).toBe(4000);
  });
});
