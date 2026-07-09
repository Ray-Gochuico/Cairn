import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useLoansStore } from '@/stores/loans-store';
import { usePersonsStore } from '@/stores/persons-store';
import { LoanType } from '@/types/enums';
import type { Loan } from '@/types/schema';

// Mock recharts so the stacked debt BarChart renders inspectable DOM in
// jsdom. Each <Bar> becomes a div carrying its dataKey + stackId so the
// tests below can assert the segment count by loan type.
vi.mock('recharts', () => {
  return {
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="rc-responsive">{children}</div>
    ),
    BarChart: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="rc-barchart">{children}</div>
    ),
    Bar: (props: { dataKey: string; stackId?: string; name?: string }) =>
      React.createElement('div', {
        'data-testid': `rc-bar-${props.dataKey}`,
        'data-key': props.dataKey,
        'data-stack-id': props.stackId ?? '',
        'data-name': props.name ?? '',
      }),
    LineChart: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="rc-linechart">{children}</div>
    ),
    Line: (props: { dataKey: string }) =>
      React.createElement('div', {
        'data-testid': `rc-line-${props.dataKey}`,
        'data-key': props.dataKey,
      }),
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    Legend: () => null,
  };
});

// Import the page AFTER mocking recharts.
const { default: Loans } = await import('@/pages/Loans');

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
  // Stub load() so the page's reload effect (and the new StoreErrorBanner's
  // retry) don't hit a real DB — an unstubbed load() throws via getDatabase()
  // and sets `error`, which the banner would then surface in place of the
  // empty state.
  useLoansStore.setState({ loans: [], isLoading: false, error: null, load: async () => {} });
  usePersonsStore.setState({ persons: [], isLoading: false, error: null, load: async () => {} });
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
    // Pin "today": schedules anchor at nextPaymentDateFrom(firstPaymentDate, today).
    // toFake:['Date'] only (same pattern as FinancialIndependenceCard.test.tsx)
    // so userEvent's internal timers are untouched.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-20T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows empty state when no loans exist', () => {
    renderLoans();
    expect(screen.getByText(/no loans yet/i)).toBeInTheDocument();
  });

  it('shows the loading skeleton, not "No loans yet", while the store loads (W10 T1)', () => {
    useLoansStore.setState({ loans: [], isLoading: true, error: null, load: async () => {} } as never);
    renderLoans();
    expect(screen.getByRole('status', { name: /loading page/i })).toBeInTheDocument();
    expect(screen.queryByText(/no loans yet/i)).not.toBeInTheDocument();
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

    // 30-year mortgage paying $2,500/mo — the contract payment pays $400k @6%
    // off in 323 months (> 60, triggering truncation; far from any rounding
    // knife-edge).
    useLoansStore.setState({
      loans: [
        makeLoan({
          id: 42,
          name: 'Big Mortgage',
          currentBalance: 400000,
          interestRate: 0.06,
          termMonths: 360,
          firstPaymentDate: '2026-01-01',
          monthlyPayment: 2500,
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

    // Truncation indicator: 323 payments, showing 24 (first 12 + last 12), omitting 299
    expect(screen.getByText(/299 payments omitted/i)).toBeInTheDocument();

    // "Show all" button should appear
    const showAllBtn = screen.getByRole('button', { name: /show all 323 payments/i });
    expect(showAllBtn).toBeInTheDocument();

    // Click "Show all" — truncation indicator disappears, all rows appear
    await user.click(showAllBtn);

    await waitFor(() => {
      expect(screen.queryByText(/payments omitted/i)).not.toBeInTheDocument();
    });

    // First row = next payment date from the pinned today
    // (nextPaymentDateFrom('2026-01-01', '2026-06-20') = 2026-07-01), rendered
    // as a humanized month via formatMonth (Wave 11 T4).
    expect(screen.getByText('Jul 2026')).toBeInTheDocument();
    expect(screen.queryByText('2026-07-01')).not.toBeInTheDocument();

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

  it('exports the full loans table to CSV with the obligor name resolved', async () => {
    usePersonsStore.setState({
      persons: [
        { id: 1, name: 'Alex' },
        { id: 2, name: 'Sam' },
      ] as never,
      isLoading: false,
      error: null,
    });
    useLoansStore.setState({
      loans: [
        makeLoan({
          id: 1,
          obligorPersonId: 2,
          name: 'Primary Mortgage',
          type: LoanType.MORTGAGE,
          originalAmount: 400000,
          currentBalance: 380000,
          interestRate: 0.06,
          termMonths: 360,
          monthlyPayment: 2398,
        }),
      ],
      isLoading: false,
      error: null,
    });

    let capturedCsv = '';
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      void (b as Blob).text().then((t) => {
        capturedCsv = t;
      });
      return 'blob:mock';
    });
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    renderLoans();
    await userEvent.click(screen.getByRole('button', { name: /export csv/i }));
    await Promise.resolve();

    expect(capturedCsv.split('\n')[0]).toBe(
      'name,type,original amount,current balance,interest rate,term months,monthly payment,obligor',
    );
    expect(capturedCsv.split('\n')[1]).toBe(
      'Primary Mortgage,Mortgage,400000,380000,0.06,360,2398,Sam',
    );

    createSpy.mockRestore();
    revokeSpy.mockRestore();
  });

  it('renders a single-segment stack when only one loan type exists', () => {
    useLoansStore.setState({
      loans: [
        makeLoan({
          id: 1,
          name: 'Only Mortgage',
          type: LoanType.MORTGAGE,
          currentBalance: 100000,
          interestRate: 0.05,
          termMonths: 24,
          firstPaymentDate: '2026-01-01',
        }),
      ],
      isLoading: false,
      error: null,
    });

    const { container } = renderLoans();

    // Title proves we're rendering the stacked debt chart card.
    expect(screen.getByText(/total debt over time/i)).toBeInTheDocument();

    // One stacked segment when there's a single loan type. Every Bar
    // belonging to the debt stack must share one stackId.
    const bars = container.querySelectorAll('[data-testid^="rc-bar-"]');
    expect(bars.length).toBe(1);
    expect(bars[0].getAttribute('data-stack-id')).toBeTruthy();
    // The segment is named after the loan type label so the legend reads
    // 'Mortgage' rather than the raw enum value.
    expect(bars[0].getAttribute('data-name')).toBe('Mortgage');
  });

  it('renders a multi-segment stack broken out by loan type', () => {
    useLoansStore.setState({
      loans: [
        makeLoan({
          id: 1,
          name: 'Primary Mortgage',
          type: LoanType.MORTGAGE,
          currentBalance: 300000,
          interestRate: 0.05,
          termMonths: 24,
          firstPaymentDate: '2026-01-01',
          monthlyPayment: 13000,
        }),
        makeLoan({
          id: 2,
          name: 'Car Loan',
          type: LoanType.AUTO,
          currentBalance: 20000,
          interestRate: 0.06,
          termMonths: 12,
          firstPaymentDate: '2026-01-01',
          monthlyPayment: 1700,
        }),
      ],
      isLoading: false,
      error: null,
    });

    const { container } = renderLoans();

    // Two distinct loan types -> two segments in the stack.
    const bars = container.querySelectorAll('[data-testid^="rc-bar-"]');
    expect(bars.length).toBe(2);

    // All segments share a single stackId (so they actually stack).
    const stackIds = new Set(
      Array.from(bars).map((b) => b.getAttribute('data-stack-id')),
    );
    expect(stackIds.size).toBe(1);
    expect([...stackIds][0]).toBeTruthy();

    // The two segments must correspond to the two loan types present.
    const names = new Set(
      Array.from(bars).map((b) => b.getAttribute('data-name')),
    );
    expect(names.has('Mortgage')).toBe(true);
    expect(names.has('Auto')).toBe(true);
  });

  it('does not include loan-type segments for types with zero balance', () => {
    // Two mortgages and zero loans of any other type → still 1 segment.
    useLoansStore.setState({
      loans: [
        makeLoan({
          id: 1,
          name: 'Mortgage A',
          type: LoanType.MORTGAGE,
          currentBalance: 150000,
          interestRate: 0.05,
          termMonths: 24,
          firstPaymentDate: '2026-01-01',
        }),
        makeLoan({
          id: 2,
          name: 'Mortgage B',
          type: LoanType.MORTGAGE,
          currentBalance: 100000,
          interestRate: 0.05,
          termMonths: 24,
          firstPaymentDate: '2026-01-01',
        }),
      ],
      isLoading: false,
      error: null,
    });

    const { container } = renderLoans();

    const bars = container.querySelectorAll('[data-testid^="rc-bar-"]');
    expect(bars.length).toBe(1);
    expect(bars[0].getAttribute('data-name')).toBe('Mortgage');
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

  describe('never-pays-off guard (round-2 A1)', () => {
    const underwater: Loan = {
      id: 77,
      householdId: 1,
      obligorPersonId: null,
      name: 'Underwater Mortgage',
      type: LoanType.MORTGAGE,
      originalAmount: 320000,
      currentBalance: 300000,
      interestRate: 0.06,
      termMonths: 360,
      firstPaymentDate: '2020-01-01',
      monthlyPayment: 1000, // < $1,500/mo interest
      extraPaymentDefault: 0,
      linkedPropertyId: null,
      linkedVehicleId: null,
    };

    it('suppresses the card payoff/interest figures and shows the inline warning', async () => {
      useLoansStore.setState({
        loans: [underwater],
        isLoading: false,
        error: null,
        load: async () => {},
      });
      renderLoans();

      expect(
        await screen.findByText(/never pays off at the current payment/i),
      ).toBeInTheDocument();
      // Projected payoff + Remaining interest dd's are suppressed on the card…
      const card = screen.getByText('Underwater Mortgage').closest('[class*="rounded"]') as HTMLElement;
      expect(within(card).getAllByText('—').length).toBeGreaterThanOrEqual(2);
      // …and the page-level Remaining-interest summary tile is too. (Anchored
      // via the tile's capped subtext — the label text 'Remaining interest'
      // also appears as a LoanCard dt, so it is ambiguous for getByText.)
      const summarySubtext = screen.getByText(/hidden — a payment below interest never pays off/i);
      const summaryCard = summarySubtext.closest('[class*="rounded"]') as HTMLElement;
      expect(within(summaryCard).getByText('—')).toBeInTheDocument();
    });

    it('an amortizing loan keeps real figures and shows no warning', async () => {
      useLoansStore.setState({
        loans: [{ ...underwater, id: 78, name: 'Healthy', monthlyPayment: 2200 }],
        isLoading: false,
        error: null,
        load: async () => {},
      });
      renderLoans();
      expect(await screen.findByText('Healthy')).toBeInTheDocument();
      expect(screen.queryByText(/never pays off at the current payment/i)).not.toBeInTheDocument();
    });
  });
});

describe('buildDebtSeries current-month seeding (wave-9 M10)', () => {
  it('a loan whose next payment falls next month still contributes currentBalance to the current bar', async () => {
    const { buildDebtSeries } = await import('@/pages/Loans');
    const mkProjection = (name: string, firstMonth: string, balance: number) => {
      const amort = {
        schedule: [
          {
            paymentDate: `${firstMonth}-01`,
            principal: 100,
            interest: 50,
            extra: 0,
            balance: balance - 100,
          },
        ],
        monthlyPayment: 150,
        totalInterest: 50,
      };
      return {
        loan: { ...makeLoan({ name }), currentBalance: balance, type: LoanType.MORTGAGE },
        withDefault: amort,
        withoutExtra: amort,
      };
    };
    const { rows } = buildDebtSeries(
      [mkProjection('Due next month', '2026-08', 250000)],
      '2026-07-08',
    );
    const july = rows.find((r) => r.month === '2026-07');
    expect(july).toBeDefined();
    expect(july![LoanType.MORTGAGE]).toBe(250000);
  });
});
