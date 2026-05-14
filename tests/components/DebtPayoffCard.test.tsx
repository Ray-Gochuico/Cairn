import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useLoansStore } from '@/stores/loans-store';
import { LoanType } from '@/types/enums';
import { DebtPayoffCard } from '@/pages/calculators/DebtPayoffCard';
import type { Loan } from '@/types/schema';

function makeLoan(overrides: Partial<Loan> = {}): Loan {
  return {
    id: 1,
    householdId: 1,
    obligorPersonId: null,
    name: 'Loan',
    type: LoanType.PERSONAL,
    originalAmount: 10000,
    currentBalance: 10000,
    interestRate: 0.06,
    termMonths: 60,
    firstPaymentDate: '2026-01-01',
    monthlyPayment: 0,
    extraPaymentDefault: 0,
    linkedPropertyId: null,
    linkedVehicleId: null,
    ...overrides,
  };
}

function resetStore() {
  useLoansStore.setState({ loans: [], isLoading: false, error: null });
}

describe('DebtPayoffCard', () => {
  beforeEach(() => {
    resetStore();
  });

  it('renders empty state when no loans exist', () => {
    render(
      <MemoryRouter>
        <DebtPayoffCard />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Debt Payoff/i)).toBeInTheDocument();
    expect(
      screen.getByText(/add loans on the inputs page/i),
    ).toBeInTheDocument();
  });

  it('renders aggregate "total balance" headline with one or more loans', () => {
    useLoansStore.setState({
      loans: [
        makeLoan({ id: 1, name: 'Car', currentBalance: 12000 }),
        makeLoan({ id: 2, name: 'Card', currentBalance: 5000 }),
      ],
      isLoading: false,
      error: null,
    });

    render(
      <MemoryRouter>
        <DebtPayoffCard />
      </MemoryRouter>,
    );

    // 12,000 + 5,000 = 17,000 -> headline shows total balance
    const headline = screen.getByTestId('debt-payoff-headline');
    expect(headline.textContent).toMatch(/\$17,000/);
  });

  it('renders one row per loan in the loans store', () => {
    useLoansStore.setState({
      loans: [
        makeLoan({ id: 1, name: 'Car loan' }),
        makeLoan({ id: 2, name: 'Mortgage' }),
        makeLoan({ id: 3, name: 'Credit card' }),
      ],
      isLoading: false,
      error: null,
    });

    render(
      <MemoryRouter>
        <DebtPayoffCard />
      </MemoryRouter>,
    );

    // Each loan name is rendered.
    expect(screen.getByText(/^Car loan$/)).toBeInTheDocument();
    expect(screen.getByText(/^Mortgage$/)).toBeInTheDocument();
    expect(screen.getByText(/^Credit card$/)).toBeInTheDocument();

    // And we should have a per-loan row container for each.
    expect(screen.getAllByTestId(/^debt-loan-row-/)).toHaveLength(3);
  });

  it('strategy picker has 3 options (None / Snowball / Avalanche)', () => {
    useLoansStore.setState({
      loans: [makeLoan({ id: 1, name: 'Card', currentBalance: 5000 })],
      isLoading: false,
      error: null,
    });

    render(
      <MemoryRouter>
        <DebtPayoffCard />
      </MemoryRouter>,
    );

    const select = screen.getByLabelText(/strategy/i) as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    const options = within(select).getAllByRole('option');
    expect(options).toHaveLength(3);
    expect(options.map((o) => o.textContent)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/none/i),
        expect.stringMatching(/snowball/i),
        expect.stringMatching(/avalanche/i),
      ]),
    );
  });

  it('changing extra-payment input lowers total interest (more extra -> less interest)', async () => {
    useLoansStore.setState({
      loans: [
        makeLoan({
          id: 1,
          name: 'Card',
          currentBalance: 10000,
          interestRate: 0.18,
          termMonths: 60,
        }),
      ],
      isLoading: false,
      error: null,
    });

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <DebtPayoffCard />
      </MemoryRouter>,
    );

    // Switch to a strategy that distributes the global extra payment.
    const strategySelect = screen.getByLabelText(/strategy/i);
    await user.selectOptions(strategySelect, 'snowball');

    const totalInterestBefore = parseFloat(
      screen
        .getByTestId('debt-total-interest')
        .textContent!.replace(/[^\d.]/g, ''),
    );
    expect(Number.isFinite(totalInterestBefore)).toBe(true);
    expect(totalInterestBefore).toBeGreaterThan(0);

    // Punch in a large monthly extra and re-read the total.
    const extraInput = screen.getByLabelText(/extra monthly payment/i);
    await user.clear(extraInput);
    await user.type(extraInput, '200');

    const totalInterestAfter = parseFloat(
      screen
        .getByTestId('debt-total-interest')
        .textContent!.replace(/[^\d.]/g, ''),
    );
    expect(totalInterestAfter).toBeLessThan(totalInterestBefore);
  });

  it('snowball assigns the global extra payment to the smallest-balance loan', async () => {
    // Two loans of identical interest rate / term but very different balances.
    // Under snowball, the SMALLER loan should receive the entire extra payment
    // and therefore pay off sooner than the larger loan.
    useLoansStore.setState({
      loans: [
        makeLoan({
          id: 1,
          name: 'Big loan',
          currentBalance: 50000,
          interestRate: 0.05,
          termMonths: 120,
        }),
        makeLoan({
          id: 2,
          name: 'Small loan',
          currentBalance: 5000,
          interestRate: 0.05,
          termMonths: 120,
        }),
      ],
      isLoading: false,
      error: null,
    });

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <DebtPayoffCard />
      </MemoryRouter>,
    );

    // Default strategy: none. Switch to snowball.
    await user.selectOptions(screen.getByLabelText(/strategy/i), 'snowball');

    // Apply a $400/mo extra payment to the snowball target.
    const extraInput = screen.getByLabelText(/extra monthly payment/i);
    await user.clear(extraInput);
    await user.type(extraInput, '400');

    const smallPayoff = screen
      .getByTestId('debt-loan-payoff-2')
      .textContent!.trim();
    const bigPayoff = screen
      .getByTestId('debt-loan-payoff-1')
      .textContent!.trim();

    // ISO-ish dates compare lexicographically the same as chronologically.
    // Snowball + $400 extra -> small loan pays off well before the big loan.
    expect(smallPayoff < bigPayoff).toBe(true);
  });

  it('forwards cardId + onHide so the Hide button appears on the card', () => {
    useLoansStore.setState({
      loans: [makeLoan({ id: 1, name: 'Card' })],
      isLoading: false,
      error: null,
    });

    render(
      <MemoryRouter>
        <DebtPayoffCard cardId="debt-payoff" onHide={() => {}} />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole('button', { name: /hide debt payoff card/i }),
    ).toBeInTheDocument();
  });
});
