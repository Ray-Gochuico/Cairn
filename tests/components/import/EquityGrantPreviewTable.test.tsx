import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EquityGrantPreviewTable } from '@/components/import/EquityGrantPreviewTable';
import { createImportPreviewStore, type ImportPreviewState } from '@/stores/import-preview-store';
import { useStore } from 'zustand';

const VALID_VESTING = JSON.stringify([
  { date: '2026-01-01', cumulativePct: 0.25 },
  { date: '2029-01-01', cumulativePct: 1.0 },
]);

function setup(rows: Array<Record<string, string>>) {
  return createImportPreviewStore(
    'equity_grant',
    { headers: Object.keys(rows[0] ?? {}), rows, errors: [] },
    {
      accounts: [],
      persons: [{ id: 1, name: 'Alice' }],
      categories: [],
      properties: [],
      vehicles: [],
    },
  );
}

function Render({ store }: { store: ReturnType<typeof setup> }) {
  const state = useStore(store);
  return <EquityGrantPreviewTable state={state as ImportPreviewState<'equity_grant'>} />;
}

describe('EquityGrantPreviewTable', () => {
  it('renders rows + the Vesting column header', () => {
    const store = setup([
      {
        name: 'Series B',
        company_name: 'Startup Inc',
        owner_person_name: 'Alice',
        grant_date: '2025-01-01',
        strike_price: '0',
        total_shares: '1000',
        current_fmv: '10',
        vesting_schedule_json: VALID_VESTING,
      },
    ]);
    render(<Render store={store} />);
    expect(screen.getByText('Series B')).toBeInTheDocument();
    expect(screen.getByText('Startup Inc')).toBeInTheDocument();
    expect(screen.getByText('Vesting')).toBeInTheDocument();
    // Vesting summary
    expect(screen.getByText(/2 rows/)).toBeInTheDocument();
    expect(screen.getByText(/25%/)).toBeInTheDocument();
    expect(screen.getByText(/100%/)).toBeInTheDocument();
  });

  it('shows vesting JSON error inline', () => {
    const store = setup([
      {
        name: 'Series B',
        company_name: 'Startup Inc',
        owner_person_name: 'Alice',
        grant_date: '2025-01-01',
        strike_price: '0',
        total_shares: '1000',
        current_fmv: '10',
        vesting_schedule_json: 'garbage',
      },
    ]);
    render(<Render store={store} />);
    expect(screen.getByText(/Invalid JSON/i)).toBeInTheDocument();
  });
});
