import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdvancedSection } from '@/components/settings/AdvancedSection';
import { useHouseholdStore } from '@/stores/household-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useCategoriesStore } from '@/stores/categories-store';
import {
  FilingStatus,
  RefreshCadence,
  FiPillsPosition,
  ProjectionDetailLevel,
  CompoundingFrequency,
} from '@/types/enums';
import type { AppSettings } from '@/types/schema';
import { makeHousehold } from '../../factories';

// Wave-5 Task 1 (Finance NEW-W5-1) — Settings → Advanced input for the
// household-default retirement drawdown gross-up tax rate. Engine + schema
// for `effectiveDrawdownTaxRate` shipped in Sprint 4 with default 0; no UI
// surface meant every Trad-heavy retiree's projection silently under-
// counted tax on Phase-2 withdrawals (~$138.6k over 15y at the modal MFJ
// $80k/yr expenses persona).

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
    defaultProjectionDetailLevel: ProjectionDetailLevel.TAX_BUCKET,
    defaultCashApy: null,
    defaultCompoundingFrequency: CompoundingFrequency.MONTHLY,
    defaultDrawdownTaxRate: null,
    propertyUtilitiesCategoryIds: null,
    vehicleGasCategoryIds: null,
    ...patch,
  };
}


function resetCategoriesStore() {
  useCategoriesStore.setState({
    categories: [],
    isLoading: false,
    error: null,
    load: async () => {},
  } as never);
}

function resetHousehold() {
  useHouseholdStore.setState({
    household: makeHousehold(),
    isLoading: false,
    error: null,
    load: async () => {},
    update: vi.fn().mockResolvedValue(undefined),
    acceptDisclaimer: async () => {},
  } as never);
}

function resetSettingsStore(
  settings: AppSettings | null,
  update: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined),
) {
  useSettingsStore.setState({
    settings,
    isLoading: false,
    error: null,
    load: async () => {},
    update,
  } as never);
  return update;
}

function expandSection() {
  fireEvent.click(screen.getByRole('button', { name: /expand advanced/i }));
}

describe('AdvancedSection — Default drawdown tax rate input', () => {
  beforeEach(() => {
    resetCategoriesStore();
    resetHousehold();
  });

  it('renders a "Default effective tax rate on retirement withdrawals" input in the What-If section', () => {
    resetSettingsStore(makeSettings({ defaultDrawdownTaxRate: null }));
    render(<AdvancedSection />);
    expandSection();
    expect(
      screen.getByLabelText(/default effective tax rate on retirement withdrawals/i),
    ).toBeInTheDocument();
  });

  it('shows the value as whole-percent when defaultDrawdownTaxRate is pre-filled (0.22 → "22")', () => {
    resetSettingsStore(makeSettings({ defaultDrawdownTaxRate: 0.22 }));
    render(<AdvancedSection />);
    expandSection();
    const input = screen.getByLabelText(
      /default effective tax rate on retirement withdrawals/i,
    ) as HTMLInputElement;
    expect(input.value).toBe('22');
  });

  it('renders the placeholder "22" when no household default is set', () => {
    resetSettingsStore(makeSettings({ defaultDrawdownTaxRate: null }));
    render(<AdvancedSection />);
    expandSection();
    const input = screen.getByLabelText(
      /default effective tax rate on retirement withdrawals/i,
    ) as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('22');
  });

  it('round-trips a non-trivial fraction (0.185 → "18.5")', () => {
    resetSettingsStore(makeSettings({ defaultDrawdownTaxRate: 0.185 }));
    render(<AdvancedSection />);
    expandSection();
    const input = screen.getByLabelText(
      /default effective tax rate on retirement withdrawals/i,
    ) as HTMLInputElement;
    expect(input.value).toBe('18.5');
  });

  it('persists the rate as a fraction on save (user enters 22 → store gets 0.22)', async () => {
    const update = resetSettingsStore(makeSettings({ defaultDrawdownTaxRate: null }));
    render(<AdvancedSection />);
    expandSection();
    fireEvent.change(
      screen.getByLabelText(/default effective tax rate on retirement withdrawals/i),
      { target: { value: '22' } },
    );
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ defaultDrawdownTaxRate: expect.closeTo(0.22, 5) }),
    );
  });

  it('persists null when the field is cleared (user blanks → store gets null)', async () => {
    const update = resetSettingsStore(
      makeSettings({ defaultDrawdownTaxRate: 0.22 }),
    );
    render(<AdvancedSection />);
    expandSection();
    fireEvent.change(
      screen.getByLabelText(/default effective tax rate on retirement withdrawals/i),
      { target: { value: '' } },
    );
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ defaultDrawdownTaxRate: null }),
    );
  });

  it('disables Save and shows the range error when rate > 50%', () => {
    resetSettingsStore(makeSettings({ defaultDrawdownTaxRate: null }));
    render(<AdvancedSection />);
    expandSection();
    fireEvent.change(
      screen.getByLabelText(/default effective tax rate on retirement withdrawals/i),
      { target: { value: '60' } },
    );
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/drawdown tax rate must be between/i);
  });

  it('disables Save when rate is negative', () => {
    resetSettingsStore(makeSettings({ defaultDrawdownTaxRate: null }));
    render(<AdvancedSection />);
    expandSection();
    fireEvent.change(
      screen.getByLabelText(/default effective tax rate on retirement withdrawals/i),
      { target: { value: '-5' } },
    );
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
  });

  it('accepts the exact boundaries 0 and 50', async () => {
    const update = resetSettingsStore(makeSettings({ defaultDrawdownTaxRate: null }));
    render(<AdvancedSection />);
    expandSection();
    const input = screen.getByLabelText(
      /default effective tax rate on retirement withdrawals/i,
    );

    fireEvent.change(input, { target: { value: '0' } });
    expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled();

    fireEvent.change(input, { target: { value: '50' } });
    expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ defaultDrawdownTaxRate: expect.closeTo(0.5, 5) }),
    );
  });

  it('surfaces the explanatory copy + 22% reference value in the sub-paragraph', () => {
    resetSettingsStore(makeSettings({ defaultDrawdownTaxRate: null }));
    render(<AdvancedSection />);
    expandSection();
    // The copy below the input names the default + when it applies.
    expect(screen.getByText(/sequential/i)).toBeInTheDocument();
    expect(screen.getByText(/default 22%/i)).toBeInTheDocument();
  });
});
