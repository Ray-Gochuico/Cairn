import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ReturnSchedulePopover from '@/components/whatif/levers/ReturnSchedulePopover';
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

describe('ReturnSchedulePopover', () => {
  beforeEach(() => { resetStore(); });

  it('renders one year cell per horizon year (30y default)', () => {
    render(<MemoryRouter><ReturnSchedulePopover open onOpenChange={() => {}} /></MemoryRouter>);
    const strip = screen.getByTestId('returns-year-strip');
    expect(within(strip).getAllByRole('button').length).toBe(30);
  });

  it('clicking a year cell selects it and the input edits that year', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ReturnSchedulePopover open onOpenChange={() => {}} /></MemoryRouter>);
    const strip = screen.getByTestId('returns-year-strip');
    const cells = within(strip).getAllByRole('button');
    await user.click(cells[2]);
    const slider = screen.getByLabelText(/selected year return/i);
    expect(slider).toBeInTheDocument();
    fireEvent.change(slider, { target: { value: '0.15' } });
    expect((slider as HTMLInputElement).value).toBe('0.15');
  });

  it('Constant 7% preset clears overrides', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ReturnSchedulePopover open onOpenChange={() => {}} /></MemoryRouter>);
    const strip = screen.getByTestId('returns-year-strip');
    const cells = within(strip).getAllByRole('button');
    await user.click(cells[0]);
    const slider = screen.getByLabelText(/selected year return/i);
    fireEvent.change(slider, { target: { value: '-0.1' } });
    await user.click(screen.getByRole('button', { name: /constant 7%/i }));
    await user.click(screen.getByRole('button', { name: /apply/i }));
    const updateLever = (useScenariosStore.getState() as any).updateLever as ReturnType<typeof vi.fn>;
    expect(updateLever).toHaveBeenCalledWith(1, expect.objectContaining({
      returns: expect.objectContaining({ defaultRate: 0.07, overrides: {} }),
    }));
  });

  it('Lost decade preset writes ten years of overrides', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ReturnSchedulePopover open onOpenChange={() => {}} /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /lost decade/i }));
    await user.click(screen.getByRole('button', { name: /apply/i }));
    const updateLever = (useScenariosStore.getState() as any).updateLever as ReturnType<typeof vi.fn>;
    const call = updateLever.mock.calls.at(-1)!;
    const overrides = call[1].returns.overrides;
    expect(Object.keys(overrides).length).toBeGreaterThanOrEqual(10);
  });

  it('Apply with no edits leaves overrides empty', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ReturnSchedulePopover open onOpenChange={() => {}} /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /apply/i }));
    const updateLever = (useScenariosStore.getState() as any).updateLever as ReturnType<typeof vi.fn>;
    expect(updateLever).toHaveBeenCalledWith(1, expect.objectContaining({
      returns: expect.objectContaining({ overrides: {} }),
    }));
  });
});
