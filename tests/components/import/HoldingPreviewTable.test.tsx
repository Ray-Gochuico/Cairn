import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HoldingPreviewTable } from '@/components/import/HoldingPreviewTable';
import { createImportPreviewStore, type ImportPreviewState } from '@/stores/import-preview-store';
import { useStore } from 'zustand';

function setup(rows: Array<Record<string, string>>) {
  return createImportPreviewStore(
    'holding',
    { headers: Object.keys(rows[0] ?? {}), rows, errors: [] },
    {
      accounts: [{ id: 10, name: 'Brokerage' }],
      persons: [],
      categories: [],
      properties: [],
      vehicles: [],
    },
  );
}

function Render({ store }: { store: ReturnType<typeof setup> }) {
  const state = useStore(store);
  return <HoldingPreviewTable state={state as ImportPreviewState<'holding'>} />;
}

describe('HoldingPreviewTable', () => {
  it('renders one row per row', () => {
    const store = setup([
      { account_name: 'Brokerage', ticker: 'AAPL', share_count: '10', cost_basis_per_share: '150' },
    ]);
    render(<Render store={store} />);
    expect(screen.getByText('AAPL')).toBeInTheDocument();
    expect(screen.getByText(/\$150/)).toBeInTheDocument();
  });

  it('shows error messages inline', () => {
    const store = setup([
      { account_name: 'Unknown', ticker: '', share_count: '-1' },
    ]);
    render(<Render store={store} />);
    expect(screen.getByText(/No account named/)).toBeInTheDocument();
    expect(screen.getByText(/Ticker is required/)).toBeInTheDocument();
  });

  it('shows the "No rows" empty state when everything is removed', () => {
    const store = setup([
      { account_name: 'Brokerage', ticker: 'AAPL', share_count: '5' },
    ]);
    store.getState().delete(0);
    render(<Render store={store} />);
    expect(screen.getByText(/No rows to preview/)).toBeInTheDocument();
  });
});
