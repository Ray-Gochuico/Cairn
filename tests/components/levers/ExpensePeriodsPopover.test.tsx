import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ExpensePeriodsPopover from '@/components/whatif/levers/ExpensePeriodsPopover';
import { useScenariosStore } from '@/stores/scenarios-store';
import { emptyLeverPayload } from '@/lib/scenarios';
import type { Scenario } from '@/types/scenario';
import type { ExpensePeriod } from '@/lib/scenarios';

function resetStores(opts: { expensePeriods?: ExpensePeriod[] } = {}) {
  const payload = emptyLeverPayload();
  if (opts.expensePeriods) payload.expensePeriods = opts.expensePeriods;
  useScenariosStore.setState({
    scenarios: [{
      id: 1, name: 'Baseline', isBaseline: true, color: '#4f86f7', lineStyle: 'solid',
      visible: true, isActive: true, sortOrder: 0, leverPayload: payload,
      createdAt: 't', updatedAt: 't',
    } as Scenario],
    isLoading: false, error: null,
    horizonMonths: 360, dollarMode: 'nominal',
    inflation: 0.025, defaultReturnRate: 0.07,
    updateLever: vi.fn().mockResolvedValue(undefined) as any,
  });
}

const today = new Date();
const todayMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
const todayDate = `${todayMonth}-01`;

describe('ExpensePeriodsPopover', () => {
  beforeEach(() => { resetStores(); });

  it('clicking + Add appends a row and shows the live total-cost preview', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ExpensePeriodsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /add period/i }));
    fireEvent.change(screen.getByLabelText(/start \(YYYY-MM-DD\)/i), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByLabelText(/Monthly expense/i), { target: { value: '1500' } });
    fireEvent.change(screen.getByLabelText(/duration/i), { target: { value: '6' } });
    expect(await screen.findByText(/\$9,000\s*total/i)).toBeInTheDocument();
  });

  it('Apply calls updateLever with the expensePeriods slice', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ExpensePeriodsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /add period/i }));
    fireEvent.change(screen.getByLabelText(/start \(YYYY-MM-DD\)/i), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByLabelText(/Monthly expense/i), { target: { value: '1500' } });
    fireEvent.change(screen.getByLabelText(/duration/i), { target: { value: '6' } });
    await user.click(screen.getByRole('button', { name: /apply/i }));
    const updateLever = (useScenariosStore.getState() as any).updateLever as ReturnType<typeof vi.fn>;
    expect(updateLever).toHaveBeenCalledWith(1, expect.objectContaining({
      expensePeriods: [expect.objectContaining({ start: '2026-07-01', monthlyDelta: 1500, durationMonths: 6 })],
    }));
  });
});

describe('ExpensePeriodsPopover — monthly + annual summary (revamp 2026-05-26)', () => {
  it('shows the current monthly expense at the top', async () => {
    resetStores({
      expensePeriods: [{ start: todayDate, monthlyDelta: 5000, durationMonths: 12 }],
    });
    render(<MemoryRouter><ExpensePeriodsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    expect(screen.getByTestId('expense-summary-monthly')).toHaveTextContent(/\$5,000/);
    expect(screen.getByTestId('expense-summary-annual')).toHaveTextContent(/\$60,000/);
  });

  it('updates the summary live as the user edits a period', async () => {
    resetStores({
      expensePeriods: [{ start: todayDate, monthlyDelta: 5000, durationMonths: 12 }],
    });
    render(<MemoryRouter><ExpensePeriodsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    const input = screen.getByLabelText(/Monthly expense/i);
    fireEvent.change(input, { target: { value: '6000' } });
    expect(screen.getByTestId('expense-summary-monthly')).toHaveTextContent(/\$6,000/);
    expect(screen.getByTestId('expense-summary-annual')).toHaveTextContent(/\$72,000/);
  });

  it('shows $0/mo when there are no active periods', () => {
    resetStores({ expensePeriods: [] });
    render(<MemoryRouter><ExpensePeriodsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    expect(screen.getByTestId('expense-summary-monthly')).toHaveTextContent('$0');
  });
});

describe('ExpensePeriodsPopover — label changes (revamp 2026-05-26)', () => {
  it('shows "Monthly expense" label on the amount input (not "Δ monthly")', () => {
    resetStores({
      expensePeriods: [{ start: todayDate, monthlyDelta: 5000, durationMonths: 12 }],
    });
    render(<MemoryRouter><ExpensePeriodsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    expect(screen.getByLabelText(/^Monthly expense$/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Δ monthly$/)).toBeNull();
  });
});

describe('ExpensePeriodsPopover — baseline section removed (revamp 2026-05-26)', () => {
  it('does NOT render the monthly-expense-baseline input', () => {
    render(<MemoryRouter><ExpensePeriodsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    expect(screen.queryByLabelText(/Custom monthly baseline/i)).toBeNull();
    expect(screen.queryByTestId('expense-baseline-suggestions')).toBeNull();
  });

  it('does NOT render recent-month or 12mo-avg chips', () => {
    render(<MemoryRouter><ExpensePeriodsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    expect(screen.queryByText(/12mo avg/i)).toBeNull();
    expect(screen.queryByText(/no transactions yet/i)).toBeNull();
  });
});
