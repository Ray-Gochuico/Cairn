import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
          data-color={d.color ?? ''}
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

  describe('entity picker', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    function seedThreeLoans() {
      useLoansStore.setState({
        loans: [
          mkLoan(1, 'Home mortgage', LoanType.MORTGAGE, 350000),
          mkLoan(2, 'Car loan', LoanType.AUTO, 15000),
          mkLoan(3, 'Student debt', LoanType.STUDENT, 22000),
        ],
        isLoading: false,
        error: null,
      });
    }

    it('renders an Entities picker button with the count of visible entities', () => {
      seedThreeLoans();
      render(<LiabilitiesDonut />);
      expect(
        screen.getByRole('button', { name: /Included · 3 of 3/ }),
      ).toBeInTheDocument();
    });

    it('each slice carries a resolved color (not empty)', () => {
      seedThreeLoans();
      render(<LiabilitiesDonut />);
      for (const name of ['Home mortgage', 'Car loan', 'Student debt']) {
        expect(
          screen.getByTestId(`slice-${name}`).getAttribute('data-color'),
          name,
        ).toMatch(/^#[0-9a-f]{6}$/i);
      }
    });

    it('a kept slice keeps its color after another loan is hidden (no legend desync)', async () => {
      seedThreeLoans();
      render(<LiabilitiesDonut />);
      // Student debt is last in insertion order; hiding the FIRST loan (Home
      // mortgage) would reindex it under the old positional fallback.
      const before = screen.getByTestId('slice-Student debt').getAttribute('data-color');
      expect(before).toMatch(/^#[0-9a-f]{6}$/i);
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /Included ·/ }));
      await user.click(screen.getByRole('checkbox', { name: /Home mortgage/ }));
      expect(screen.queryByTestId('slice-Home mortgage')).not.toBeInTheDocument();
      expect(screen.getByTestId('slice-Student debt').getAttribute('data-color')).toBe(before);
    });

    it('share % stays anchored to total debt when a loan is hidden', async () => {
      // Mortgage 350000, Car 15000, Student 22000 → full total 387000. Hide
      // the mortgage: Car loan's legend share must still read 3.9%
      // (15000/387000), NOT 40.5% (15000/37000).
      seedThreeLoans();
      render(<LiabilitiesDonut />);
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /Included ·/ }));
      await user.click(screen.getByRole('checkbox', { name: /Home mortgage/ }));
      expect(screen.getByText(/\$15,000 · 3\.9%/)).toBeInTheDocument();
      expect(screen.queryByText(/40\.5%/)).not.toBeInTheDocument();
    });

    it('hiding a loan removes its slice from the donut', async () => {
      seedThreeLoans();
      render(<LiabilitiesDonut />);
      expect(screen.getByTestId('slice-Car loan')).toBeInTheDocument();

      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /Included ·/ }));
      await user.click(screen.getByRole('checkbox', { name: /Car loan/ }));

      expect(screen.queryByTestId('slice-Car loan')).not.toBeInTheDocument();
      expect(screen.getByTestId('slice-Home mortgage')).toBeInTheDocument();
      expect(screen.getByTestId('slice-Student debt')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /Included · 2 of 3/ }),
      ).toBeInTheDocument();
    });

    it('persists hidden selection across remount', async () => {
      seedThreeLoans();
      const { unmount } = render(<LiabilitiesDonut />);
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /Included ·/ }));
      await user.click(screen.getByRole('checkbox', { name: /Car loan/ }));
      expect(screen.queryByTestId('slice-Car loan')).not.toBeInTheDocument();
      unmount();

      render(<LiabilitiesDonut />);
      expect(screen.queryByTestId('slice-Car loan')).not.toBeInTheDocument();
      expect(screen.getByTestId('slice-Home mortgage')).toBeInTheDocument();
    });

    it('shows the all-hidden message when every loan is hidden', async () => {
      seedThreeLoans();
      render(<LiabilitiesDonut />);
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /Included ·/ }));
      await user.click(screen.getByRole('button', { name: /hide all/i }));
      expect(screen.getByText(/all entities hidden/i)).toBeInTheDocument();
    });
  });
});
