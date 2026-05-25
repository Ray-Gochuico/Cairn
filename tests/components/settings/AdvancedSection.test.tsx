import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AdvancedSection } from '@/components/settings/AdvancedSection';
import { useHouseholdStore } from '@/stores/household-store';
import { FilingStatus } from '@/types/enums';
import type { Household } from '@/types/schema';

function makeHousehold(patch: Partial<Household> = {}): Household {
  return {
    id: 1,
    name: null,
    filingStatus: FilingStatus.SINGLE,
    state: 'CA',
    city: null,
    monthlyExpenseBaseline: 5000,
    withdrawalRate: 0.04,
    inflationAssumption: 0.03,
    growthScenarios: [],
    disclaimerAcceptedAt: '2026-05-01',
    disclaimerVersionAccepted: '1.0',
    roadmapDisclaimerAcceptedAt: '2026-05-01',
    roadmapDisclaimerVersionAccepted: '1.0',
    interestThresholdLowPct: null,
    interestThresholdHighPct: null,
    hasWrittenIps: null,
    hasHsaQualifiedHdhp: null,
    makesCharitableGifts: null,
    upcomingLargePurchase: null,
    upcomingPurchaseAmount: null,
    upcomingPurchaseMonths: null,
    ...patch,
  };
}

function resetStore(household: Household | null, update: any = vi.fn().mockResolvedValue(undefined)) {
  useHouseholdStore.setState({
    household,
    isLoading: false,
    error: null,
    load: async () => {},
    update,
    acceptDisclaimer: async () => {},
  } as any);
  return update;
}

describe('AdvancedSection', () => {
  beforeEach(() => {
    resetStore(makeHousehold());
  });

  it('starts collapsed and expands when the header is clicked', () => {
    render(<AdvancedSection />);
    expect(screen.queryByText(/interest-rate thresholds/i)).toBeNull();
    fireEvent.click(screen.getByText('Advanced'));
    expect(screen.getByText(/interest-rate thresholds/i)).toBeInTheDocument();
  });

  it('renders inputs prefilled from the household when expanded', () => {
    resetStore(
      makeHousehold({ interestThresholdLowPct: 4, interestThresholdHighPct: 10 }),
    );
    render(<AdvancedSection />);
    fireEvent.click(screen.getByText('Advanced'));
    const low = screen.getByLabelText(/low cutoff/i) as HTMLInputElement;
    const high = screen.getByLabelText(/high cutoff/i) as HTMLInputElement;
    expect(low.value).toBe('4');
    expect(high.value).toBe('10');
  });

  it('saves numeric values through the household store', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    resetStore(makeHousehold(), update);
    render(<AdvancedSection />);
    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.change(screen.getByLabelText(/low cutoff/i), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText(/high cutoff/i), { target: { value: '9.5' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    // Allow the awaited update to settle.
    await Promise.resolve();
    expect(update).toHaveBeenCalledWith({
      interestThresholdLowPct: 4,
      interestThresholdHighPct: 9.5,
    });
  });

  it('persists blank inputs as null so defaults apply', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    resetStore(makeHousehold(), update);
    render(<AdvancedSection />);
    fireEvent.click(screen.getByText('Advanced'));
    // Inputs start blank; click save directly.
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await Promise.resolve();
    expect(update).toHaveBeenCalledWith({
      interestThresholdLowPct: null,
      interestThresholdHighPct: null,
    });
  });

  it('disables save and shows the order-error when low >= high', () => {
    render(<AdvancedSection />);
    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.change(screen.getByLabelText(/low cutoff/i), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText(/high cutoff/i), { target: { value: '5' } });
    const save = screen.getByRole('button', { name: /^save$/i });
    expect(save).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/must be less than/i);
  });

  it('disables save and shows the range-error when values exceed 0..100', () => {
    render(<AdvancedSection />);
    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.change(screen.getByLabelText(/low cutoff/i), { target: { value: '-1' } });
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/low cutoff/i), { target: { value: '150' } });
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
  });

  it('opens the Reset disclaimers dialog from the section', () => {
    render(<AdvancedSection />);
    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.click(screen.getByRole('button', { name: /reset disclaimers/i }));
    expect(
      screen.getByRole('heading', { name: /reset disclaimer acceptances\?/i }),
    ).toBeInTheDocument();
  });
});

describe('ResetDisclaimersDialog', () => {
  beforeEach(() => {
    resetStore(makeHousehold());
  });

  it('confirms and clears all four cache columns', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    resetStore(makeHousehold(), update);
    render(<AdvancedSection />);
    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.click(screen.getByRole('button', { name: /reset disclaimers/i }));
    fireEvent.click(screen.getByRole('button', { name: /^reset$/i }));
    await Promise.resolve();
    expect(update).toHaveBeenCalledWith({
      disclaimerAcceptedAt: null,
      disclaimerVersionAccepted: null,
      roadmapDisclaimerAcceptedAt: null,
      roadmapDisclaimerVersionAccepted: null,
    });
  });

  it('cancels without writing', () => {
    const update = vi.fn().mockResolvedValue(undefined);
    resetStore(makeHousehold(), update);
    render(<AdvancedSection />);
    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.click(screen.getByRole('button', { name: /reset disclaimers/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(update).not.toHaveBeenCalled();
  });
});
