import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useLoansStore } from '@/stores/loans-store';
import { LoanType } from '@/types/enums';
import {
  DebtPayoffCard,
  pickStrategyTargetIndex,
  projectionsFor,
} from '@/pages/calculators/DebtPayoffCard';
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
    // Kit persists to sessionStorage — isolate each test.
    sessionStorage.clear();
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

  it('headline is the ANSWER — "Debt-free Mon YYYY"; balance demotes to the tile strip', () => {
    // Wave 15 T7 (D7): the headline answers "when am I debt-free?" — the
    // total balance (an input echo Loans already shows) demotes to a tile.
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

    const headline = screen.getByTestId('debt-payoff-headline');
    expect(headline.textContent).toMatch(/^Debt-free [A-Z][a-z]{2} \d{4}$/);
    expect(headline.textContent).not.toMatch(/\$17,000/);
    // 12,000 + 5,000 = 17,000 -> balance lives in the tile strip now.
    expect(screen.getByTestId('debt-total-balance')).toHaveTextContent('$17,000');
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

    // Wave 11 T19: the per-loan table scrolls inside an overflow-x-auto wrapper.
    expect(screen.getByRole('table').closest('div')).toHaveClass('overflow-x-auto');
  });

  it('numeric columns are right-aligned (Wave 15 T9, Allocator precedent; D9: Payoff date aligns with money columns)', () => {
    useLoansStore.setState({
      loans: [makeLoan({ id: 1, name: 'Car loan' })],
      isLoading: false,
      error: null,
    });

    render(
      <MemoryRouter>
        <DebtPayoffCard />
      </MemoryRouter>,
    );

    for (const name of [/^balance$/i, /^rate$/i, /payoff date/i, /^interest$/i]) {
      expect(
        screen.getByRole('columnheader', { name }).className,
      ).toContain('text-right');
    }
    // Identity column stays left-aligned.
    expect(
      screen.getByRole('columnheader', { name: /^loan$/i }).className,
    ).not.toContain('text-right');
  });

  it('strategy picker has 3 options (None / Snowball / Avalanche)', async () => {
    useLoansStore.setState({
      loans: [makeLoan({ id: 1, name: 'Card', currentBalance: 5000 })],
      isLoading: false,
      error: null,
    });

    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <DebtPayoffCard />
      </MemoryRouter>,
    );

    // Open the Radix combobox by clicking the trigger (accessible name from Label)
    await user.click(screen.getByRole('combobox', { name: /strategy/i }));

    const options = await screen.findAllByRole('option');
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
    await user.click(screen.getByRole('combobox', { name: /strategy/i }));
    await user.click(await screen.findByRole('option', { name: /snowball/i }));

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
    await user.click(screen.getByRole('combobox', { name: /strategy/i }));
    await user.click(await screen.findByRole('option', { name: /snowball/i }));

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

    // Friendly dates ("Jan 2031") do NOT sort lexicographically. Parse them.
    const parseDate = (s: string) => new Date(s).getTime();
    // Snowball + $400 extra -> small loan pays off well before the big loan.
    expect(parseDate(smallPayoff)).toBeLessThan(parseDate(bigPayoff));
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

  it('T6 Fix-2: renders payoff dates as friendly month/year (e.g. "Jan 2031"), not ISO (e.g. "2031-01-01")', () => {
    useLoansStore.setState({
      loans: [
        makeLoan({
          id: 1,
          name: 'Car',
          currentBalance: 10000,
          interestRate: 0.06,
          termMonths: 60,
          firstPaymentDate: '2026-01-01',
        }),
      ],
      isLoading: false,
      error: null,
    });

    render(
      <MemoryRouter>
        <DebtPayoffCard />
      </MemoryRouter>,
    );

    // ISO format must NOT appear anywhere in the rendered output.
    // (Dates like "2026-01-01" or "2031-01-01" must be absent.)
    const isoPattern = /\b\d{4}-\d{2}-\d{2}\b/;
    expect(document.body.textContent).not.toMatch(isoPattern);

    // A friendly "Mon YYYY" date like "Jan 2031" MUST appear.
    const friendlyPattern = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}\b/;
    expect(document.body.textContent).toMatch(friendlyPattern);
  });

  it('persists strategy + extraTotal via the kit', async () => {
    // Prime >= 2 loans so a strategy has an effect.
    useLoansStore.setState({
      loans: [
        makeLoan({ id: 1, name: 'Big loan', currentBalance: 50000, interestRate: 0.05, termMonths: 120 }),
        makeLoan({ id: 2, name: 'Small loan', currentBalance: 5000, interestRate: 0.08, termMonths: 60 }),
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

    // Drive the strategy select to "avalanche" using the role-based idiom.
    await user.click(screen.getByRole('combobox', { name: /strategy/i }));
    await user.click(await screen.findByRole('option', { name: /avalanche/i }));

    // Set the extra monthly payment to 300.
    const extraInput = screen.getByLabelText(/extra monthly payment/i);
    await user.clear(extraInput);
    await user.type(extraInput, '300');

    // Assert that sessionStorage persists both values under the kit key.
    const persisted = JSON.parse(sessionStorage.getItem('calc-state:debt-payoff')!);
    expect(persisted).toMatchObject({ strategy: 'avalanche', extraTotal: 300 });
  });

  it('avalanche targets the highest-APR loan first (distinct from snowball)', async () => {
    // Two loans: identical balance but different rates.
    // Snowball targets the smallest balance (both equal → first). Avalanche targets
    // the HIGHEST rate, so loan 2 (18%) should get the extra and pay off before loan 1 (5%).
    useLoansStore.setState({
      loans: [
        makeLoan({
          id: 1,
          name: 'Low rate',
          currentBalance: 10000,
          interestRate: 0.05,
          termMonths: 60,
        }),
        makeLoan({
          id: 2,
          name: 'High rate',
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

    // Switch to avalanche strategy.
    await user.click(screen.getByRole('combobox', { name: /strategy/i }));
    await user.click(await screen.findByRole('option', { name: /avalanche/i }));

    // Apply a substantial extra payment.
    const extraInput = screen.getByLabelText(/extra monthly payment/i);
    await user.clear(extraInput);
    await user.type(extraInput, '500');

    const highRatePayoff = screen
      .getByTestId('debt-loan-payoff-2')
      .textContent!.trim();
    const lowRatePayoff = screen
      .getByTestId('debt-loan-payoff-1')
      .textContent!.trim();

    // Friendly dates ("Jan 2031") do NOT sort lexicographically. Parse them.
    const parseDate = (s: string) => new Date(s).getTime();
    // Avalanche + $500 extra → high-rate (18%) loan pays off BEFORE the low-rate (5%) one.
    expect(parseDate(highRatePayoff)).toBeLessThan(parseDate(lowRatePayoff));
  });

  describe('never-pays-off guard (round-2 A1)', () => {
    const underwater = () =>
      makeLoan({
        id: 9,
        name: 'Underwater',
        currentBalance: 300000,
        interestRate: 0.06,
        termMonths: 360,
        monthlyPayment: 1000, // < $1,500/mo interest → never amortizes
        firstPaymentDate: '2020-01-01',
      });

    it('shows the warning notice and suppresses aggregate + per-row figures', () => {
      useLoansStore.setState({
        loans: [underwater(), makeLoan({ id: 2, name: 'Healthy', currentBalance: 5000 })],
        isLoading: false,
        error: null,
      });
      render(
        <MemoryRouter>
          <DebtPayoffCard />
        </MemoryRouter>,
      );

      const notice = screen.getByTestId('debt-never-payoff-notice');
      expect(notice).toHaveTextContent(/never pays off at the current payment/i);
      expect(notice).toHaveTextContent('Underwater');

      // Every payoff-derived aggregate is suppressed (any capped loan poisons
      // the sums) — including the headline, which claims a payoff date (T7/D7).
      expect(screen.getByTestId('debt-total-interest')).toHaveTextContent('—');
      expect(screen.getByTestId('debt-payoff-headline')).toHaveTextContent('—');
      expect(screen.getByTestId('debt-savings')).toHaveTextContent('—');
      // The balance tile is NEVER suppressed — the balance is always real.
      expect(screen.getByTestId('debt-total-balance')).not.toHaveTextContent('—');

      // Capped row: payoff cell carries the inline warning, interest cell is '—'.
      expect(screen.getByTestId('debt-loan-payoff-9')).toHaveTextContent(/never at this payment/i);
      const cappedRow = screen.getByTestId('debt-loan-row-9');
      expect(within(cappedRow).getByText('—')).toBeInTheDocument();

      // The healthy loan's row keeps a real payoff date (a "Mon YYYY" string).
      expect(screen.getByTestId('debt-loan-payoff-2')).toHaveTextContent(/[A-Z][a-z]{2} \d{4}/);
    });

    it('renders no notice and real figures when every loan amortizes', () => {
      useLoansStore.setState({
        loans: [makeLoan({ id: 1 })],
        isLoading: false,
        error: null,
      });
      render(
        <MemoryRouter>
          <DebtPayoffCard />
        </MemoryRouter>,
      );
      expect(screen.queryByTestId('debt-never-payoff-notice')).not.toBeInTheDocument();
      expect(screen.getByTestId('debt-payoff-headline')).toHaveTextContent(
        /Debt-free [A-Z][a-z]{2} \d{4}/,
      );
    });

    it('a rescuing extra keeps real payoff/interest but suppresses savings and still warns (review F1)', () => {
      // $300k @6% → $1,500/mo interest; the $1,000 contract payment alone
      // never amortizes, but the $600 extraPaymentDefault nets $100+/mo of
      // paydown → the PROJECTION pays off (~556 months, inside the cap)
      // while the extra-less BASELINE runs to the cap. "Savings vs no-extra"
      // would difference a real number against the cap's accumulation.
      useLoansStore.setState({
        loans: [{ ...underwater(), extraPaymentDefault: 600 }],
        isLoading: false,
        error: null,
      });
      render(
        <MemoryRouter>
          <DebtPayoffCard />
        </MemoryRouter>,
      );

      const notice = screen.getByTestId('debt-never-payoff-notice');
      expect(notice).toHaveTextContent(/without extra payments/i);
      expect(notice).toHaveTextContent('Underwater');

      // Savings is baseline-poisoned → suppressed; the other two tiles are
      // real (the with-extra projection amortizes).
      expect(screen.getByTestId('debt-savings')).toHaveTextContent('—');
      expect(screen.getByTestId('debt-total-interest')).not.toHaveTextContent('—');
      expect(screen.getByTestId('debt-payoff-headline')).toHaveTextContent(
        /Debt-free [A-Z][a-z]{2} \d{4}/,
      );
      // Per-row payoff keeps a real date too.
      expect(screen.getByTestId('debt-loan-payoff-9')).toHaveTextContent(/[A-Z][a-z]{2} \d{4}/);
    });
  });
});

// ── Unit tests for the exported helper functions ────────────────────────────

describe('extra-payment savings pin (round-3 T21)', () => {
  beforeEach(() => {
    useLoansStore.setState({ loans: [], isLoading: false, error: null });
    sessionStorage.clear();
  });

  it('a loan with extraPaymentDefault > 0 shows a POSITIVE savings figure', async () => {
    // Every existing debt-savings assertion pins the suppressed '—'; this one
    // pins the happy path. Oracle = amortize() with/without the extra, using
    // the SAME remaining-schedule anchor the card uses (clock-free: the
    // anchor comes from localTodayISO(), not a bare new Date() here).
    const { amortize, nextPaymentDateFrom } = await import('@/lib/amortization');
    const { localTodayISO } = await import('@/lib/dates');
    const { formatCurrency } = await import('@/lib/format');
    const loan = makeLoan({
      id: 1,
      name: 'Car',
      currentBalance: 10000,
      interestRate: 0.06,
      termMonths: 60,
      extraPaymentDefault: 200,
    });
    useLoansStore.setState({ loans: [loan], isLoading: false, error: null });
    render(<MemoryRouter><DebtPayoffCard /></MemoryRouter>);

    const anchor = nextPaymentDateFrom(loan.firstPaymentDate, localTodayISO());
    const base = {
      principal: loan.currentBalance,
      annualRatePct: loan.interestRate,
      termMonths: loan.termMonths,
      firstPaymentDate: anchor,
      monthlyPayment: loan.monthlyPayment,
    };
    const withoutExtra = amortize({ ...base, extraPayment: 0 });
    const withExtra = amortize({ ...base, extraPayment: 200 });
    const expected = withoutExtra.totalInterest - withExtra.totalInterest;
    expect(expected).toBeGreaterThan(0); // sanity: the fixture bites

    const savings = screen.getByTestId('debt-savings');
    expect(savings).toHaveTextContent(formatCurrency(expected));
    expect(savings).not.toHaveTextContent('—');
  });
});

describe('pickStrategyTargetIndex', () => {
  const loans: Loan[] = [
    makeLoan({ id: 1, currentBalance: 5000, interestRate: 0.05 }),
    makeLoan({ id: 2, currentBalance: 20000, interestRate: 0.18 }),
    makeLoan({ id: 3, currentBalance: 1000, interestRate: 0.10 }),
  ];

  it('returns -1 for strategy "none"', () => {
    expect(pickStrategyTargetIndex(loans, 'none')).toBe(-1);
  });

  it('returns -1 for an empty loan list', () => {
    expect(pickStrategyTargetIndex([], 'snowball')).toBe(-1);
    expect(pickStrategyTargetIndex([], 'avalanche')).toBe(-1);
  });

  it('snowball returns the index of the smallest-balance loan', () => {
    // Loan 3 has the smallest balance (1000).
    expect(pickStrategyTargetIndex(loans, 'snowball')).toBe(2);
  });

  it('avalanche returns the index of the highest-interest-rate loan', () => {
    // Loan 2 has the highest rate (18%).
    expect(pickStrategyTargetIndex(loans, 'avalanche')).toBe(1);
  });

  it('avalanche and snowball can return different indices (distinct strategies)', () => {
    // With these loans: snowball → idx 2 (balance 1000), avalanche → idx 1 (rate 18%)
    const snowballIdx = pickStrategyTargetIndex(loans, 'snowball');
    const avalancheIdx = pickStrategyTargetIndex(loans, 'avalanche');
    expect(snowballIdx).not.toBe(avalancheIdx);
  });
});

describe('projectionsFor', () => {
  const loans: Loan[] = [
    makeLoan({ id: 1, name: 'Low rate', currentBalance: 10000, interestRate: 0.05, termMonths: 60 }),
    makeLoan({ id: 2, name: 'High rate', currentBalance: 10000, interestRate: 0.18, termMonths: 60 }),
  ];

  it('returns one projection per loan', () => {
    const result = projectionsFor(loans, 'none', 0);
    expect(result).toHaveLength(2);
  });

  it('applies zero extra to all loans when strategy is "none"', () => {
    const result = projectionsFor(loans, 'none', 500);
    expect(result[0].extraApplied).toBe(0);
    expect(result[1].extraApplied).toBe(0);
  });

  it('applies the extra payment only to the avalanche target (highest-rate loan)', () => {
    // Loan 2 is index 1 (18% rate) → should receive extraApplied = 500
    const result = projectionsFor(loans, 'avalanche', 500);
    expect(result[0].extraApplied).toBe(0);   // 5% loan gets nothing extra
    expect(result[1].extraApplied).toBe(500); // 18% loan gets the full extra
  });

  it('applies the extra payment only to the snowball target (smallest-balance loan)', () => {
    // Both loans have equal balance; snowball picks index 0 (first in tie).
    const result = projectionsFor(loans, 'snowball', 300);
    expect(result[0].extraApplied).toBe(300); // first/tied-smallest gets the extra
    expect(result[1].extraApplied).toBe(0);
  });

  it('each projection carries an amortization schedule with payment dates', () => {
    const result = projectionsFor(loans, 'none', 0);
    for (const p of result) {
      expect(p.amortization.schedule.length).toBeGreaterThan(0);
      expect(p.amortization.totalInterest).toBeGreaterThan(0);
    }
  });
});
