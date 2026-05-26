import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AdvancedSection } from '@/components/settings/AdvancedSection';
import { useHouseholdStore } from '@/stores/household-store';
import { useSettingsStore } from '@/stores/settings-store';
import { FilingStatus, RefreshCadence, FiPillsPosition } from '@/types/enums';
import type { Household, AppSettings } from '@/types/schema';

function makeSettings(patch: Partial<AppSettings> = {}): AppSettings {
  return {
    id: 1,
    sidebarLayout: null,
    notificationsEnabled: true,
    notificationDay: 1,
    refreshCadence: RefreshCadence.EVERY_LAUNCH,
    lastRefreshAt: null,
    statementsFolderPath: null,
    defaultInflation: null,
    defaultReturnRate: null,
    defaultFiPillsPosition: FiPillsPosition.ABOVE,
    ...patch,
  };
}

function resetSettingsStore(
  settings: AppSettings | null,
  update: any = vi.fn().mockResolvedValue(undefined),
) {
  useSettingsStore.setState({
    settings,
    isLoading: false,
    error: null,
    load: async () => {},
    update,
  } as any);
  return update;
}

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
    resetSettingsStore(makeSettings());
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

  it('renders the What-If projection default inputs prefilled from settings (as whole percent)', () => {
    resetSettingsStore(makeSettings({ defaultInflation: 0.025, defaultReturnRate: 0.07 }));
    render(<AdvancedSection />);
    fireEvent.click(screen.getByText('Advanced'));
    const inflationInput = screen.getByLabelText(/default inflation rate/i) as HTMLInputElement;
    const returnInput = screen.getByLabelText(/default investment return rate/i) as HTMLInputElement;
    expect(inflationInput.value).toBe('2.5');
    expect(returnInput.value).toBe('7');
  });

  it('persists default inflation + return rate as fractions through useSettingsStore.update', async () => {
    const householdUpdate = vi.fn().mockResolvedValue(undefined);
    const settingsUpdate = vi.fn().mockResolvedValue(undefined);
    resetStore(makeHousehold(), householdUpdate);
    resetSettingsStore(makeSettings(), settingsUpdate);
    render(<AdvancedSection />);
    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.change(screen.getByLabelText(/default inflation rate/i), {
      target: { value: '3' },
    });
    fireEvent.change(screen.getByLabelText(/default investment return rate/i), {
      target: { value: '8' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await Promise.resolve();
    await Promise.resolve();
    expect(settingsUpdate).toHaveBeenCalledWith({
      defaultInflation: 0.03,
      defaultReturnRate: 0.08,
      defaultFiPillsPosition: FiPillsPosition.ABOVE,
    });
  });

  it('writes nulls when What-If default inputs are cleared', async () => {
    const settingsUpdate = vi.fn().mockResolvedValue(undefined);
    resetSettingsStore(
      makeSettings({ defaultInflation: 0.025, defaultReturnRate: 0.07 }),
      settingsUpdate,
    );
    render(<AdvancedSection />);
    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.change(screen.getByLabelText(/default inflation rate/i), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/default investment return rate/i), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await Promise.resolve();
    await Promise.resolve();
    expect(settingsUpdate).toHaveBeenCalledWith({
      defaultInflation: null,
      defaultReturnRate: null,
      defaultFiPillsPosition: FiPillsPosition.ABOVE,
    });
  });

  it('disables Save when What-If default inflation is out of range (e.g. 25%)', () => {
    render(<AdvancedSection />);
    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.change(screen.getByLabelText(/default inflation rate/i), {
      target: { value: '25' },
    });
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
  });

  it('renders the FI / Coast FI pills position select inside the What-If section', () => {
    render(<AdvancedSection />);
    fireEvent.click(screen.getByText('Advanced'));
    const select = screen.getByLabelText(/FI \/ Coast FI pills position/i) as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(select.value).toBe('above');
  });

  it('prefills the FI pills position select from settings when "below"', () => {
    resetSettingsStore(makeSettings({ defaultFiPillsPosition: FiPillsPosition.BELOW }));
    render(<AdvancedSection />);
    fireEvent.click(screen.getByText('Advanced'));
    const select = screen.getByLabelText(/FI \/ Coast FI pills position/i) as HTMLSelectElement;
    expect(select.value).toBe('below');
  });

  it('persists the FI pills position selection through useSettingsStore.update', async () => {
    const settingsUpdate = vi.fn().mockResolvedValue(undefined);
    resetSettingsStore(makeSettings(), settingsUpdate);
    render(<AdvancedSection />);
    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.change(screen.getByLabelText(/FI \/ Coast FI pills position/i), {
      target: { value: 'below' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await Promise.resolve();
    await Promise.resolve();
    expect(settingsUpdate).toHaveBeenCalledWith({
      defaultInflation: null,
      defaultReturnRate: null,
      defaultFiPillsPosition: FiPillsPosition.BELOW,
    });
  });
});

describe('ResetDisclaimersDialog', () => {
  beforeEach(() => {
    resetStore(makeHousehold());
    resetSettingsStore(makeSettings());
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
