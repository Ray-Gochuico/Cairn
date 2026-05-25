import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ContributionsPopover from '@/components/whatif/levers/ContributionsPopover';
import { useScenariosStore } from '@/stores/scenarios-store';
import { emptyLeverPayload } from '@/lib/scenarios';
import type { Scenario } from '@/types/scenario';

function resetStore(payloadOverrides: Partial<ReturnType<typeof emptyLeverPayload>> = {}) {
  useScenariosStore.setState({
    scenarios: [{
      id: 1, name: 'Baseline', isBaseline: true, color: '#4f86f7', lineStyle: 'solid',
      visible: true, isActive: true, sortOrder: 0,
      leverPayload: { ...emptyLeverPayload(), ...payloadOverrides },
      createdAt: 't', updatedAt: 't',
    } as Scenario],
    isLoading: false, error: null,
    horizonMonths: 360, dollarMode: 'nominal',
    inflation: 0.025, defaultReturnRate: 0.07,
    projectionCache: new Map(),
    updateLever: vi.fn().mockResolvedValue(undefined) as any,
  });
}

describe('ContributionsPopover', () => {
  beforeEach(() => { resetStore(); });

  it('renders an empty-state message when no segments are configured', () => {
    render(<MemoryRouter><ContributionsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    expect(screen.getByText(/no contribution segments yet/i)).toBeInTheDocument();
  });

  it('clicking + Add segment appends a row with default year and amount inputs', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ContributionsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /add segment/i }));
    expect(screen.getByLabelText(/from year/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/through year/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/monthly amount/i)).toBeInTheDocument();
  });

  it('Apply converts year inputs to month-from-start indices and calls updateLever', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ContributionsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /add segment/i }));
    fireEvent.change(screen.getByLabelText(/from year/i), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/through year/i), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/monthly amount/i), { target: { value: '1500' } });
    fireEvent.change(screen.getByLabelText(/label/i), { target: { value: 'First decade' } });

    await user.click(screen.getByRole('button', { name: /apply/i }));

    const updateLever = (useScenariosStore.getState() as any).updateLever as ReturnType<typeof vi.fn>;
    expect(updateLever).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        contributions: [expect.objectContaining({
          startMonth: 0,           // year 1 → 0-based month
          endMonth: 119,           // year 10 → month 119 (0..119 inclusive = 120 months = 10y)
          monthlyAmount: 1500,
          label: 'First decade',
        })],
      }),
    );
  });

  it('treats a blank Through year as open-ended (endMonth: null)', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ContributionsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /add segment/i }));
    fireEvent.change(screen.getByLabelText(/from year/i), { target: { value: '21' } });
    fireEvent.change(screen.getByLabelText(/through year/i), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/monthly amount/i), { target: { value: '3000' } });

    await user.click(screen.getByRole('button', { name: /apply/i }));

    const updateLever = (useScenariosStore.getState() as any).updateLever as ReturnType<typeof vi.fn>;
    expect(updateLever).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        contributions: [expect.objectContaining({
          startMonth: 240,         // year 21 → month 240
          endMonth: null,
          monthlyAmount: 3000,
        })],
      }),
    );
  });

  it('Remove removes the row from the draft list', async () => {
    resetStore({
      contributions: [{ startMonth: 0, endMonth: 59, monthlyAmount: 1000, label: 'Y1-Y5' }],
    });
    const user = userEvent.setup();
    render(<MemoryRouter><ContributionsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    expect(screen.getByLabelText(/from year/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /remove segment 1/i }));
    expect(screen.queryByLabelText(/from year/i)).not.toBeInTheDocument();
    expect(screen.getByText(/no contribution segments yet/i)).toBeInTheDocument();
  });

  it('round-trips an existing segment: opening shows it as years, applying without edits emits unchanged months', async () => {
    resetStore({
      contributions: [{ startMonth: 12, endMonth: 71, monthlyAmount: 500, label: 'mid' }],
    });
    const user = userEvent.setup();
    render(<MemoryRouter><ContributionsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    const fromYear = screen.getByLabelText(/from year/i) as HTMLInputElement;
    const throughYear = screen.getByLabelText(/through year/i) as HTMLInputElement;
    expect(Number(fromYear.value)).toBe(2);   // month 12 → year 2
    expect(Number(throughYear.value)).toBe(6); // month 71 → year 6 (months 60..71)

    await user.click(screen.getByRole('button', { name: /apply/i }));

    const updateLever = (useScenariosStore.getState() as any).updateLever as ReturnType<typeof vi.fn>;
    expect(updateLever).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        contributions: [expect.objectContaining({
          startMonth: 12,
          endMonth: 71,
          monthlyAmount: 500,
          label: 'mid',
        })],
      }),
    );
  });
});
