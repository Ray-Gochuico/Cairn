import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useLoansStore } from '@/stores/loans-store';
import { usePersonsStore } from '@/stores/persons-store';
import { LoanType } from '@/types/enums';
import type { Loan } from '@/types/schema';
import Loans from '@/pages/Loans';

function makeLoan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: 1,
    householdId: 1,
    obligorPersonId: null,
    name: 'Test Loan',
    type: LoanType.MORTGAGE,
    originalAmount: 400000,
    currentBalance: 400000,
    interestRate: 0.06,
    termMonths: 360,
    firstPaymentDate: '2026-01-01',
    monthlyPayment: 2398,
    extraPaymentDefault: 0,
    linkedPropertyId: null,
    linkedVehicleId: null,
    ...overrides,
  };
}

function resetStores() {
  useLoansStore.setState({ loans: [], isLoading: false, error: null });
  usePersonsStore.setState({ persons: [], isLoading: false, error: null });
}

function renderLoans() {
  return render(
    <MemoryRouter>
      <Loans />
    </MemoryRouter>,
  );
}

describe('Loans page', () => {
  beforeEach(() => {
    resetStores();
  });

  it('shows empty state when no loans exist', () => {
    renderLoans();
    expect(screen.getByText(/no loans yet/i)).toBeInTheDocument();
  });

  it('renders a loan card with summary info', () => {
    useLoansStore.setState({
      loans: [makeLoan({ name: 'Primary Mortgage' })],
      isLoading: false,
      error: null,
    });
    renderLoans();
    expect(screen.getByText('Primary Mortgage')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /view schedule/i })).toBeInTheDocument();
  });

  it('expands a loan to show amortization schedule with truncation', async () => {
    const user = userEvent.setup();

    // 360-month 30-year mortgage — schedule.length will be 360 > 60, triggering truncation
    useLoansStore.setState({
      loans: [
        makeLoan({
          id: 42,
          name: 'Big Mortgage',
          currentBalance: 400000,
          interestRate: 0.06,
          termMonths: 360,
          firstPaymentDate: '2026-01-01',
        }),
      ],
      isLoading: false,
      error: null,
    });

    renderLoans();

    // "View schedule" button must be present before expand
    const viewBtn = screen.getByRole('button', { name: /view schedule/i });
    expect(viewBtn).toBeInTheDocument();

    // Click to expand
    await user.click(viewBtn);

    // Table headers should appear
    await waitFor(() => {
      expect(screen.getByText('Date')).toBeInTheDocument();
      expect(screen.getByText('Principal')).toBeInTheDocument();
      expect(screen.getByText('Interest')).toBeInTheDocument();
      expect(screen.getByText('Remaining')).toBeInTheDocument();
    });

    // Truncation indicator: 360 payments, showing 24 (first 12 + last 12), omitting 336
    expect(screen.getByText(/336 payments omitted/i)).toBeInTheDocument();

    // "Show all" button should appear
    const showAllBtn = screen.getByRole('button', { name: /show all 360 payments/i });
    expect(showAllBtn).toBeInTheDocument();

    // Click "Show all" — truncation indicator disappears, all rows appear
    await user.click(showAllBtn);

    await waitFor(() => {
      expect(screen.queryByText(/payments omitted/i)).not.toBeInTheDocument();
    });

    // All 360 row dates should be in the document (first + last known dates)
    expect(screen.getByText('2026-01-01')).toBeInTheDocument();

    // "Show first/last 12" button appears after expanding all
    expect(screen.getByRole('button', { name: /show first\/last 12/i })).toBeInTheDocument();

    // Button label flips to "Hide schedule"
    expect(screen.getByRole('button', { name: /hide schedule/i })).toBeInTheDocument();

    // Click "Hide schedule" to collapse
    await user.click(screen.getByRole('button', { name: /hide schedule/i }));
    await waitFor(() => {
      expect(screen.queryByText('Date')).not.toBeInTheDocument();
    });
  });

  it('handles a short loan (< 60 months) without truncation', async () => {
    const user = userEvent.setup();

    useLoansStore.setState({
      loans: [
        makeLoan({
          id: 7,
          name: 'Short Loan',
          currentBalance: 10000,
          interestRate: 0.05,
          termMonths: 24,
          firstPaymentDate: '2026-01-01',
        }),
      ],
      isLoading: false,
      error: null,
    });

    renderLoans();
    await user.click(screen.getByRole('button', { name: /view schedule/i }));

    await waitFor(() => {
      expect(screen.getByText('Date')).toBeInTheDocument();
    });

    // No truncation indicator for a 24-month schedule
    expect(screen.queryByText(/payments omitted/i)).not.toBeInTheDocument();
    // No "show all" button either
    expect(screen.queryByRole('button', { name: /show all/i })).not.toBeInTheDocument();
  });
});
