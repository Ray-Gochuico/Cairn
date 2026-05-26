import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useLoansStore } from '@/stores/loans-store';
import { LoanType } from '@/types/enums';
import type { Loan } from '@/types/schema';

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="rc-responsive">{children}</div>
  ),
  PieChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="rc-piechart">{children}</div>
  ),
  Pie: ({
    data,
    children,
  }: {
    data: Array<{ name: string; value: number; color?: string }>;
    children?: React.ReactNode;
  }) => (
    <div data-testid="rc-pie">
      {data.map((d) => (
        <span
          key={d.name}
          data-testid={`slice-${d.name}`}
          data-value={d.value}
        >
          {d.name}:{d.value}
        </span>
      ))}
      {children}
    </div>
  ),
  Cell: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

import LiabilitiesDonut from '@/components/charts/LiabilitiesDonut';

function mkLoan(
  id: number,
  name: string,
  type: LoanType,
  currentBalance: number,
  overrides: Partial<Loan> = {},
): Loan {
  return {
    id,
    householdId: 1,
    obligorPersonId: null,
    name,
    type,
    originalAmount: currentBalance + 50000,
    currentBalance,
    interestRate: 0.05,
    termMonths: 360,
    firstPaymentDate: '2024-01-01',
    monthlyPayment: 1000,
    extraPaymentDefault: 0,
    linkedPropertyId: null,
    linkedVehicleId: null,
    ...overrides,
  };
}

function resetStores() {
  useLoansStore.setState({ loans: [], isLoading: false, error: null });
}

describe('LiabilitiesDonut', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders the card title', () => {
    render(<LiabilitiesDonut />);
    expect(screen.getByText('Liabilities')).toBeInTheDocument();
  });

  it('renders one slice per loan, labelled by loan name', () => {
    useLoansStore.setState({
      loans: [
        mkLoan(1, 'Home mortgage', LoanType.MORTGAGE, 350000),
        mkLoan(2, 'Car loan', LoanType.AUTO, 15000),
        mkLoan(3, 'Student debt', LoanType.STUDENT, 22000),
      ],
      isLoading: false,
      error: null,
    });

    render(<LiabilitiesDonut />);

    expect(screen.getByTestId('slice-Home mortgage')).toHaveAttribute(
      'data-value',
      '350000',
    );
    expect(screen.getByTestId('slice-Car loan')).toHaveAttribute(
      'data-value',
      '15000',
    );
    expect(screen.getByTestId('slice-Student debt')).toHaveAttribute(
      'data-value',
      '22000',
    );
  });

  it('skips loans whose currentBalance is <= 0', () => {
    useLoansStore.setState({
      loans: [
        mkLoan(1, 'Home mortgage', LoanType.MORTGAGE, 350000),
        mkLoan(2, 'Paid off', LoanType.AUTO, 0),
      ],
      isLoading: false,
      error: null,
    });

    render(<LiabilitiesDonut />);

    expect(screen.getByTestId('slice-Home mortgage')).toBeInTheDocument();
    expect(screen.queryByTestId('slice-Paid off')).not.toBeInTheDocument();
  });

  it('uses loanTypeLabel as the slice name when the loan name is empty', () => {
    // Even though Zod's name.min(1) usually blocks "", we may end up with
    // whitespace-only or zero-length names in legacy data — exercise the
    // fallback explicitly.
    useLoansStore.setState({
      loans: [
        mkLoan(1, '   ', LoanType.MORTGAGE, 350000),
        mkLoan(2, '', LoanType.AUTO, 15000),
      ],
      isLoading: false,
      error: null,
    });

    render(<LiabilitiesDonut />);

    expect(screen.getByTestId('slice-Mortgage')).toHaveAttribute(
      'data-value',
      '350000',
    );
    expect(screen.getByTestId('slice-Auto')).toHaveAttribute(
      'data-value',
      '15000',
    );
  });

  it('shows an empty-state hint when no loans are recorded', () => {
    render(<LiabilitiesDonut />);
    expect(screen.getByText(/no loans recorded/i)).toBeInTheDocument();
  });
});
