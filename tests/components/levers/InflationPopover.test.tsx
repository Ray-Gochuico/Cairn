import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import InflationPopover from '@/components/whatif/levers/InflationPopover';
import { useScenariosStore } from '@/stores/scenarios-store';
import { useHouseholdStore } from '@/stores/household-store';
import { useSettingsStore } from '@/stores/settings-store';
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
    updateLever: vi.fn().mockResolvedValue(undefined) as never,
  });
  useHouseholdStore.setState({
    household: { inflationAssumption: 0.025, withdrawalRate: 0.04 } as never,
  } as never);
  useSettingsStore.setState({
    settings: { defaultInflation: 0.02 } as never,
  } as never);
}

describe('InflationPopover', () => {
  beforeEach(() => { resetStores(); });

  it('renders one year cell per horizon year (30y default)', () => {
    render(<MemoryRouter><InflationPopover open onOpenChange={() => {}} /></MemoryRouter>);
    const strip = screen.getByTestId('inflation-year-strip');
    expect(within(strip).getAllByRole('button').length).toBe(30);
  });

  it('renders the default-inflation input blank when scenario.inflation.defaultRate is null', () => {
    render(<MemoryRouter><InflationPopover open onOpenChange={() => {}} /></MemoryRouter>);
    const input = screen.getByLabelText(/default inflation \(this scenario\)/i) as HTMLInputElement;
    expect(input.value).toBe('');
  });

  it('shows the household fallback as placeholder', () => {
    render(<MemoryRouter><InflationPopover open onOpenChange={() => {}} /></MemoryRouter>);
    const input = screen.getByLabelText(/default inflation \(this scenario\)/i) as HTMLInputElement;
    // Household inflationAssumption is 0.025 → 2.50% placeholder
    expect(input.placeholder).toBe('2.50');
  });

  it('shows scenario.inflation.defaultRate as a percentage when set (0.045 → "4.50")', () => {
    const payload = emptyLeverPayload();
    payload.inflation = { defaultRate: 0.045, overrides: {} };
    useScenariosStore.setState({
      ...useScenariosStore.getState(),
      scenarios: [{
        id: 1, name: 'S1', isBaseline: true, color: '#000', lineStyle: 'solid',
        visible: true, isActive: true, sortOrder: 0, leverPayload: payload,
        createdAt: 't', updatedAt: 't',
      } as Scenario],
    });
    render(<MemoryRouter><InflationPopover open onOpenChange={() => {}} /></MemoryRouter>);
    const input = screen.getByLabelText(/default inflation \(this scenario\)/i) as HTMLInputElement;
    expect(input.value).toBe('4.50');
  });

  it('typing a defaultRate value and applying writes the decimal to leverPayload.inflation.defaultRate', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><InflationPopover open onOpenChange={() => {}} /></MemoryRouter>);
    const input = screen.getByLabelText(/default inflation \(this scenario\)/i);
    fireEvent.change(input, { target: { value: '3.5' } });
    await user.click(screen.getByRole('button', { name: /^apply$/i }));
    const updateLever = (useScenariosStore.getState() as unknown as { updateLever: ReturnType<typeof vi.fn> }).updateLever;
    const call = updateLever.mock.calls.at(-1)!;
    expect(call[1].inflation.defaultRate).toBeCloseTo(0.035, 6);
  });

  it('clearing the defaultRate input and applying writes null to leverPayload.inflation.defaultRate', async () => {
    const user = userEvent.setup();
    const payload = emptyLeverPayload();
    payload.inflation = { defaultRate: 0.05, overrides: {} };
    useScenariosStore.setState({
      ...useScenariosStore.getState(),
      scenarios: [{
        id: 1, name: 'S1', isBaseline: true, color: '#000', lineStyle: 'solid',
        visible: true, isActive: true, sortOrder: 0, leverPayload: payload,
        createdAt: 't', updatedAt: 't',
      } as Scenario],
    });
    render(<MemoryRouter><InflationPopover open onOpenChange={() => {}} /></MemoryRouter>);
    const input = screen.getByLabelText(/default inflation \(this scenario\)/i);
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: /^apply$/i }));
    const updateLever = (useScenariosStore.getState() as unknown as { updateLever: ReturnType<typeof vi.fn> }).updateLever;
    const call = updateLever.mock.calls.at(-1)!;
    expect(call[1].inflation.defaultRate).toBeNull();
  });

  it('clicking a year cell selects it and the year-input edits that year', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><InflationPopover open onOpenChange={() => {}} /></MemoryRouter>);
    const strip = screen.getByTestId('inflation-year-strip');
    const cells = within(strip).getAllByRole('button');
    await user.click(cells[2]);
    const slider = screen.getByLabelText(/selected year inflation/i);
    expect(slider).toBeInTheDocument();
    fireEvent.change(slider, { target: { value: '10' } });
    expect((slider as HTMLInputElement).value).toBe('10.00');
  });

  it('a per-year override commits as a decimal on Apply', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><InflationPopover open onOpenChange={() => {}} /></MemoryRouter>);
    const strip = screen.getByTestId('inflation-year-strip');
    const cells = within(strip).getAllByRole('button');
    await user.click(cells[1]);
    const slider = screen.getByLabelText(/selected year inflation/i);
    fireEvent.change(slider, { target: { value: '8' } });
    await user.click(screen.getByRole('button', { name: /^apply$/i }));
    const updateLever = (useScenariosStore.getState() as unknown as { updateLever: ReturnType<typeof vi.fn> }).updateLever;
    const call = updateLever.mock.calls.at(-1)!;
    const overrides = call[1].inflation.overrides;
    const yearKey = Object.keys(overrides)[0];
    expect(overrides[yearKey]).toBeCloseTo(0.08, 6);
  });

  it('"↺ Default" button removes a per-year override', async () => {
    const user = userEvent.setup();
    const payload = emptyLeverPayload();
    const thisYear = String(new Date().getFullYear());
    payload.inflation = { defaultRate: null, overrides: { [thisYear]: 0.08 } };
    useScenariosStore.setState({
      ...useScenariosStore.getState(),
      scenarios: [{
        id: 1, name: 'S1', isBaseline: true, color: '#000', lineStyle: 'solid',
        visible: true, isActive: true, sortOrder: 0, leverPayload: payload,
        createdAt: 't', updatedAt: 't',
      } as Scenario],
    });
    render(<MemoryRouter><InflationPopover open onOpenChange={() => {}} /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /revert selected year/i }));
    await user.click(screen.getByRole('button', { name: /^apply$/i }));
    const updateLever = (useScenariosStore.getState() as unknown as { updateLever: ReturnType<typeof vi.fn> }).updateLever;
    const call = updateLever.mock.calls.at(-1)!;
    expect(call[1].inflation.overrides).toEqual({});
  });

  it('Apply with no edits leaves inflation field as-stored', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><InflationPopover open onOpenChange={() => {}} /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /^apply$/i }));
    const updateLever = (useScenariosStore.getState() as unknown as { updateLever: ReturnType<typeof vi.fn> }).updateLever;
    expect(updateLever).toHaveBeenCalledWith(1, expect.objectContaining({
      inflation: expect.objectContaining({ defaultRate: null, overrides: {} }),
    }));
  });
});

describe('LeverBar — Inflation pill renders + has count badge', () => {
  it('renders the Inflation pill and shows a count badge per per-year override', async () => {
    // This test uses the actual LeverBar (the LeverBar test file mocks
    // everything, so we re-render here against the real store/HouseholdStore).
    // We can verify the pill button shows up on the page using getByRole.
    const { default: LeverBar } = await import('@/components/whatif/LeverBar');
    resetStores();
    const payload = emptyLeverPayload();
    payload.inflation = { defaultRate: null, overrides: { '2030': 0.05, '2031': 0.06 } };
    useScenariosStore.setState({
      ...useScenariosStore.getState(),
      scenarios: [{
        id: 1, name: 'Baseline', isBaseline: true, color: '#4f86f7', lineStyle: 'solid',
        visible: true, isActive: true, sortOrder: 0, leverPayload: payload,
        createdAt: 't', updatedAt: 't',
      } as Scenario],
    });
    render(<MemoryRouter><LeverBar /></MemoryRouter>);
    const pill = screen.getByRole('button', { name: /^inflation$/i });
    expect(pill).toBeInTheDocument();
    expect(pill).toHaveTextContent(/Inflation\s*·\s*2/);
  });
});
