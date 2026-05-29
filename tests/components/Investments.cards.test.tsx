import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { applyCardLayout, type InvestmentsCardEntry } from '@/lib/investments-card-layout';
import { useAccountsStore } from '@/stores/accounts-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useTickersStore } from '@/stores/tickers-store';
import { useFundHoldingsStore } from '@/stores/fund-holdings-store';
import { useFundSectorsStore } from '@/stores/fund-sectors-store';
import { useSettingsStore } from '@/stores/settings-store';
import {
  AccountType,
  CompoundingFrequency,
  FiPillsPosition,
  FilingStatus,
  RefreshCadence,
  SnapshotSource,
} from '@/types/enums';
import type { AppSettings, CardLayoutEntry, GrowthScenario } from '@/types/schema';
import Investments from '@/pages/Investments';

describe('investments card registry contract', () => {
  it('keeps compact cards groupable: donuts are contiguous in the default order', () => {
    const reg: InvestmentsCardEntry[] = [
      { id: 'growth', label: 'g', size: 'wide', applicable: true, render: () => null },
      { id: 'allocation', label: 'a', size: 'compact', applicable: true, render: () => null },
      { id: 'per-company', label: 'p', size: 'compact', applicable: true, render: () => null },
      { id: 'sector', label: 's', size: 'compact', applicable: true, render: () => null },
    ];
    const out = applyCardLayout(reg, null).map((c) => c.size);
    expect(out).toEqual(['wide', 'compact', 'compact', 'compact']);
  });
});

// -----------------------------------------------------------------------------
// Integration tests for Customize edit mode.
//
// We mirror the harness in Investments.test.tsx (sibling file): no real
// SQLite — the page reads from Zustand stores, so we prime those stores
// directly and stub getDatabase() for the per-ticker asset_class lookup. The
// settings-store's update() normally writes through SettingsRepo+SQLite, so
// we replace it with a stand-in that just patches the store's settings field
// (the page only cares that the next render sees the updated layout).
// -----------------------------------------------------------------------------

vi.mock('@/db/db', () => ({
  getDatabase: () => ({
    select: async () => [],
  }),
}));

const fourScenarios: GrowthScenario[] = [
  { label: 'Conservative', rate: 0.05 },
  { label: 'Moderate', rate: 0.06 },
  { label: 'Optimistic', rate: 0.07 },
  { label: 'Bull', rate: 0.08 },
];

const baseSettings: AppSettings = {
  id: 1,
  sidebarLayout: null,
  investmentsCardLayout: null,
  notificationsEnabled: false,
  notificationDay: 1,
  refreshCadence: RefreshCadence.MANUAL,
  lastRefreshAt: null,
  statementsFolderPath: null,
  defaultInflation: null,
  defaultReturnRate: null,
  defaultFiPillsPosition: FiPillsPosition.ABOVE,
  defaultProjectionDetailLevel: 'tax_bucket',
  defaultCashApy: null,
  defaultCompoundingFrequency: CompoundingFrequency.MONTHLY,
  defaultDrawdownTaxRate: null,
  propertyUtilitiesCategoryIds: null,
  vehicleGasCategoryIds: null,
};

function primeBaseStores(initialLayout: CardLayoutEntry[] | null = null) {
  useAccountsStore.setState({
    accounts: [
      {
        id: 1,
        householdId: 1,
        ownerPersonId: null,
        beneficiaryDependentId: null,
        name: 'Brokerage',
        institution: null,
        type: AccountType.ACCOUNT_BROKERAGE,
        cryptoWalletAddress: null,
        autoFetchEnabled: false,
        excludedFromNetWorth: false,
        stateOfPlan: null,
        accentColor: null,
      },
    ],
    isLoading: false,
    error: null,
    load: async () => {},
  });
  useHoldingsStore.setState({
    holdings: [],
    isLoading: false,
    error: null,
    load: async () => {},
  });
  useSnapshotsStore.setState({
    snapshots: [
      {
        id: 1,
        accountId: 1,
        snapshotDate: '2026-04-01',
        totalValue: 50_000,
        source: SnapshotSource.MANUAL,
      },
    ],
    isLoading: false,
    error: null,
    load: async () => {},
  });
  useContributionsStore.setState({
    contributions: [],
    isLoading: false,
    error: null,
    load: async () => {},
  });
  useDependentsStore.setState({
    dependents: [],
    isLoading: false,
    error: null,
    load: async () => {},
  });
  useHouseholdStore.setState({
    household: {
      filingStatus: FilingStatus.SINGLE,
      state: 'CA',
      city: null,
      monthlyExpenseBaseline: 5000,
      withdrawalRate: 0.04,
      inflationAssumption: 0.03,
      growthScenarios: fourScenarios,
    },
    isLoading: false,
    error: null,
    load: async () => {},
  });
  usePersonsStore.setState({
    persons: [],
    isLoading: false,
    error: null,
    load: async () => {},
  });
  useTickersStore.setState({ tickers: [], isLoading: false, error: null, load: async () => {} });
  useFundHoldingsStore.setState({ fundHoldings: [], isLoading: false, error: null, load: async () => {} });
  useFundSectorsStore.setState({ fundSectors: [], isLoading: false, error: null, load: async () => {} });

  // settings-store.update() normally writes through SettingsRepo (SQLite). In
  // this test harness the DB is mocked to read-only, so we substitute an
  // in-memory update that patches the settings field directly — same observable
  // behaviour from the page's perspective (it re-renders when `settings`
  // changes).
  useSettingsStore.setState({
    settings: { ...baseSettings, investmentsCardLayout: initialLayout },
    isLoading: false,
    error: null,
    load: async () => {},
    update: async (patch) => {
      const current = useSettingsStore.getState().settings ?? baseSettings;
      useSettingsStore.setState({ settings: { ...current, ...patch } });
    },
  });
}

describe('Investments cards edit mode', () => {
  beforeEach(() => {
    primeBaseStores();
  });

  it('renders default cards when no layout is stored', async () => {
    render(
      <MemoryRouter>
        <Investments />
      </MemoryRouter>,
    );
    // "Investments growth" is the GrowthCard's title — its presence proves the
    // registry's default render flowed end-to-end (no empty-state shortcut).
    expect(await screen.findByText(/Investments growth/i)).toBeInTheDocument();
  });

  it('opens edit mode when "Customize" is clicked, shows controls', async () => {
    render(
      <MemoryRouter>
        <Investments />
      </MemoryRouter>,
    );
    await screen.findByText(/Investments growth/i);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /customize/i }));

    expect(screen.getByRole('button', { name: /done/i })).toBeInTheDocument();
    // At least one CardEditFrame Hide button (aria-label "Hide <label>") is rendered.
    expect(screen.getAllByRole('button', { name: /^hide /i }).length).toBeGreaterThan(0);
  });

  it('hides a card via the edit-mode controls and exits to normal mode', async () => {
    render(
      <MemoryRouter>
        <Investments />
      </MemoryRouter>,
    );
    await screen.findByText(/Investments growth/i);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /customize/i }));
    // Click the specific Hide button for the Sector exposure card.
    await user.click(screen.getByRole('button', { name: /^hide sector exposure$/i }));
    // Wait for the settings-store update to flush and the page to re-render with
    // the new layout (the Hide button label should flip to "Show" mid-edit).
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^show sector exposure$/i })).toBeInTheDocument(),
    );
    // Exit edit mode.
    await user.click(screen.getByRole('button', { name: /done/i }));

    // Back in normal mode: applyCardLayout drops hidden cards, so the
    // "Sector exposure" CardTitle should be absent.
    await waitFor(() => {
      expect(screen.queryByText('Sector exposure')).not.toBeInTheDocument();
    });
    // And the Customize button is back (proves we're out of edit mode).
    expect(screen.getByRole('button', { name: /customize/i })).toBeInTheDocument();
  });

  it('re-opens edit mode after hiding a card and shows it with Show + crossed-out label', async () => {
    // Pre-seed the layout with `sector` hidden so this test stands alone
    // without depending on the previous it()'s state.
    const layoutWithSectorHidden: CardLayoutEntry[] = [
      { id: 'time-series', hidden: false },
      { id: 'growth', hidden: false },
      { id: 'allocation', hidden: false },
      { id: 'per-company', hidden: false },
      { id: 'sector', hidden: true },
    ];
    primeBaseStores(layoutWithSectorHidden);

    render(
      <MemoryRouter>
        <Investments />
      </MemoryRouter>,
    );
    await screen.findByText(/Investments growth/i);

    // Sanity check: sector card is hidden in normal mode.
    expect(screen.queryByText('Sector exposure')).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /customize/i }));

    // Hidden cards remain in edit mode (Task 7's `orderedForEdit`) so the user
    // can re-show them. The toggle button now reads "Show <label>".
    const showBtn = screen.getByRole('button', { name: /^show sector exposure$/i });
    expect(showBtn).toBeInTheDocument();
    // And the CardEditFrame strip shows the label with line-through styling.
    // The label sits in the same control strip as the Show button — scope to
    // that strip (its parent element) so we don't pick up the CardTitle that
    // still renders inside the wrapper's body for the hidden card.
    const strip = showBtn.parentElement!;
    const labelInStrip = Array.from(strip.querySelectorAll('span')).find(
      (el) => el.textContent === 'Sector exposure',
    );
    expect(labelInStrip).toBeDefined();
    expect(labelInStrip!.className).toMatch(/line-through/);
  });
});
