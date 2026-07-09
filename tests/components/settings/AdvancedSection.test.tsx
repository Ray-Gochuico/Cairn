import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AdvancedSection } from '@/components/settings/AdvancedSection';
import { useHouseholdStore } from '@/stores/household-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useCategoriesStore } from '@/stores/categories-store';
import { useAcceptancesStore } from '@/stores/disclosure-acceptances-store';
import { DisclosureAcceptancesRepo } from '@/domain/disclosure-acceptances';
import { setDatabase } from '@/db/db';
import {
  FilingStatus,
  RefreshCadence,
  FiPillsPosition,
  ProjectionDetailLevel,
  CompoundingFrequency,
  CategoryType,
} from '@/types/enums';
import type { Household, AppSettings, Category } from '@/types/schema';
import { makeHousehold } from '../../factories';

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

const baseCat = (overrides: Partial<Category>): Category => ({
  id: 0,
  name: '',
  parentCategoryId: null,
  color: null,
  icon: null,
  type: CategoryType.NEED,
  isCapital: false,
  systemManaged: false,
  monthlyBudget: null,
  ...overrides,
});

const SEED_CATEGORIES: Category[] = [
  baseCat({ id: 1, name: 'Home' }),
  baseCat({ id: 10, name: 'Utilities', parentCategoryId: 1 }),
  baseCat({ id: 11, name: 'Internet', parentCategoryId: 1 }),
  baseCat({ id: 2, name: 'Vehicles' }),
  baseCat({ id: 17, name: 'Gas/Fuel', parentCategoryId: 2 }),
  baseCat({ id: 18, name: 'Auto Insurance', parentCategoryId: 2 }),
];

function resetCategoriesStore(categories: Category[] = SEED_CATEGORIES) {
  useCategoriesStore.setState({
    categories,
    isLoading: false,
    error: null,
    load: async () => {},
  } as never);
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
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
    expect(screen.queryByText(/interest-rate thresholds/i)).toBeNull();
    fireEvent.click(screen.getByText('Advanced'));
    expect(screen.getByText(/interest-rate thresholds/i)).toBeInTheDocument();
  });

  it('renders inputs prefilled from the household when expanded', () => {
    resetStore(
      makeHousehold({ interestThresholdLowPct: 4, interestThresholdHighPct: 10 }),
    );
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
    fireEvent.click(screen.getByText('Advanced'));
    const low = screen.getByLabelText(/low cutoff/i) as HTMLInputElement;
    const high = screen.getByLabelText(/high cutoff/i) as HTMLInputElement;
    expect(low.value).toBe('4');
    expect(high.value).toBe('10');
  });

  it('a failed Advanced save shows a role=alert and clears the Saved badge (W10 T5)', async () => {
    const user = userEvent.setup();
    resetStore(makeHousehold(), vi.fn().mockRejectedValue(new Error('DB locked')));
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
    fireEvent.click(screen.getByText('Advanced'));
    await user.click(screen.getByRole('button', { name: /^save/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t save.*DB locked/i);
    expect(screen.queryByText(/^saved$/i)).not.toBeInTheDocument();
  });

  it('saves numeric values through the household store', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    resetStore(makeHousehold(), update);
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
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
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
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
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.change(screen.getByLabelText(/low cutoff/i), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText(/high cutoff/i), { target: { value: '5' } });
    const save = screen.getByRole('button', { name: /^save$/i });
    expect(save).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/must be less than/i);
  });

  it('disables save and shows the range-error when values exceed 0..100', () => {
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.change(screen.getByLabelText(/low cutoff/i), { target: { value: '-1' } });
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/low cutoff/i), { target: { value: '150' } });
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
  });

  it('opens the Reset disclaimers dialog from the section', () => {
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.click(screen.getByRole('button', { name: /reset disclaimers/i }));
    expect(
      screen.getByRole('heading', { name: /reset disclaimer acceptances\?/i }),
    ).toBeInTheDocument();
  });

  it('renders the What-If projection default inputs prefilled from settings (as whole percent)', () => {
    resetSettingsStore(makeSettings({ defaultInflation: 0.025, defaultReturnRate: 0.07 }));
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
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
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
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
      defaultProjectionDetailLevel: ProjectionDetailLevel.TAX_BUCKET,
      defaultCashApy: null,
      defaultCompoundingFrequency: CompoundingFrequency.MONTHLY,
      defaultDrawdownTaxRate: null,
    });
  });

  it('writes nulls when What-If default inputs are cleared', async () => {
    const settingsUpdate = vi.fn().mockResolvedValue(undefined);
    resetSettingsStore(
      makeSettings({ defaultInflation: 0.025, defaultReturnRate: 0.07 }),
      settingsUpdate,
    );
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
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
      defaultProjectionDetailLevel: ProjectionDetailLevel.TAX_BUCKET,
      defaultCashApy: null,
      defaultCompoundingFrequency: CompoundingFrequency.MONTHLY,
      defaultDrawdownTaxRate: null,
    });
  });

  it('disables Save when What-If default inflation is out of range (e.g. 25%)', () => {
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.change(screen.getByLabelText(/default inflation rate/i), {
      target: { value: '25' },
    });
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
  });

  it('renders the FI / Coast FI pills position select inside the What-If section', () => {
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
    fireEvent.click(screen.getByText('Advanced'));
    const select = screen.getByLabelText(/FI \/ Coast FI pills position/i) as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(select.value).toBe('above');
  });

  it('prefills the FI pills position select from settings when "below"', () => {
    resetSettingsStore(makeSettings({ defaultFiPillsPosition: FiPillsPosition.BELOW }));
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
    fireEvent.click(screen.getByText('Advanced'));
    const select = screen.getByLabelText(/FI \/ Coast FI pills position/i) as HTMLSelectElement;
    expect(select.value).toBe('below');
  });

  it('persists the FI pills position selection through useSettingsStore.update', async () => {
    const settingsUpdate = vi.fn().mockResolvedValue(undefined);
    resetSettingsStore(makeSettings(), settingsUpdate);
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
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
      defaultProjectionDetailLevel: ProjectionDetailLevel.TAX_BUCKET,
      defaultCashApy: null,
      defaultCompoundingFrequency: CompoundingFrequency.MONTHLY,
      defaultDrawdownTaxRate: null,
    });
  });
});

describe('ResetDisclaimersDialog (table-driven — clears disclosure_acceptances, MF-1/T5)', () => {
  beforeEach(() => {
    resetStore(makeHousehold());
    resetSettingsStore(makeSettings());
    // The dialog constructs a DisclosureAcceptancesRepo via getDatabase();
    // a no-op stub keeps getDatabase() from throwing (the repo call itself is
    // spied below).
    setDatabase({
      execute: vi.fn().mockResolvedValue({ rowsAffected: 0 }),
      select: vi.fn().mockResolvedValue([]),
      close: vi.fn().mockResolvedValue(undefined),
    });
    // The dialog refreshes the acceptances projection after clearing; stub it.
    useAcceptancesStore.setState({
      acceptedVersions: {},
      status: 'ready',
      isLoading: false,
      error: null,
      load: vi.fn().mockResolvedValue(undefined),
    } as any);
  });

  it('confirms and clears this household\'s acceptances, then refreshes the gate cache', async () => {
    const clearSpy = vi
      .spyOn(DisclosureAcceptancesRepo.prototype, 'clearForHousehold')
      .mockResolvedValue(undefined);
    const loadAcceptances = vi.fn().mockResolvedValue(undefined);
    resetStore(makeHousehold({ id: 1 }));
    useAcceptancesStore.setState({
      acceptedVersions: {},
      status: 'ready',
      isLoading: false,
      error: null,
      load: loadAcceptances,
    } as any);
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.click(screen.getByRole('button', { name: /reset disclaimers/i }));
    fireEvent.click(screen.getByRole('button', { name: /^reset$/i }));
    await Promise.resolve();
    await Promise.resolve();
    // Clears the audit rows for this household (the single source of truth).
    expect(clearSpy).toHaveBeenCalledWith(1);
    // Refreshes the in-memory projection so every gate re-prompts.
    expect(loadAcceptances).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it('cancels without clearing', () => {
    const clearSpy = vi
      .spyOn(DisclosureAcceptancesRepo.prototype, 'clearForHousehold')
      .mockResolvedValue(undefined);
    resetStore(makeHousehold());
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
    fireEvent.click(screen.getByText('Advanced'));
    fireEvent.click(screen.getByRole('button', { name: /reset disclaimers/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(clearSpy).not.toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});

describe('AdvancedSection — Projection detail level select', () => {
  it('renders a "Projection detail level" select inside the What-If projection defaults section', () => {
    resetStore(makeHousehold());
    resetSettingsStore(makeSettings());
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /expand advanced/i }));
    expect(screen.getByLabelText(/projection detail level/i)).toBeInTheDocument();
  });

  it('has three options: single, tax_bucket, per_account', () => {
    resetStore(makeHousehold());
    resetSettingsStore(makeSettings());
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /expand advanced/i }));
    const select = screen.getByLabelText(/projection detail level/i) as HTMLSelectElement;
    const opts = Array.from(select.options).map((o) => o.value);
    expect(opts).toContain('single');
    expect(opts).toContain('tax_bucket');
    expect(opts).toContain('per_account');
  });

  it('reflects the seeded default (tax_bucket) on first render', () => {
    resetStore(makeHousehold());
    resetSettingsStore(makeSettings());
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /expand advanced/i }));
    const select = screen.getByLabelText(/projection detail level/i) as HTMLSelectElement;
    expect(select.value).toBe('tax_bucket');
  });

  it('persists a change through updateSettings on Save', async () => {
    const updateSettings = vi.fn().mockResolvedValue(undefined);
    resetStore(makeHousehold());
    resetSettingsStore(makeSettings(), updateSettings);
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /expand advanced/i }));
    const select = screen.getByLabelText(/projection detail level/i) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'per_account' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    // Wait a tick for the async save handler to invoke updateSettings.
    await Promise.resolve();
    await Promise.resolve();
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ defaultProjectionDetailLevel: 'per_account' }),
    );
  });
});

describe('AdvancedSection — Property & Vehicle stat categories', () => {
  beforeEach(() => {
    resetStore(makeHousehold());
    resetCategoriesStore();
  });

  it('renders the "Property & Vehicle stat categories" heading with two pickers', () => {
    resetSettingsStore(makeSettings());
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /expand advanced/i }));
    expect(screen.getByText(/property & vehicle stat categories/i)).toBeInTheDocument();
    // Two picker buttons (one per bucket).
    expect(
      screen.getByRole('button', { name: /utilities categories \(/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /gas categories \(/i })).toBeInTheDocument();
  });

  it('saves a property-utilities selection to the settings store', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    resetSettingsStore(makeSettings(), update);
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /expand advanced/i }));
    await userEvent.click(
      screen.getByRole('button', { name: /utilities categories \(/i }),
    );
    await userEvent.click(screen.getByLabelText(/^Utilities$/));
    expect(update).toHaveBeenCalledWith({ propertyUtilitiesCategoryIds: [10] });
  });

  it('saves a vehicle-gas selection to the settings store', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    resetSettingsStore(makeSettings(), update);
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /expand advanced/i }));
    await userEvent.click(screen.getByRole('button', { name: /gas categories \(/i }));
    await userEvent.click(screen.getByLabelText(/^Gas\/Fuel$/));
    expect(update).toHaveBeenCalledWith({ vehicleGasCategoryIds: [17] });
  });

  it('persists null when the user clears the last selection', async () => {
    // Make the mock actually mutate the store between clicks so the
    // picker's `selected` prop reflects the in-flight state.
    const update = vi.fn(async (patch: Partial<AppSettings>) => {
      useSettingsStore.setState(
        (prev: any) => ({
          ...prev,
          settings: { ...prev.settings, ...patch },
        }) as never,
      );
    });
    resetSettingsStore(
      makeSettings({ propertyUtilitiesCategoryIds: [10] }),
      update,
    );
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /expand advanced/i }));
    await userEvent.click(
      screen.getByRole('button', { name: /utilities categories \(/i }),
    );
    // Uncheck the only selected leaf → onChange fires with [], the block
    // maps [] → null to preserve the seeded-defaults fallback semantics.
    await userEvent.click(screen.getByLabelText(/^Utilities$/));
    expect(update).toHaveBeenLastCalledWith({ propertyUtilitiesCategoryIds: null });
  });
});

describe('AdvancedSection — Default cash APY input', () => {
  beforeEach(() => {
    resetStore(makeHousehold());
  });

  it('renders a "Default cash APY" input in the What-If section', () => {
    resetSettingsStore(makeSettings({ defaultCashApy: null }));
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
    const header = screen.getByRole('button', { name: /expand advanced/i });
    fireEvent.click(header);
    expect(screen.getByLabelText(/default cash apy/i)).toBeInTheDocument();
  });

  it('shows defaultCashApy as a percentage value when pre-filled (0.045 → "4.5")', () => {
    resetSettingsStore(makeSettings({ defaultCashApy: 0.045 }));
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /expand advanced/i }));
    const input = screen.getByLabelText(/default cash apy/i) as HTMLInputElement;
    expect(input.value).toBe('4.5');
  });

  it('calls updateSettings with defaultCashApy as fraction on save', async () => {
    const update = resetSettingsStore(makeSettings({ defaultCashApy: null }));
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /expand advanced/i }));
    fireEvent.change(screen.getByLabelText(/default cash apy/i), { target: { value: '3.5' } });
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ defaultCashApy: expect.closeTo(0.035, 5) }),
    );
  });

  it('persists null when the Default cash APY field is cleared', async () => {
    const update = resetSettingsStore(makeSettings({ defaultCashApy: 0.04 }));
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /expand advanced/i }));
    fireEvent.change(screen.getByLabelText(/default cash apy/i), { target: { value: '' } });
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ defaultCashApy: null }),
    );
  });
});

describe('AdvancedSection — Bulk data import link', () => {
  beforeEach(() => {
    resetStore(makeHousehold());
    resetSettingsStore(makeSettings());
  });

  it('renders a "Bulk data import" section with a link to /setup?section=4', () => {
    render(
      <MemoryRouter>
        <AdvancedSection />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: /expand advanced/i }));
    expect(screen.getByText(/Bulk data import/i)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /open import wizard/i });
    expect(link).toHaveAttribute('href', '/setup?section=4');
  });
});

describe('AdvancedSection — Auto-invest salary surplus toggle removed (2026-05-26 revamp)', () => {
  // The legacy household-level toggle was replaced by the per-scenario gap
  // allocation lever (Income popover). The migration 0029 column stays in
  // SQLite as a zombie but no UI references it anymore.
  beforeEach(() => {
    resetCategoriesStore();
    resetStore(makeHousehold());
    resetSettingsStore(makeSettings());
  });

  it('does NOT render the legacy "Auto-invest salary surplus" toggle', () => {
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
    fireEvent.click(screen.getByText('Advanced'));
    expect(screen.queryByLabelText(/auto-invest salary surplus/i)).toBeNull();
  });
});
