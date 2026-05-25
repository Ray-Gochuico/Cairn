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
    // UI accepts percentage values (15 means 15%, not 1500%).
    fireEvent.change(slider, { target: { value: '15' } });
    expect((slider as HTMLInputElement).value).toBe('15.00');
  });

  it('renders the selected-year value as a percentage (not a raw decimal)', () => {
    render(<MemoryRouter><ReturnSchedulePopover open onOpenChange={() => {}} /></MemoryRouter>);
    const slider = screen.getByLabelText(/selected year return/i) as HTMLInputElement;
    // Default rate 0.07 should render as "7.00", not "0.07".
    expect(slider.value).toBe('7.00');
  });

  it('stores edits as decimals internally (7% input → 0.07 stored override on Apply)', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ReturnSchedulePopover open onOpenChange={() => {}} /></MemoryRouter>);
    const strip = screen.getByTestId('returns-year-strip');
    const cells = within(strip).getAllByRole('button');
    await user.click(cells[1]);
    const slider = screen.getByLabelText(/selected year return/i);
    fireEvent.change(slider, { target: { value: '12' } });
    await user.click(screen.getByRole('button', { name: /apply/i }));
    const updateLever = (useScenariosStore.getState() as any).updateLever as ReturnType<typeof vi.fn>;
    const call = updateLever.mock.calls.at(-1)!;
    const overrides = call[1].returns.overrides;
    const yearKey = Object.keys(overrides)[0];
    expect(overrides[yearKey]).toBeCloseTo(0.12, 6);
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

  it('year-strip colors any positive override green and any negative override red', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ReturnSchedulePopover open onOpenChange={() => {}} /></MemoryRouter>);
    const strip = screen.getByTestId('returns-year-strip');
    const cells = within(strip).getAllByRole('button');
    // Set year 0 to a positive value below the default rate — must still be green.
    await user.click(cells[0]);
    fireEvent.change(screen.getByLabelText(/selected year return/i), { target: { value: '3' } });
    expect(cells[0].className).toMatch(/bg-green-200/);
    // Set year 1 to a negative value — must be red.
    await user.click(cells[1]);
    fireEvent.change(screen.getByLabelText(/selected year return/i), { target: { value: '-2' } });
    expect(cells[1].className).toMatch(/bg-red-200/);
  });

  it('Constant X% preset opens an input and writes a new defaultRate', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ReturnSchedulePopover open onOpenChange={() => {}} /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /constant x%/i }));
    const wrapper = screen.getByTestId('constant-x-input');
    const constantInput = within(wrapper).getByRole('spinbutton') as HTMLInputElement;
    fireEvent.change(constantInput, { target: { value: '5' } });
    await user.click(within(wrapper).getByRole('button', { name: /apply constant rate/i }));
    await user.click(screen.getByRole('button', { name: /^apply$/i }));
    const updateLever = (useScenariosStore.getState() as any).updateLever as ReturnType<typeof vi.fn>;
    const call = updateLever.mock.calls.at(-1)!;
    expect(call[1].returns.defaultRate).toBeCloseTo(0.05, 6);
    expect(call[1].returns.overrides).toEqual({});
  });
});
