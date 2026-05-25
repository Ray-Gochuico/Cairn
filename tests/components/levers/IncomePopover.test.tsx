import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import IncomePopover from '@/components/whatif/levers/IncomePopover';
import { useScenariosStore } from '@/stores/scenarios-store';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { emptyLeverPayload } from '@/lib/scenarios';
import { FilingStatus } from '@/types/enums';
import type { Scenario } from '@/types/scenario';

function resetStores(twoPersons = false) {
  useHouseholdStore.setState({
    household: {
      filingStatus: twoPersons ? FilingStatus.MFJ : FilingStatus.SINGLE, state: 'CA', city: null,
    } as any,
    isLoading: false, error: null,
  });
  usePersonsStore.setState({
    persons: twoPersons
      ? [{ id: 1, annualSalaryPretax: 135000 } as any, { id: 2, annualSalaryPretax: 92000 } as any]
      : [{ id: 1, annualSalaryPretax: 135000 } as any],
    isLoading: false, error: null,
  });
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

describe('IncomePopover', () => {
  beforeEach(() => { resetStores(); });

  it('single-person household renders just one tab', () => {
    render(<MemoryRouter><IncomePopover open onOpenChange={() => {}} /></MemoryRouter>);
    expect(screen.queryByRole('tab', { name: /partner/i })).not.toBeInTheDocument();
  });

  it('two-person household renders two tabs', () => {
    resetStores(true);
    render(<MemoryRouter><IncomePopover open onOpenChange={() => {}} /></MemoryRouter>);
    expect(screen.getByRole('tab', { name: /you/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /partner/i })).toBeInTheDocument();
  });

  it('raise-rate input edits the active person\'s plan (percentage)', () => {
    render(<MemoryRouter><IncomePopover open onOpenChange={() => {}} /></MemoryRouter>);
    const slider = screen.getByLabelText(/annual raise rate/i) as HTMLInputElement;
    // Default 0.03 (3%) should render as "3.00", not "0.03".
    expect(slider.value).toBe('3.00');
    fireEvent.change(slider, { target: { value: '5' } });
    // After commit the controlled input reformats to two-decimal pct.
    expect(slider.value).toBe('5.00');
  });

  it('raise-rate input is stored as a decimal (5% → 0.05 on Apply)', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><IncomePopover open onOpenChange={() => {}} /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText(/annual raise rate/i), { target: { value: '5' } });
    await user.click(screen.getByRole('button', { name: /apply/i }));
    const updateLever = (useScenariosStore.getState() as any).updateLever as ReturnType<typeof vi.fn>;
    expect(updateLever).toHaveBeenCalledWith(1, expect.objectContaining({
      income: expect.objectContaining({
        perPerson: [expect.objectContaining({ annualRaiseRate: 0.05 })],
      }),
    }));
  });

  it('can add a promotion event and Apply writes the income lever slice', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><IncomePopover open onOpenChange={() => {}} /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /add income event/i }));
    await user.selectOptions(screen.getByLabelText(/type/i), 'promotion');
    fireEvent.change(screen.getByLabelText(/when/i), { target: { value: '2028-04-01' } });
    fireEvent.change(screen.getByLabelText(/new salary/i), { target: { value: '168000' } });
    await user.click(screen.getByRole('button', { name: /apply/i }));
    const updateLever = (useScenariosStore.getState() as any).updateLever as ReturnType<typeof vi.fn>;
    expect(updateLever).toHaveBeenCalledWith(1, expect.objectContaining({
      income: expect.objectContaining({
        perPerson: [expect.objectContaining({
          events: [expect.objectContaining({ type: 'promotion', when: '2028-04-01', newSalary: 168000 })],
        })],
      }),
    }));
  });

  it('sabbatical event renders the duration field', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><IncomePopover open onOpenChange={() => {}} /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /add income event/i }));
    await user.selectOptions(screen.getByLabelText(/type/i), 'sabbatical');
    expect(screen.getByLabelText(/duration \(months\)/i)).toBeInTheDocument();
  });

  it('raise event renders the deltaAmount field', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><IncomePopover open onOpenChange={() => {}} /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /add income event/i }));
    await user.selectOptions(screen.getByLabelText(/type/i), 'raise');
    expect(screen.getByLabelText(/delta amount/i)).toBeInTheDocument();
  });

  it('mirror copies the active tab\'s plan to the other person', async () => {
    resetStores(true);
    const user = userEvent.setup();
    render(<MemoryRouter><IncomePopover open onOpenChange={() => {}} /></MemoryRouter>);
    const slider = screen.getByLabelText(/annual raise rate/i) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '5' } });
    await user.click(screen.getByRole('button', { name: /mirror to partner/i }));
    await user.click(screen.getByRole('tab', { name: /partner/i }));
    expect((screen.getByLabelText(/annual raise rate/i) as HTMLInputElement).value).toBe('5.00');
  });

  it('renders the live trajectory preview at the bottom', () => {
    render(<MemoryRouter><IncomePopover open onOpenChange={() => {}} /></MemoryRouter>);
    expect(screen.getByTestId('income-trajectory-preview')).toBeInTheDocument();
    const preview = screen.getByTestId('income-trajectory-preview');
    expect(within(preview).getAllByRole('listitem').length).toBeGreaterThanOrEqual(5);
  });
});
