import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ReturnSchedulePopover from '@/components/whatif/levers/ReturnSchedulePopover';
import { useScenariosStore } from '@/stores/scenarios-store';
import { emptyLeverPayload } from '@/lib/scenarios';
import { CompoundingFrequency } from '@/types/enums';
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
    // After the 2026-05-27 semantic-token sweep, positive overrides carry
    // the --success token tint and negatives carry --destructive.
    expect(cells[0].className).toMatch(/bg-success/);
    // Set year 1 to a negative value — must be the destructive (red) tint.
    await user.click(cells[1]);
    fireEvent.change(screen.getByLabelText(/selected year return/i), { target: { value: '-2' } });
    expect(cells[1].className).toMatch(/bg-destructive/);
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

describe('ReturnSchedulePopover — Cash APY override', () => {
  beforeEach(() => { resetStore(); });

  it('renders a "Cash APY" input below investment returns', () => {
    render(<MemoryRouter><ReturnSchedulePopover open onOpenChange={() => {}} /></MemoryRouter>);
    expect(screen.getByLabelText(/cash apy.*this scenario/i)).toBeInTheDocument();
  });

  it('shows empty input when cashRate is null in leverPayload', () => {
    render(<MemoryRouter><ReturnSchedulePopover open onOpenChange={() => {}} /></MemoryRouter>);
    const input = screen.getByLabelText(/cash apy.*this scenario/i) as HTMLInputElement;
    expect(input.value).toBe('');
  });

  it('shows cashRate as a percentage when pre-set (0.045 → "4.50")', () => {
    const payload = emptyLeverPayload();
    payload.returns = { ...payload.returns, cashRate: 0.045 };
    useScenariosStore.setState({
      ...useScenariosStore.getState(),
      scenarios: [{
        id: 1, name: 'S1', isBaseline: true, color: '#000', lineStyle: 'solid',
        visible: true, isActive: true, sortOrder: 0, leverPayload: payload,
        createdAt: 't', updatedAt: 't',
      } as Scenario],
    });
    render(<MemoryRouter><ReturnSchedulePopover open onOpenChange={() => {}} /></MemoryRouter>);
    const input = screen.getByLabelText(/cash apy.*this scenario/i) as HTMLInputElement;
    expect(input.value).toBe('4.50');
  });

  it('typing a Cash APY value and applying writes cashRate as decimal to leverPayload', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ReturnSchedulePopover open onOpenChange={() => {}} /></MemoryRouter>);
    const cashApyInput = screen.getByLabelText(/cash apy.*this scenario/i);
    fireEvent.change(cashApyInput, { target: { value: '3.5' } });
    await user.click(screen.getByRole('button', { name: /^apply$/i }));
    const updateLever = (useScenariosStore.getState() as any).updateLever as ReturnType<typeof vi.fn>;
    const call = updateLever.mock.calls.at(-1)!;
    expect(call[1].returns.cashRate).toBeCloseTo(0.035, 6);
  });

  it('clearing the Cash APY input and applying writes cashRate as null', async () => {
    const user = userEvent.setup();
    const payload = emptyLeverPayload();
    payload.returns = { ...payload.returns, cashRate: 0.04 };
    useScenariosStore.setState({
      ...useScenariosStore.getState(),
      scenarios: [{
        id: 1, name: 'S1', isBaseline: true, color: '#000', lineStyle: 'solid',
        visible: true, isActive: true, sortOrder: 0, leverPayload: payload,
        createdAt: 't', updatedAt: 't',
      } as Scenario],
    });
    render(<MemoryRouter><ReturnSchedulePopover open onOpenChange={() => {}} /></MemoryRouter>);
    const cashApyInput = screen.getByLabelText(/cash apy.*this scenario/i);
    await user.clear(cashApyInput);
    await user.click(screen.getByRole('button', { name: /^apply$/i }));
    const updateLever = (useScenariosStore.getState() as any).updateLever as ReturnType<typeof vi.fn>;
    const call = updateLever.mock.calls.at(-1)!;
    expect(call[1].returns.cashRate).toBeNull();
  });

  it('Reset reverts the Cash APY input to the stored value', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ReturnSchedulePopover open onOpenChange={() => {}} /></MemoryRouter>);
    const cashApyInput = screen.getByLabelText(/cash apy.*this scenario/i);
    fireEvent.change(cashApyInput, { target: { value: '8' } });
    expect((cashApyInput as HTMLInputElement).value).toBe('8');
    await user.click(screen.getByRole('button', { name: /reset/i }));
    expect((cashApyInput as HTMLInputElement).value).toBe('');
  });
});

describe('ReturnSchedulePopover — compounding frequency selector (Task #16)', () => {
  beforeEach(() => { resetStore(); });

  it('renders a "Compounding frequency" selector', () => {
    render(<MemoryRouter><ReturnSchedulePopover open onOpenChange={() => {}} /></MemoryRouter>);
    expect(screen.getByLabelText(/compounding frequency/i)).toBeInTheDocument();
  });

  it('defaults to MONTHLY when no override is set', () => {
    render(<MemoryRouter><ReturnSchedulePopover open onOpenChange={() => {}} /></MemoryRouter>);
    const select = screen.getByLabelText(/compounding frequency/i) as HTMLSelectElement;
    expect(select.value).toBe(CompoundingFrequency.MONTHLY);
  });

  it('exposes all five frequency options', () => {
    render(<MemoryRouter><ReturnSchedulePopover open onOpenChange={() => {}} /></MemoryRouter>);
    const select = screen.getByLabelText(/compounding frequency/i) as HTMLSelectElement;
    const optionValues = Array.from(select.options).map((o) => o.value);
    expect(optionValues).toEqual(
      expect.arrayContaining([
        CompoundingFrequency.DAILY,
        CompoundingFrequency.WEEKLY,
        CompoundingFrequency.MONTHLY,
        CompoundingFrequency.QUARTERLY,
        CompoundingFrequency.ANNUALLY,
      ]),
    );
  });

  it('selecting DAILY and applying saves compoundingFrequency=DAILY to leverPayload', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ReturnSchedulePopover open onOpenChange={() => {}} /></MemoryRouter>);
    const select = screen.getByLabelText(/compounding frequency/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: CompoundingFrequency.DAILY } });
    await user.click(screen.getByRole('button', { name: /^apply$/i }));
    const updateLever = (useScenariosStore.getState() as any).updateLever as ReturnType<typeof vi.fn>;
    const call = updateLever.mock.calls.at(-1)!;
    expect(call[1].returns.compoundingFrequency).toBe(CompoundingFrequency.DAILY);
  });

  it('prefills the selector from the existing leverPayload.compoundingFrequency', () => {
    const payload = emptyLeverPayload();
    payload.returns = { ...payload.returns, compoundingFrequency: CompoundingFrequency.QUARTERLY };
    useScenariosStore.setState({
      ...useScenariosStore.getState(),
      scenarios: [{
        id: 1, name: 'S1', isBaseline: true, color: '#000', lineStyle: 'solid',
        visible: true, isActive: true, sortOrder: 0, leverPayload: payload,
        createdAt: 't', updatedAt: 't',
      } as Scenario],
    });
    render(<MemoryRouter><ReturnSchedulePopover open onOpenChange={() => {}} /></MemoryRouter>);
    const select = screen.getByLabelText(/compounding frequency/i) as HTMLSelectElement;
    expect(select.value).toBe(CompoundingFrequency.QUARTERLY);
  });

  it('Reset reverts the compounding frequency to the stored value', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ReturnSchedulePopover open onOpenChange={() => {}} /></MemoryRouter>);
    const select = screen.getByLabelText(/compounding frequency/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: CompoundingFrequency.DAILY } });
    expect(select.value).toBe(CompoundingFrequency.DAILY);
    await user.click(screen.getByRole('button', { name: /reset/i }));
    expect(select.value).toBe(CompoundingFrequency.MONTHLY);
  });

  it('renders the helper sentence near the selector', () => {
    render(<MemoryRouter><ReturnSchedulePopover open onOpenChange={() => {}} /></MemoryRouter>);
    expect(
      screen.getByText(/compounding frequency applies to investment returns and cash apy/i),
    ).toBeInTheDocument();
  });
});
