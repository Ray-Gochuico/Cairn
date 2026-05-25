import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ExpensePeriodsPopover from '@/components/whatif/levers/ExpensePeriodsPopover';
import { useScenariosStore } from '@/stores/scenarios-store';
import { useHouseholdStore } from '@/stores/household-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { emptyLeverPayload } from '@/lib/scenarios';
import { FilingStatus } from '@/types/enums';
import type { Scenario } from '@/types/scenario';
import type { Transaction } from '@/types/schema';

const tx = (id: number, date: string, amount: number): Transaction =>
  ({ id, householdId: 1, date, amount, merchant: 'X', merchantRaw: null, categoryId: 5, sourceAccountId: 2 } as unknown as Transaction);

function resetStores(opts: { transactions?: Transaction[]; monthlyExpenseBaseline?: number } = {}) {
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
  useHouseholdStore.setState({
    household: {
      filingStatus: FilingStatus.SINGLE, state: 'CA', city: null,
      monthlyExpenseBaseline: opts.monthlyExpenseBaseline ?? 0,
    } as any,
    isLoading: false, error: null,
    update: vi.fn().mockResolvedValue(undefined) as any,
  });
  useTransactionsStore.setState({
    transactions: opts.transactions ?? [],
    isLoading: false, error: null,
  } as any);
}

describe('ExpensePeriodsPopover', () => {
  beforeEach(() => { resetStores(); });

  it('clicking + Add appends a row and shows the live total-cost preview', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ExpensePeriodsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /add period/i }));
    fireEvent.change(screen.getByLabelText(/start \(YYYY-MM-DD\)/i), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByLabelText(/Δ monthly/i), { target: { value: '1500' } });
    fireEvent.change(screen.getByLabelText(/duration/i), { target: { value: '6' } });
    expect(await screen.findByText(/\$9,000\s*total/i)).toBeInTheDocument();
  });

  it('Apply calls updateLever with the expensePeriods slice', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ExpensePeriodsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /add period/i }));
    fireEvent.change(screen.getByLabelText(/start \(YYYY-MM-DD\)/i), { target: { value: '2026-07-01' } });
    fireEvent.change(screen.getByLabelText(/Δ monthly/i), { target: { value: '1500' } });
    fireEvent.change(screen.getByLabelText(/duration/i), { target: { value: '6' } });
    await user.click(screen.getByRole('button', { name: /apply/i }));
    const updateLever = (useScenariosStore.getState() as any).updateLever as ReturnType<typeof vi.fn>;
    expect(updateLever).toHaveBeenCalledWith(1, expect.objectContaining({
      expensePeriods: [expect.objectContaining({ start: '2026-07-01', monthlyDelta: 1500, durationMonths: 6 })],
    }));
  });

  it('renders a Custom baseline input at the top', () => {
    render(<MemoryRouter><ExpensePeriodsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    expect(screen.getByLabelText(/custom monthly baseline/i)).toBeInTheDocument();
  });

  it('shows up to 6 recent-month chips and a 12mo rolling-avg chip when transactions exist', () => {
    const txs: Transaction[] = [];
    let id = 1;
    // Build 7 distinct months of outflows so we can prove the popover trims to 6.
    const months = ['2026-04', '2026-03', '2026-02', '2026-01', '2025-12', '2025-11', '2025-10'];
    for (const m of months) {
      txs.push(tx(id++, `${m}-15`, 1000 + id * 50));
    }
    resetStores({ transactions: txs });
    render(<MemoryRouter><ExpensePeriodsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    const wrapper = screen.getByTestId('expense-baseline-suggestions');
    // 6 month chips + 1 rolling-avg chip.
    const buttons = within(wrapper).getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(7);
    expect(within(wrapper).getByText(/12mo avg/i)).toBeInTheDocument();
  });

  it('clicking a month chip sets the baseline input value', async () => {
    const user = userEvent.setup();
    const txs = [tx(1, '2026-04-15', 3000), tx(2, '2026-04-20', 1500)];
    resetStores({ transactions: txs });
    render(<MemoryRouter><ExpensePeriodsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    const aprChip = screen.getByRole('button', { name: /set baseline to apr total/i });
    await user.click(aprChip);
    const input = screen.getByLabelText(/custom monthly baseline/i) as HTMLInputElement;
    expect(Number(input.value)).toBe(4500);
  });

  it('Apply persists the baseline via household.update when it has changed', async () => {
    const user = userEvent.setup();
    const txs = [tx(1, '2026-04-15', 4500)];
    resetStores({ transactions: txs });
    render(<MemoryRouter><ExpensePeriodsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    const chip = screen.getByRole('button', { name: /set baseline to apr total/i });
    await user.click(chip);
    await user.click(screen.getByRole('button', { name: /apply/i }));
    const update = (useHouseholdStore.getState() as any).update as ReturnType<typeof vi.fn>;
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ monthlyExpenseBaseline: 4500 }));
  });

  it('shows a friendly empty state when there are no transactions', () => {
    render(<MemoryRouter><ExpensePeriodsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    expect(screen.getByText(/no transactions yet/i)).toBeInTheDocument();
  });
});
