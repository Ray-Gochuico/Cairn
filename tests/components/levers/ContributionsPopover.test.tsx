import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ContributionsPopover from '@/components/whatif/levers/ContributionsPopover';
import { useScenariosStore } from '@/stores/scenarios-store';
import { useAccountsStore } from '@/stores/accounts-store';
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
    updateLever: vi.fn().mockResolvedValue(undefined) as any,
  });
}

describe('ContributionsPopover', () => {
  beforeEach(() => { resetStore(); });

  it('renders an empty-state message when no segments are configured', () => {
    render(<MemoryRouter><ContributionsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    expect(screen.getByText(/no contribution segments yet/i)).toBeInTheDocument();
  });

  it('shows the auto-invest notice when no segments are configured', () => {
    render(<MemoryRouter><ContributionsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    expect(screen.getByTestId('contributions-auto-invest-notice')).toBeInTheDocument();
    expect(screen.getByTestId('contributions-auto-invest-notice')).toHaveTextContent(
      /monthly surplus.*auto-invests/i,
    );
  });

  it('hides the auto-invest notice once at least one segment is added', async () => {
    resetStore({
      contributions: [{ startMonth: 0, endMonth: 59, monthlyAmount: 1000, label: 'Y1-Y5' }],
    });
    render(<MemoryRouter><ContributionsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    expect(screen.queryByTestId('contributions-auto-invest-notice')).not.toBeInTheDocument();
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

describe('ContributionsPopover — allocation UI', () => {
  beforeEach(() => {
    resetStore();
    // Seed the accounts store with two investment accounts and one cash
    // account; cash accounts must be filtered out of the allocation list.
    useAccountsStore.setState({
      accounts: [
        { id: 1, householdId: 1, name: '401(k)', type: 'ACCOUNT_401K', excludedFromNetWorth: false } as any,
        { id: 2, householdId: 1, name: 'Brokerage', type: 'ACCOUNT_BROKERAGE', excludedFromNetWorth: false } as any,
        { id: 3, householdId: 1, name: 'Checking', type: 'ACCOUNT_CASH', excludedFromNetWorth: false } as any,
      ],
      isLoading: false,
      error: null,
    });
  });

  it('renders an allocation expander button for each segment', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ContributionsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /add segment/i }));
    expect(screen.getByRole('button', { name: /advanced.*allocation for segment 1/i })).toBeInTheDocument();
  });

  it('allocation panel is hidden by default', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ContributionsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /add segment/i }));
    expect(screen.queryByText(/historical mix/i)).not.toBeInTheDocument();
  });

  it('expander reveals historical mix and override checkbox', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ContributionsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /add segment/i }));
    await user.click(screen.getByRole('button', { name: /advanced.*allocation for segment 1/i }));
    expect(screen.getByText(/historical mix/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /override allocation/i })).toBeInTheDocument();
  });

  it('override checkbox reveals per-account percent inputs excluding cash accounts', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ContributionsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /add segment/i }));
    await user.click(screen.getByRole('button', { name: /advanced.*allocation for segment 1/i }));
    await user.click(screen.getByRole('checkbox', { name: /override allocation/i }));
    expect(screen.getByLabelText(/401\(k\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/brokerage/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/checking/i)).not.toBeInTheDocument();
  });

  it('shows a validation error when percent inputs do not sum to 100', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ContributionsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /add segment/i }));
    await user.click(screen.getByRole('button', { name: /advanced.*allocation for segment 1/i }));
    await user.click(screen.getByRole('checkbox', { name: /override allocation/i }));
    // Default even split for two investment accounts: 50/50 = 100 → valid initially.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // Break the sum by changing the 401(k) input.
    fireEvent.change(screen.getByLabelText(/401\(k\)/i), { target: { value: '70' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/must sum to 100/i);
  });

  it('Apply is disabled when allocation override is on but sum is not 100', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ContributionsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /add segment/i }));
    await user.click(screen.getByRole('button', { name: /advanced.*allocation for segment 1/i }));
    await user.click(screen.getByRole('checkbox', { name: /override allocation/i }));
    fireEvent.change(screen.getByLabelText(/401\(k\)/i), { target: { value: '70' } });
    expect(screen.getByRole('button', { name: /^apply$/i })).toBeDisabled();
  });

  it('Apply with override on + valid sum persists the allocation map', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ContributionsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /add segment/i }));
    await user.click(screen.getByRole('button', { name: /advanced.*allocation for segment 1/i }));
    await user.click(screen.getByRole('checkbox', { name: /override allocation/i }));
    // Set 80/20 split.
    fireEvent.change(screen.getByLabelText(/401\(k\)/i), { target: { value: '80' } });
    fireEvent.change(screen.getByLabelText(/brokerage/i), { target: { value: '20' } });
    await user.click(screen.getByRole('button', { name: /^apply$/i }));

    const updateLever = (useScenariosStore.getState() as any).updateLever as ReturnType<typeof vi.fn>;
    expect(updateLever).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        contributions: [expect.objectContaining({
          allocation: { '1': 0.8, '2': 0.2 },
        })],
      }),
    );
  });

  it('Apply with override off persists allocation: null (engine falls back to even split)', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ContributionsPopover open onOpenChange={() => {}} /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /add segment/i }));
    // Override stays off by default.
    await user.click(screen.getByRole('button', { name: /^apply$/i }));

    const updateLever = (useScenariosStore.getState() as any).updateLever as ReturnType<typeof vi.fn>;
    expect(updateLever).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        contributions: [expect.objectContaining({ allocation: null })],
      }),
    );
  });
});
