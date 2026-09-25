import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ExtraLoanPaymentsPopover from '@/components/whatif/levers/ExtraLoanPaymentsPopover';
import { useScenariosStore } from '@/stores/scenarios-store';
import { useLoansStore } from '@/stores/loans-store';
import { emptyLeverPayload } from '@/lib/scenarios';
import type { Scenario } from '@/types/scenario';

function resetStores() {
  useScenariosStore.setState({
    scenarios: [{
      id: 1, name: 'Baseline', isBaseline: true, color: '#4f86f7', lineStyle: 'solid',
      visible: true, isActive: true, sortOrder: 0, leverPayload: emptyLeverPayload(),
      createdAt: 't', updatedAt: 't',
    } as Scenario],
    isLoading: false, error: null,
    horizonMonths: 360,
    inflation: 0.025, defaultReturnRate: 0.07,
    updateLever: vi.fn().mockResolvedValue(undefined) as any,
  });
  useLoansStore.setState({
    loans: [
      { id: 1, householdId: 1, name: 'Auto', type: 'AUTO', currentBalance: 18400, interestRate: 0.059, monthlyPayment: 425, termMonths: 60, firstPaymentDate: '2026-05-01' } as any,
      { id: 2, householdId: 1, name: 'Student', type: 'STUDENT', currentBalance: 32000, interestRate: 0.045, monthlyPayment: 350, termMonths: 120, firstPaymentDate: '2024-01-01' } as any,
    ],
    isLoading: false, error: null, load: async () => {},
  } as any);
}

describe('ExtraLoanPaymentsPopover', () => {
  beforeEach(() => { resetStores(); });

  it('renders one row per loan when open', () => {
    render(<MemoryRouter><ExtraLoanPaymentsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    expect(screen.getByText('Auto')).toBeInTheDocument();
    expect(screen.getByText('Student')).toBeInTheDocument();
  });

  it('typing into a row\'s extra-monthly input updates the live preview', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ExtraLoanPaymentsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    const input = screen.getAllByLabelText(/extra \/ mo/i)[0];
    await user.clear(input);
    await user.type(input, '300');
    await waitFor(() => expect(screen.getAllByText(/Payoff:/)[0]).toBeInTheDocument());
    expect(screen.getAllByText(/–\d+ months/)[0]).toBeInTheDocument();
  });

  it('clicking Apply calls updateLever with the assembled extraLoanPayments slice', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<MemoryRouter><ExtraLoanPaymentsPopover open onOpenChange={onOpenChange} /></MemoryRouter>);
    const input = screen.getAllByLabelText(/extra \/ mo/i)[0];
    await user.clear(input);
    await user.type(input, '300');
    await user.click(screen.getByRole('button', { name: /apply/i }));
    const updateLever = (useScenariosStore.getState() as any).updateLever as ReturnType<typeof vi.fn>;
    expect(updateLever).toHaveBeenCalledWith(1, expect.objectContaining({
      extraLoanPayments: [expect.objectContaining({ loanId: 1, extraMonthly: 300 })],
    }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('Reset reverts draft edits to the persisted lever value', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ExtraLoanPaymentsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    const input = screen.getAllByLabelText(/extra \/ mo/i)[0];
    await user.clear(input);
    await user.type(input, '300');
    expect((input as HTMLInputElement).value).toBe('300');
    await user.click(screen.getByRole('button', { name: /reset/i }));
    expect((input as HTMLInputElement).value).toBe('0');
  });

  it('honors an existing extraLoanPayments lever as initial draft', () => {
    useScenariosStore.setState({
      scenarios: [{
        id: 1, name: 'Baseline', isBaseline: true, color: '#4f86f7', lineStyle: 'solid',
        visible: true, isActive: true, sortOrder: 0,
        leverPayload: { ...emptyLeverPayload(), extraLoanPayments: [{ loanId: 2, extraMonthly: 150 }] },
        createdAt: 't', updatedAt: 't',
      } as Scenario],
      isLoading: false, error: null,
      horizonMonths: 360,
      inflation: 0.025, defaultReturnRate: 0.07,
      updateLever: vi.fn().mockResolvedValue(undefined) as any,
    });
    render(<MemoryRouter><ExtraLoanPaymentsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    const inputs = screen.getAllByLabelText(/extra \/ mo/i);
    expect((inputs[0] as HTMLInputElement).value).toBe('0');
    expect((inputs[1] as HTMLInputElement).value).toBe('150');
  });
});

describe('never-pays-off guard (wave-7 W1)', () => {
  // $300k @ 6% → $1,500/mo interest; the $1,000 contract payment loses ground.
  const seedUnderwater = () => {
    useLoansStore.setState({
      loans: [
        {
          id: 9, householdId: 1, name: 'Underwater', type: 'MORTGAGE',
          currentBalance: 300000, interestRate: 0.06, monthlyPayment: 1000,
          termMonths: 360, firstPaymentDate: '2020-01-01',
        } as any,
      ],
      isLoading: false, error: null, load: async () => {},
    } as any);
  };

  it('replaces the preview with the warning note when payment + extra never pays off', async () => {
    resetStores();
    seedUnderwater();
    const user = userEvent.setup();
    render(<MemoryRouter><ExtraLoanPaymentsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    // $25 extra still leaves $1,025 < $1,500/mo interest.
    const input = screen.getAllByLabelText(/extra \/ mo/i)[0];
    await user.clear(input);
    await user.type(input, '25');
    const note = screen.getByTestId('whatif-extra-never-payoff-9');
    expect(note).toHaveTextContent(/never pays off/i);
    expect(screen.queryByText(/Payoff:/)).not.toBeInTheDocument();
  });

  it('rescued: shows the real payoff but suppresses the capped-baseline comparison', async () => {
    resetStores();
    seedUnderwater();
    const user = userEvent.setup();
    render(<MemoryRouter><ExtraLoanPaymentsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    // $2,000 extra → $3,000/mo amortizes (~139 months).
    const input = screen.getAllByLabelText(/extra \/ mo/i)[0];
    await user.clear(input);
    await user.type(input, '2000');
    const rescued = screen.getByTestId('whatif-extra-rescued-9');
    expect(rescued).toHaveTextContent(/^Payoff: [A-Z][a-z]{2} \d{4} — without this extra it never pays off$/);
    // No fake "(–N months)" saving against the cap.
    expect(rescued.textContent).not.toMatch(/months\)/);
    expect(screen.queryByTestId('whatif-extra-never-payoff-9')).not.toBeInTheDocument();
  });

  it('a healthy loan keeps the exact classic preview string', async () => {
    resetStores(); // the file's standard two healthy loans
    const user = userEvent.setup();
    render(<MemoryRouter><ExtraLoanPaymentsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    const input = screen.getAllByLabelText(/extra \/ mo/i)[0];
    await user.clear(input);
    await user.type(input, '300');
    expect(screen.getAllByText(/Payoff: .+ → was .+ \(–\d+ months\)/)[0]).toBeInTheDocument();
    expect(screen.queryByTestId(/whatif-extra-never-payoff/)).not.toBeInTheDocument();
  });
});

// v1.7.0 R4 review MINOR 1: the payoff preview re-anchors each loan at its
// next due date on or after "today" (nextPaymentDateFrom), and today was the
// UTC day. A loan due the local day was pushed a month out on a New York
// evening (UTC is already past the due date); on an Auckland morning a loan
// due the local YESTERDAY (still the UTC today) stayed in this month. The
// preview anchors on the local day. Loan: $1,000 at 12%, $510/mo — two
// payments, so the baseline payoff is the month after the next due date.
describe('ExtraLoanPaymentsPopover — the preview anchors on the LOCAL day', () => {
  const ORIGINAL_TZ = process.env.TZ;
  beforeEach(() => {
    resetStores();
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  const loan = (id: number, name: string, firstPaymentDate: string) => ({
    id, householdId: 1, name, type: 'PERSONAL', currentBalance: 1000, interestRate: 0.12,
    monthlyPayment: 510, termMonths: 24, firstPaymentDate,
  });
  function seedLoans(loans: ReturnType<typeof loan>[]) {
    useLoansStore.setState({ loans: loans as never, isLoading: false, error: null, load: async () => {} } as never);
    const payload = emptyLeverPayload();
    payload.extraLoanPayments = loans.map((l) => ({ loanId: l.id, extraMonthly: 100 }));
    useScenariosStore.setState({
      scenarios: [{ ...useScenariosStore.getState().scenarios[0], leverPayload: payload }] as Scenario[],
    });
    render(<MemoryRouter><ExtraLoanPaymentsPopover open onOpenChange={() => {}} /></MemoryRouter>);
  }
  const previewOf = (name: string) => screen.getByText(name).parentElement!.textContent ?? '';

  it('New York, 23:33 EDT (03:33 UTC the next day): due the local 24th → paid off in October', () => {
    process.env.TZ = 'America/New_York';
    vi.setSystemTime(new Date('2026-09-25T03:33:00Z'));
    seedLoans([loan(7, 'Due today', '2026-01-24')]);
    expect(previewOf('Due today')).toMatch(/was Oct 2026/);
  });

  it('Pacific/Auckland, 09:00 NZST (21:00 UTC the previous day): due the local 25th → October; due the local 24th → November', () => {
    process.env.TZ = 'Pacific/Auckland';
    vi.setSystemTime(new Date('2026-09-24T21:00:00Z'));
    seedLoans([loan(7, 'Due today', '2026-01-25'), loan(8, 'Due yesterday', '2026-01-24')]);
    expect(previewOf('Due today')).toMatch(/was Oct 2026/);
    expect(previewOf('Due yesterday')).toMatch(/was Nov 2026/);
  });
});
