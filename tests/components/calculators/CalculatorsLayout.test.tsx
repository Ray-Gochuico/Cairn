import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CalculatorsLayout from '@/pages/calculators/CalculatorsLayout';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useLoansStore } from '@/stores/loans-store';
import { useEquityGrantsStore } from '@/stores/equity-grants-store';
import { useSettingsStore } from '@/stores/settings-store';
import type { AppSettings } from '@/types/schema';

vi.mock('@/db/db', () => ({
  getDatabase: () => ({ select: async () => [], execute: async () => ({ rowsAffected: 0 }) }),
}));

// Minimal resolved settings so the render-gate opens. calculatorCardLayout
// null = all cards visible.
function primeSettings(overrides: Partial<AppSettings> = {}) {
  useSettingsStore.setState({
    settings: {
      id: 1,
      sidebarLayout: null,
      investmentsCardLayout: null,
      calculatorCardLayout: null,
      notificationsEnabled: true,
      notificationDay: 1,
      refreshCadence: 'DAILY',
      lastRefreshAt: null,
      statementsFolderPath: null,
      defaultInflation: null,
      defaultReturnRate: null,
      defaultFiPillsPosition: 'above',
      defaultProjectionDetailLevel: 'tax_bucket',
      defaultCashApy: null,
      defaultCompoundingFrequency: 'MONTHLY',
      defaultDrawdownTaxRate: null,
      propertyUtilitiesCategoryIds: null,
      vehicleGasCategoryIds: null,
      assetClassTargetAllocations: null,
      lastSeenMonth: null,
      ...overrides,
    } as AppSettings,
    isLoading: false,
    error: null,
  });
}

describe('CalculatorsLayout', () => {
  beforeEach(() => {
    usePersonsStore.setState({ persons: [], isLoading: false, error: null });
    useDependentsStore.setState({ dependents: [], isLoading: false, error: null });
    useSettingsStore.setState({ settings: null, isLoading: false, error: null });
    localStorage.clear();
  });

  // Render-gate: with settings === null the FIRST synchronous render shows the
  // skeleton, not the cards. Asserted before any await so a flash fails (a
  // count-after-await would false-pass).
  it('shows the skeleton (not the 12 cards) on the first synchronous render when settings is null', () => {
    // settings left null by beforeEach.
    render(
      <MemoryRouter>
        <CalculatorsLayout />
      </MemoryRouter>,
    );
    // Skeleton present, cards absent — synchronously, no await.
    expect(screen.getByTestId('calculators-skeleton')).toBeInTheDocument();
    expect(screen.queryByText(/Contribution allocator/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^Calculators$/i })).not.toBeInTheDocument();
  });

  // The mount effect must call settings load (cold deep-link safety).
  it('calls useSettingsStore.load on mount', () => {
    const settingsLoad = vi
      .spyOn(useSettingsStore.getState(), 'load')
      .mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <CalculatorsLayout />
      </MemoryRouter>,
    );
    expect(settingsLoad).toHaveBeenCalled();
    settingsLoad.mockRestore();
  });

  it('hydrates persons + dependents on mount', () => {
    const personsLoad = vi.spyOn(usePersonsStore.getState(), 'load').mockResolvedValue(undefined);
    const dependentsLoad = vi
      .spyOn(useDependentsStore.getState(), 'load')
      .mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <CalculatorsLayout />
      </MemoryRouter>,
    );
    expect(personsLoad).toHaveBeenCalled();
    expect(dependentsLoad).toHaveBeenCalled();
    personsLoad.mockRestore();
    dependentsLoad.mockRestore();
  });

  it('hydrates snapshots, contributions, loans, and equity-grants on mount', () => {
    const snapshotsLoad = vi
      .spyOn(useSnapshotsStore.getState(), 'load')
      .mockResolvedValue(undefined);
    const contributionsLoad = vi
      .spyOn(useContributionsStore.getState(), 'load')
      .mockResolvedValue(undefined);
    const loansLoad = vi.spyOn(useLoansStore.getState(), 'load').mockResolvedValue(undefined);
    const equityGrantsLoad = vi
      .spyOn(useEquityGrantsStore.getState(), 'load')
      .mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <CalculatorsLayout />
      </MemoryRouter>,
    );
    expect(snapshotsLoad).toHaveBeenCalledOnce();
    expect(contributionsLoad).toHaveBeenCalledOnce();
    expect(loansLoad).toHaveBeenCalledOnce();
    expect(equityGrantsLoad).toHaveBeenCalledOnce();
    snapshotsLoad.mockRestore();
    contributionsLoad.mockRestore();
    loansLoad.mockRestore();
    equityGrantsLoad.mockRestore();
  });

  it('renders the contribution allocator card once settings is primed', async () => {
    primeSettings();
    render(
      <MemoryRouter>
        <CalculatorsLayout />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Contribution allocator/i)).toBeInTheDocument();
  });

  it('hides a card whose id is marked hidden in settings.calculatorCardLayout (no localStorage read)', async () => {
    primeSettings({ calculatorCardLayout: [{ id: 'contribution-allocator', hidden: true }] });
    render(
      <MemoryRouter>
        <CalculatorsLayout />
      </MemoryRouter>,
    );
    // Another card proves the grid rendered…
    expect(await screen.findByText(/Compound Interest/i)).toBeInTheDocument();
    // …but the hidden one is absent.
    expect(screen.queryByText(/Contribution allocator/i)).not.toBeInTheDocument();
  });
});
