import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
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
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
    expandSection();
    expect(
      screen.getByLabelText(/default effective tax rate on retirement withdrawals/i),
    ).toBeInTheDocument();
  });

  it('shows the value as whole-percent when defaultDrawdownTaxRate is pre-filled (0.22 → "22")', () => {
    resetSettingsStore(makeSettings({ defaultDrawdownTaxRate: 0.22 }));
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
    expandSection();
    const input = screen.getByLabelText(
      /default effective tax rate on retirement withdrawals/i,
    ) as HTMLInputElement;
    expect(input.value).toBe('22');
  });

  it('renders blank (no misleading placeholder) when no household default is set', () => {
    // Round-3 E5: blank persists null → NO gross-up; a "22" placeholder
    // implied a default that never applied.
    resetSettingsStore(makeSettings({ defaultDrawdownTaxRate: null }));
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
    expandSection();
    const input = screen.getByLabelText(
      /default effective tax rate on retirement withdrawals/i,
    ) as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('');
  });

  it('round-trips a non-trivial fraction (0.185 → "18.5")', () => {
    resetSettingsStore(makeSettings({ defaultDrawdownTaxRate: 0.185 }));
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
    expandSection();
    const input = screen.getByLabelText(
      /default effective tax rate on retirement withdrawals/i,
    ) as HTMLInputElement;
    expect(input.value).toBe('18.5');
  });

  it('persists the rate as a fraction on save (user enters 22 → store gets 0.22)', async () => {
    const update = resetSettingsStore(makeSettings({ defaultDrawdownTaxRate: null }));
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
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
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
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
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
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
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
    expandSection();
    fireEvent.change(
      screen.getByLabelText(/default effective tax rate on retirement withdrawals/i),
      { target: { value: '-5' } },
    );
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
  });

  it('accepts the exact boundaries 0 and 50', async () => {
    const update = resetSettingsStore(makeSettings({ defaultDrawdownTaxRate: null }));
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
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
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
    expandSection();
    // The copy below the input names the reference value, when it applies,
    // and what BLANK does (round-3 E5).
    expect(screen.getByText(/sequential/i)).toBeInTheDocument();
    expect(screen.getByText(/22% covers federal/i)).toBeInTheDocument();
    expect(screen.getByText(/blank = no tax gross-up/i)).toBeInTheDocument();
  });
});

describe('AdvancedSection — round-3 E5 (honest blank + threshold guardrails)', () => {
  beforeEach(() => {
    resetCategoriesStore();
    resetHousehold();
  });

  it('the drawdown input no longer implies a default it does not apply', () => {
    resetSettingsStore(makeSettings({ defaultDrawdownTaxRate: null }));
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
    expandSection();
    const input = screen.getByLabelText(
      /default effective tax rate on retirement withdrawals/i,
    ) as HTMLInputElement;
    // Blank persists null → the engine applies NO gross-up; a "22"
    // placeholder read as an applied default. The copy states the truth.
    expect(input.placeholder).toBe('');
    expect(screen.getByText(/blank = no tax gross-up/i)).toBeInTheDocument();
  });

  it('threshold inputs carry min/max/placeholder guardrails', () => {
    resetSettingsStore(makeSettings());
    render(<MemoryRouter><AdvancedSection /></MemoryRouter>);
    expandSection();
    const low = screen.getByLabelText(/low cutoff/i);
    const high = screen.getByLabelText(/high cutoff/i);
    expect(low).toHaveAttribute('min', '0');
    expect(low).toHaveAttribute('max', '100');
    expect(low).toHaveAttribute('placeholder', '5');
    expect(high).toHaveAttribute('min', '0');
    expect(high).toHaveAttribute('max', '100');
    expect(high).toHaveAttribute('placeholder', '8');
  });
});
