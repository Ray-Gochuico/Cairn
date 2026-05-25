import { describe, it, expect, beforeEach, vi } from 'vitest';
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
    horizonMonths: 360, dollarMode: 'nominal',
    inflation: 0.025, defaultReturnRate: 0.07,
    projectionCache: new Map(),
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
      horizonMonths: 360, dollarMode: 'nominal',
      inflation: 0.025, defaultReturnRate: 0.07,
      projectionCache: new Map(),
      updateLever: vi.fn().mockResolvedValue(undefined) as any,
    });
    render(<MemoryRouter><ExtraLoanPaymentsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    const inputs = screen.getAllByLabelText(/extra \/ mo/i);
    expect((inputs[0] as HTMLInputElement).value).toBe('0');
    expect((inputs[1] as HTMLInputElement).value).toBe('150');
  });
});
