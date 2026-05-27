import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoanPreviewTable } from '@/components/import/LoanPreviewTable';
import { createImportPreviewStore, type ImportPreviewState } from '@/stores/import-preview-store';
import { useStore } from 'zustand';
import { LoanType } from '@/types/enums';

function setup(rows: Array<Record<string, string>>) {
  return createImportPreviewStore(
    'loan',
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
  return <LoanPreviewTable state={state as ImportPreviewState<'loan'>} />;
}

describe('LoanPreviewTable', () => {
  it('renders rows + the loan-specific Term column header', () => {
    const store = setup([
      {
        name: 'Mortgage',
        type: LoanType.MORTGAGE,
        original_amount: '400000',
        current_balance: '350000',
        interest_rate: '0.065',
        term_months: '360',
        first_payment_date: '2024-01-01',
        monthly_payment: '2528.27',
      },
    ]);
    render(<Render store={store} />);
    expect(screen.getByText('Mortgage')).toBeInTheDocument();
    expect(screen.getByText('Term')).toBeInTheDocument();
    expect(screen.getByText('360')).toBeInTheDocument();
  });

  it('shows error rows with the loan-specific cell errors inline', () => {
    const store = setup([
      {
        name: '',
        type: 'BAD',
        original_amount: '-1',
        current_balance: '0',
        interest_rate: '2',
        term_months: '12.5',
        first_payment_date: 'bad',
        monthly_payment: '0',
      },
    ]);
    render(<Render store={store} />);
    expect(screen.getByText(/Name is required/)).toBeInTheDocument();
    expect(screen.getByText(/Unknown type "BAD"/)).toBeInTheDocument();
  });
});
