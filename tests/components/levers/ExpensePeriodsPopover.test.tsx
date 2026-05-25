import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ExpensePeriodsPopover from '@/components/whatif/levers/ExpensePeriodsPopover';
import { useScenariosStore } from '@/stores/scenarios-store';
import { emptyLeverPayload } from '@/lib/scenarios';
import type { Scenario } from '@/types/scenario';

function resetStore() {
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
}

describe('ExpensePeriodsPopover', () => {
  beforeEach(() => { resetStore(); });

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
});
