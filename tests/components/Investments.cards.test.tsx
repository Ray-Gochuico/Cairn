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

  // Wave-3 adjacency (protected views): the three donuts form one compact
  // row with Concentration Health DIRECTLY beneath its inputs; class-targets
  // moves next to drift (which consumes the targets). Pinned against the
  // real page registry via the rendered card anchors below.
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

// Mutable controller so individual tests can pin asset_class lookups for the
// per-ticker `tickers` SELECT. Defaults to "[]" (every ticker falls back to
// AssetClass.OTHER) — fine for the edit-mode tests that don't assert on the
// allocation/target tables.
const dbSelectImpl: { current: (sql: string, params?: unknown[]) => Promise<unknown[]> } = {
  current: async () => [],
};
vi.mock('@/db/db', () => ({
  getDatabase: () => ({
    select: (sql: string, params?: unknown[]) => dbSelectImpl.current(sql, params),
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
  assetClassTargetAllocations: null,
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
    dbSelectImpl.current = async () => [];
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

  it('Investments growth card drops excludedFromNetWorth accounts from horizon sums', async () => {
    primeBaseStores();
    useAccountsStore.setState({
      accounts: [
        ...useAccountsStore.getState().accounts,
        {
          id: 2,
          householdId: 1,
          ownerPersonId: null,
          beneficiaryDependentId: null,
          name: 'Hidden 401k',
          institution: null,
          type: AccountType.ACCOUNT_401K,
          cryptoWalletAddress: null,
          autoFetchEnabled: false,
          excludedFromNetWorth: true,
          stateOfPlan: null,
          accentColor: null,
        },
      ],
      isLoading: false,
      error: null,
      load: async () => {},
    } as never);
    useSnapshotsStore.setState({
      snapshots: [
        { id: 1, accountId: 1, snapshotDate: '2026-04-01', totalValue: 50_000, source: SnapshotSource.MANUAL },
        { id: 2, accountId: 2, snapshotDate: '2026-04-01', totalValue: 30_000, source: SnapshotSource.MANUAL },
      ],
      isLoading: false,
      error: null,
      load: async () => {},
    } as never);

    render(
      <MemoryRouter>
        <Investments />
      </MemoryRouter>,
    );
    await screen.findByText(/Investments growth/i);
    // Leak: $80,000 (50k + 30k). Fixed: $50,000 only.
    expect(screen.queryByText('$80,000')).not.toBeInTheDocument();
    expect(screen.getAllByText('$50,000').length).toBeGreaterThan(0);
  });
});

describe('Investments Target vs Actual — two sibling tables', () => {
  beforeEach(() => {
    // Pin asset_class so VTI/BND land in distinct classes (not "Other").
    dbSelectImpl.current = async () => [
      { ticker: 'VTI', asset_class: 'US_TOTAL_MARKET' },
      { ticker: 'BND', asset_class: 'US_BONDS' },
    ];
  });

  // VTI shareCount 6 + BND shareCount 4, snapshot 1000 ⇒ valueHoldings splits
  // by share count: VTI 600, BND 400; household total 1000. VTI carries a
  // per-ticker target (1.0 → within-class share 1.0 since it's the only
  // US_TOTAL_MARKET holding). Class targets 50/50.
  function primeTargetStores() {
    primeBaseStores();
    useHoldingsStore.setState({
      holdings: [
        { id: 1, accountId: 1, ticker: 'VTI', shareCount: 6, targetAllocationPct: 1.0, costBasis: null },
        { id: 2, accountId: 1, ticker: 'BND', shareCount: 4, targetAllocationPct: null, costBasis: null },
      ],
      isLoading: false,
      error: null,
      load: async () => {},
    });
    useSettingsStore.setState({
      settings: {
        ...baseSettings,
        assetClassTargetAllocations: [
          { assetClass: 'US_TOTAL_MARKET', targetPct: 0.5 },
          { assetClass: 'US_BONDS', targetPct: 0.5 },
        ],
      },
      isLoading: false,
      error: null,
      load: async () => {},
      update: async () => {},
    });
  }

  it('renders a By-asset-class and a By-holding table with Invested and the dual-basis caption', async () => {
    primeTargetStores();
    render(
      <MemoryRouter>
        <Investments />
      </MemoryRouter>,
    );
    expect(await screen.findByRole('table', { name: /by asset class/i })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: /by holding/i })).toBeInTheDocument();
    // Invested column renders a currency value (DriftRow.value surfaced). The
    // By-class table DROPPED "Target $" (Design H3) — do NOT assert it.
    expect(screen.getByTestId('class-row-US_BONDS')).toHaveTextContent('$');
    // Dual-basis caption present (UX H2/H3, Finance M2).
    expect(screen.getByText(/share of its asset-class target/i)).toBeInTheDocument();
  });

  it('renders the By-holding Target on the household basis so Actual − Target = Drift', async () => {
    primeTargetStores();
    render(
      <MemoryRouter>
        <Investments />
      </MemoryRouter>,
    );
    // VTI: actual 60% (600/1000), within-class target$ = 1.0 × 0.5 × 1000 = 500
    // ⇒ household target 50%, drift +10%. 60 − 50 = 10 reconciles.
    const vtiRow = await screen.findByTestId('holding-row-VTI');
    expect(vtiRow).toHaveTextContent('60.0%'); // actual (household)
    expect(vtiRow).toHaveTextContent('50.0%'); // target (household, = actual − drift)
    expect(vtiRow).toHaveTextContent('+10.0%'); // drift
  });
});

describe('Wave-3 concentration adjacency + deep links', () => {
  // jsdom has no scrollIntoView; install a recorder so both the hash-scroll
  // effect and the warning->donut buttons are assertable.
  const scrolledTo: string[] = [];
  beforeEach(() => {
    dbSelectImpl.current = async () => [];
    primeBaseStores();
    scrolledTo.length = 0;
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolledTo.push((this as HTMLElement).id);
    };
  });

  function seedHoldingsForClassTargets() {
    // One holding makes heldClasses non-empty so 'class-targets' is
    // applicable — required to pin its new position AFTER concentration.
    useHoldingsStore.setState({
      holdings: [
        { id: 1, accountId: 1, ticker: 'VTI', shareCount: 10, targetAllocationPct: null, costBasis: null },
      ],
      isLoading: false, error: null, load: async () => {},
    });
  }

  it('default order: allocation → per-company → sector → concentration → class-targets (card anchors in DOM order)', async () => {
    seedHoldingsForClassTargets();
    render(
      <MemoryRouter>
        <Investments />
      </MemoryRouter>,
    );
    await screen.findByText(/Investments growth/i);
    const ids = Array.from(
      document.querySelectorAll('#allocation, #per-company, #sector, #concentration, #class-targets'),
    ).map((e) => e.id);
    expect(ids).toEqual(['allocation', 'per-company', 'sector', 'concentration', 'class-targets']);
  });

  it('#concentration deep link scrolls the concentration card into view on arrival', async () => {
    render(
      <MemoryRouter initialEntries={['/investments#concentration']}>
        <Investments />
      </MemoryRouter>,
    );
    await screen.findByText(/Investments growth/i);
    await waitFor(() => expect(scrolledTo).toContain('concentration'));
  });

  it('a per-ticker warning row renders a "View in donut" button that scrolls to the per-company card', async () => {
    // AAPL at 30% of effective exposure fires PER_TICKER_HIGH.
    useHoldingsStore.setState({
      holdings: [
        { id: 1, accountId: 1, ticker: 'AAPL', shareCount: 30, targetAllocationPct: null, costBasis: null },
        { id: 2, accountId: 1, ticker: 'BND', shareCount: 70, targetAllocationPct: null, costBasis: null },
      ],
      isLoading: false, error: null, load: async () => {},
    });
    render(
      <MemoryRouter>
        <Investments />
      </MemoryRouter>,
    );
    await screen.findByText(/Investments growth/i);
    const buttons = await screen.findAllByRole('button', { name: /view in donut/i });
    expect(buttons.length).toBeGreaterThan(0);
    const user = userEvent.setup();
    await user.click(buttons[0]);
    await waitFor(() => expect(scrolledTo.length).toBeGreaterThan(0));
    expect(['per-company', 'allocation']).toContain(scrolledTo[scrolledTo.length - 1]);
  });
});
