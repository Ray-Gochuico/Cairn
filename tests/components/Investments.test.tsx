import { StrictMode } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
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
import {
  AccountType,
  ContributionSource,
  DependentType,
  FilingStatus,
  SnapshotSource,
} from '@/types/enums';
import type { Account, Contribution, Dependent, GrowthScenario, Holding, Person } from '@/types/schema';
import Investments from '@/pages/Investments';

const basePerson: Person = {
  id: 1,
  householdId: 1,
  name: 'Alice',
  dateOfBirth: '1990-01-01',
  targetRetirementAge: 65,
  annualSalaryPretax: 100000,
  expectedBonus: 0,
  expectedBonusFrequency: 'ANNUAL',
  bonusIsConsistent: true,
  expectedCommission: 0,
  expectedCommissionFrequency: 'MONTHLY',
  employmentType: 'SALARY_NO_OT',
  hourlyRate: null,
  regularHoursPerWeek: 40,
  otThresholdHoursPerWeek: null,
  pretax401kPct: 0,
  healthInsuranceMonthlyPremium: 0,
  dependentCareFsaMonthly: 0,
  hsaMonthlyContribution: 0,
  hsaEligible: false,
};

// The page reads asset_class for each ticker via getDatabase().select(...).
// We don't have a SQLite singleton here and we don't care about the tickers
// table for the 529 section, so the easiest path is to stub getDatabase().
// Mutable controller for the DB mock so individual tests can pin
// `select()` results without re-mocking the whole module. The default is
// "always returns []", matching the 529-section tests' expectation of
// "no holding values". The asset-allocation donut test overrides this
// to seed asset_class rows for the tickers it asserts on.
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

function resetStores() {
  useAccountsStore.setState({ accounts: [], isLoading: false, error: null });
  useHoldingsStore.setState({ holdings: [], isLoading: false, error: null });
  useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null });
  useContributionsStore.setState({ contributions: [], isLoading: false, error: null });
  useDependentsStore.setState({ dependents: [], isLoading: false, error: null });
  useHouseholdStore.setState({ household: null, isLoading: false, error: null });
  usePersonsStore.setState({ persons: [], isLoading: false, error: null });
  // The fund stores' default load() hits getDatabase().select(...). The mock
  // at the top of the file returns [], but the load() still fires set() which
  // notifies subscribers. Stub out load() so mount-time refreshes are no-ops.
  useTickersStore.setState({ tickers: [], isLoading: false, error: null, load: async () => {} });
  useFundHoldingsStore.setState({ fundHoldings: [], isLoading: false, error: null, load: async () => {} });
  useFundSectorsStore.setState({ fundSectors: [], isLoading: false, error: null, load: async () => {} });
}

interface PrimeOpts {
  scenarios?: GrowthScenario[];
  accounts?: Array<Partial<Account>>;
  /** Snapshot rows; auto-IDs and source default to MANUAL. */
  snapshotValues?: Array<{ accountId: number; snapshotDate: string; totalValue: number }>;
  contributions?: Array<Partial<Contribution>>;
  dependents?: Array<Partial<Dependent>>;
  holdings?: Array<Partial<Holding>>;
}

function primeStores(opts: PrimeOpts = {}) {
  // Override load() on every store so the page's mount-time refresh is a
  // no-op (no DB calls). Mirrors the pattern used in Goals.test.tsx.
  useAccountsStore.setState({
    accounts: (opts.accounts ?? []).map((a, i) => ({
      id: a.id ?? i + 1,
      householdId: a.householdId ?? 1,
      ownerPersonId: a.ownerPersonId ?? null,
      beneficiaryDependentId: a.beneficiaryDependentId ?? null,
      name: a.name ?? `Account ${i + 1}`,
      institution: a.institution ?? null,
      type: a.type ?? AccountType.ACCOUNT_BROKERAGE,
      cryptoWalletAddress: a.cryptoWalletAddress ?? null,
      autoFetchEnabled: a.autoFetchEnabled ?? false,
      excludedFromNetWorth: a.excludedFromNetWorth ?? false,
      stateOfPlan: a.stateOfPlan ?? null,
      accentColor: a.accentColor ?? null,
    })),
    isLoading: false,
    error: null,
    load: async () => {},
  });

  useHoldingsStore.setState({
    holdings: (opts.holdings ?? []).map((h, i) => ({
      id: h.id ?? i + 1,
      accountId: h.accountId ?? 1,
      ticker: h.ticker ?? `TICK${i + 1}`,
      shareCount: h.shareCount ?? 0,
      targetAllocationPct: h.targetAllocationPct ?? null,
      costBasis: h.costBasis ?? null,
    })),
    isLoading: false,
    error: null,
    load: async () => {},
  });

  useSnapshotsStore.setState({
    snapshots: (opts.snapshotValues ?? []).map((s, i) => ({
      id: i + 1,
      accountId: s.accountId,
      snapshotDate: s.snapshotDate,
      totalValue: s.totalValue,
      source: SnapshotSource.MANUAL,
    })),
    isLoading: false,
    error: null,
    load: async () => {},
  });

  useContributionsStore.setState({
    contributions: (opts.contributions ?? []).map((c, i) => ({
      id: c.id ?? i + 1,
      accountId: c.accountId ?? 1,
      personId: c.personId ?? null,
      date: c.date ?? '2026-04-01',
      amount: c.amount ?? 0,
      source: c.source ?? ContributionSource.MANUAL,
    })),
    isLoading: false,
    error: null,
    load: async () => {},
  });

  useDependentsStore.setState({
    dependents: (opts.dependents ?? []).map((d, i) => ({
      id: d.id ?? i + 1,
      householdId: d.householdId ?? 1,
      name: d.name ?? `Dependent ${i + 1}`,
      dateOfBirth: d.dateOfBirth ?? '2018-01-01',
      type: d.type ?? DependentType.CHILD,
    })),
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
      growthScenarios: opts.scenarios ?? fourScenarios,
    },
    isLoading: false,
    error: null,
    load: async () => {},
  });
}

describe('Investments page — 529 section', () => {
  beforeEach(() => {
    resetStores();
    dbSelectImpl.current = async () => [];
    localStorage.clear();
  });

  it('does NOT render 529 Plans section when no 529 accounts exist', () => {
    primeStores({
      accounts: [
        { id: 1, name: 'Schwab Brokerage', type: AccountType.ACCOUNT_BROKERAGE },
      ],
      snapshotValues: [
        { accountId: 1, snapshotDate: '2026-04-01', totalValue: 50_000 },
      ],
    });

    render(
      <MemoryRouter>
        <Investments />
      </MemoryRouter>,
    );
    // The 529 testid sentinel must not be in the DOM at all.
    expect(screen.queryByTestId('529-section')).not.toBeInTheDocument();
    // And the heading text should not appear either.
    expect(screen.queryByText(/^529 Plans$/)).not.toBeInTheDocument();
  });

  it('renders 529 Plans section with current value when a 529 account has a snapshot', () => {
    primeStores({
      accounts: [
        {
          id: 10,
          name: "Junior's NY 529",
          type: AccountType.ACCOUNT_529,
          stateOfPlan: 'NY',
        },
      ],
      snapshotValues: [
        { accountId: 10, snapshotDate: '2026-04-01', totalValue: 12_345 },
      ],
    });

    render(
      <MemoryRouter>
        <Investments />
      </MemoryRouter>,
    );
    const section = screen.getByTestId('529-section');
    expect(section).toBeInTheDocument();
    expect(within(section).getByText("Junior's NY 529")).toBeInTheDocument();
    // Current value formatted as USD with no decimals.
    expect(within(section).getByText(/\$12,345/)).toBeInTheDocument();
    // The "now" label sits next to the value.
    expect(within(section).getByText(/^now$/)).toBeInTheDocument();
    // State of plan surfaces in the muted subtitle (· NY).
    expect(within(section).getByText(/· NY/)).toBeInTheDocument();
  });

  it('shows beneficiary name when beneficiaryDependentId is set, and "no beneficiary set" otherwise', () => {
    primeStores({
      dependents: [{ id: 1, name: 'Junior', dateOfBirth: '2018-05-15' }],
      accounts: [
        {
          id: 10,
          name: 'With Beneficiary',
          type: AccountType.ACCOUNT_529,
          beneficiaryDependentId: 1,
        },
        {
          id: 11,
          name: 'Without Beneficiary',
          type: AccountType.ACCOUNT_529,
          beneficiaryDependentId: null,
        },
      ],
      snapshotValues: [
        { accountId: 10, snapshotDate: '2026-04-01', totalValue: 5_000 },
        { accountId: 11, snapshotDate: '2026-04-01', totalValue: 1_000 },
      ],
    });

    render(
      <MemoryRouter>
        <Investments />
      </MemoryRouter>,
    );
    const section = screen.getByTestId('529-section');
    expect(within(section).getByText(/for Junior/)).toBeInTheDocument();
    expect(within(section).getByText(/no beneficiary set/)).toBeInTheDocument();
  });

  it('shows YTD contributions summed for the current calendar year', () => {
    const year = new Date().getFullYear();
    primeStores({
      dependents: [{ id: 1, name: 'Junior', dateOfBirth: '2018-05-15' }],
      accounts: [
        {
          id: 10,
          name: '529 Plan',
          type: AccountType.ACCOUNT_529,
          beneficiaryDependentId: 1,
        },
      ],
      snapshotValues: [
        { accountId: 10, snapshotDate: `${year}-01-01`, totalValue: 10_000 },
      ],
      contributions: [
        // Two YTD contributions = $750 total.
        { accountId: 10, date: `${year}-01-15`, amount: 250 },
        { accountId: 10, date: `${year}-02-15`, amount: 500 },
        // Prior year — must NOT be counted.
        { accountId: 10, date: `${year - 1}-12-31`, amount: 9999 },
        // Different account — must NOT be counted.
        { accountId: 99, date: `${year}-03-15`, amount: 1234 },
      ],
    });

    render(
      <MemoryRouter>
        <Investments />
      </MemoryRouter>,
    );
    const section = screen.getByTestId('529-section');
    expect(within(section).getByText(/\$750/)).toBeInTheDocument();
    // The "YTD" label sits next to the YTD value.
    expect(within(section).getByText(/^YTD$/)).toBeInTheDocument();
    // The prior-year contribution must not surface as a value.
    expect(within(section).queryByText(/\$9,999/)).not.toBeInTheDocument();
    // The other-account contribution must not surface either.
    expect(within(section).queryByText(/\$1,234/)).not.toBeInTheDocument();
  });

  it('shows projected-at-18 row when beneficiary has DOB, omits it when no beneficiary', () => {
    // Junior's DOB is 17 years before today → ~12 months until 18.
    const today = new Date();
    const dob = new Date(today);
    dob.setFullYear(today.getFullYear() - 17);
    const dobIso = dob.toISOString().slice(0, 10);

    primeStores({
      dependents: [{ id: 1, name: 'Junior', dateOfBirth: dobIso }],
      accounts: [
        {
          id: 10,
          name: 'Has Beneficiary',
          type: AccountType.ACCOUNT_529,
          beneficiaryDependentId: 1,
        },
        {
          id: 11,
          name: 'No Beneficiary',
          type: AccountType.ACCOUNT_529,
          beneficiaryDependentId: null,
        },
      ],
      snapshotValues: [
        { accountId: 10, snapshotDate: '2026-04-01', totalValue: 25_000 },
        { accountId: 11, snapshotDate: '2026-04-01', totalValue: 3_000 },
      ],
    });

    render(
      <MemoryRouter>
        <Investments />
      </MemoryRouter>,
    );
    const section = screen.getByTestId('529-section');
    // The "at 18" label appears for the beneficiaried plan only — so exactly
    // one occurrence in the section.
    expect(within(section).getAllByText(/^at 18$/)).toHaveLength(1);
    // Subtitle should mention the Moderate scenario rate (default 6.0%).
    expect(within(section).getByText(/6\.0%/)).toBeInTheDocument();
  });

  it('Export CSV downloads the holdings table with the account name resolved', async () => {
    primeStores({
      accounts: [
        { id: 1, name: 'Schwab Brokerage', type: AccountType.ACCOUNT_BROKERAGE },
      ],
      holdings: [
        { id: 1, accountId: 1, ticker: 'VTI', shareCount: 10, costBasis: 2000, targetAllocationPct: 0.6 },
      ],
    });

    let capturedCsv = '';
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      void (b as Blob).text().then((t) => { capturedCsv = t; });
      return 'blob:mock';
    });
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    render(
      <MemoryRouter>
        <Investments />
      </MemoryRouter>,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /export csv/i }));
    await Promise.resolve();

    expect(capturedCsv.split('\n')[0]).toBe(
      'account,ticker,share count,cost basis,target allocation',
    );
    expect(capturedCsv.split('\n')[1]).toBe('Schwab Brokerage,VTI,10,2000,0.6');

    createSpy.mockRestore();
    revokeSpy.mockRestore();
  });

  describe('asset allocation donut — entity picker', () => {
    beforeEach(() => {
      // Pin asset_class lookups so the allocation aggregation sees multiple
      // distinct slices instead of everything collapsing to "Other".
      dbSelectImpl.current = async () => [
        { ticker: 'VTI', asset_class: 'US_TOTAL_MARKET' },
        { ticker: 'BND', asset_class: 'US_BONDS' },
        { ticker: 'BTC', asset_class: 'CRYPTO' },
      ];
    });

    it('renders a picker button with the count of visible asset classes', async () => {
      primeStores({
        accounts: [
          { id: 1, name: 'Brokerage', type: AccountType.ACCOUNT_BROKERAGE },
        ],
        holdings: [
          { id: 1, accountId: 1, ticker: 'VTI', shareCount: 10 },
          { id: 2, accountId: 1, ticker: 'BND', shareCount: 5 },
          { id: 3, accountId: 1, ticker: 'BTC', shareCount: 1 },
        ],
        snapshotValues: [
          { accountId: 1, snapshotDate: '2026-04-01', totalValue: 30_000 },
        ],
      });

      render(
        <MemoryRouter>
          <Investments />
        </MemoryRouter>,
      );

      // The Asset allocation card hosts both the title and the picker
      // button. Scope queries to that card so the per-company / sector
      // pickers (which also render "Entities (N/M)" buttons) don't
      // collide with our assertions.
      const allocCard = await waitFor(() => {
        const title = screen.getByText('Asset allocation');
        // Climb to the relative wrapper that contains BOTH the picker
        // (rendered as an absolute sibling) and the underlying Card. We
        // mark that wrapper with data-testid in Investments.tsx.
        const wrap = title.closest('[data-testid="asset-allocation-card"]');
        if (!wrap) throw new Error('Asset allocation card not found');
        // Wait until the asset-class lookup resolves and the donut legend
        // shows all three slices — only then is the picker fully wired.
        const legend = within(wrap as HTMLElement).queryByLabelText('Chart legend');
        if (!legend) throw new Error('legend not yet rendered');
        const items = within(legend as HTMLElement).queryAllByRole('listitem');
        if (items.length < 3) throw new Error('not all slices loaded yet');
        return wrap as HTMLElement;
      });

      expect(
        within(allocCard).getByRole('button', { name: /entities \(3\/3\)/i }),
      ).toBeInTheDocument();
    });

    it('hiding an asset class removes its slice from the legend', async () => {
      primeStores({
        accounts: [
          { id: 1, name: 'Brokerage', type: AccountType.ACCOUNT_BROKERAGE },
        ],
        holdings: [
          { id: 1, accountId: 1, ticker: 'VTI', shareCount: 10 },
          { id: 2, accountId: 1, ticker: 'BND', shareCount: 5 },
          { id: 3, accountId: 1, ticker: 'BTC', shareCount: 1 },
        ],
        snapshotValues: [
          { accountId: 1, snapshotDate: '2026-04-01', totalValue: 30_000 },
        ],
      });

      render(
        <MemoryRouter>
          <Investments />
        </MemoryRouter>,
      );

      const allocCard = await waitFor(() => {
        const title = screen.getByText('Asset allocation');
        const wrap = title.closest('[data-testid="asset-allocation-card"]');
        if (!wrap) throw new Error('Asset allocation card not found');
        const legend = within(wrap as HTMLElement).queryByLabelText('Chart legend');
        if (!legend) throw new Error('legend not yet rendered');
        const items = within(legend as HTMLElement).queryAllByRole('listitem');
        if (items.length < 3) throw new Error('not all slices loaded yet');
        return wrap as HTMLElement;
      });

      // All three asset classes visible in the legend initially.
      const legend = within(allocCard).getByLabelText('Chart legend');
      expect(within(legend).getByText('US Bonds')).toBeInTheDocument();
      expect(within(legend).getByText('Crypto')).toBeInTheDocument();
      expect(within(legend).getByText('US Total Market')).toBeInTheDocument();

      const user = userEvent.setup();
      await user.click(
        within(allocCard).getByRole('button', { name: /entities \(3\/3\)/i }),
      );
      await user.click(within(allocCard).getByLabelText(/US Bonds/));

      // US Bonds slice gone from the legend; the other two remain.
      const legend2 = within(allocCard).getByLabelText('Chart legend');
      expect(within(legend2).queryByText('US Bonds')).toBeNull();
      expect(within(legend2).getByText('Crypto')).toBeInTheDocument();
      expect(within(legend2).getByText('US Total Market')).toBeInTheDocument();
      expect(
        within(allocCard).getByRole('button', { name: /entities \(2\/3\)/i }),
      ).toBeInTheDocument();
    });

    it('allocation legend swatch matches its picker swatch and is stable after hiding the largest class', async () => {
      primeStores({
        accounts: [{ id: 1, name: 'Brokerage', type: AccountType.ACCOUNT_BROKERAGE }],
        holdings: [
          { id: 1, accountId: 1, ticker: 'VTI', shareCount: 100 }, // US Total Market — largest
          { id: 2, accountId: 1, ticker: 'BND', shareCount: 5 }, //   US Bonds
          { id: 3, accountId: 1, ticker: 'BTC', shareCount: 1 }, //   Crypto
        ],
        snapshotValues: [{ accountId: 1, snapshotDate: '2026-04-01', totalValue: 30_000 }],
      });
      render(
        <MemoryRouter>
          <Investments />
        </MemoryRouter>,
      );

      const allocCard = await waitFor(() => {
        const title = screen.getByText('Asset allocation');
        const wrap = title.closest('[data-testid="asset-allocation-card"]');
        if (!wrap) throw new Error('Asset allocation card not found');
        const legend = within(wrap as HTMLElement).queryByLabelText('Chart legend');
        if (!legend) throw new Error('legend not yet rendered');
        if (within(legend as HTMLElement).queryAllByRole('listitem').length < 3) {
          throw new Error('not all slices loaded yet');
        }
        return wrap as HTMLElement;
      });

      // jsdom serializes inline colors as rgb(...); the picker uses `background`
      // and the legend `background-color`. Normalize both to rgb for comparison.
      const toRgb = (s: string) => {
        const hexM = s.match(/^#([0-9a-f]{6})$/i);
        if (hexM) {
          const [r, g, b] = [0, 2, 4].map((k) => parseInt(hexM[1].slice(k, k + 2), 16));
          return `rgb(${r}, ${g}, ${b})`;
        }
        return s.trim();
      };
      const legendSwatch = (label: string) => {
        const li = within(within(allocCard).getByLabelText('Chart legend'))
          .getByText(label)
          .closest('li')!;
        return (li.querySelector('span[aria-hidden]') as HTMLElement).style.backgroundColor;
      };

      const user = userEvent.setup();
      await user.click(
        within(allocCard).getByRole('button', { name: /entities \(3\/3\)/i }),
      );
      const pickerSwatch = (label: string) => {
        const row = within(allocCard).getByLabelText(new RegExp(label)).closest('li')!;
        return (row.querySelector('span[aria-hidden]') as HTMLElement).style.background;
      };

      // (1) For a kept class (Crypto), legend swatch == picker swatch (one source).
      const cryptoLegendBefore = legendSwatch('Crypto');
      expect(cryptoLegendBefore).toBeTruthy();
      expect(toRgb(pickerSwatch('Crypto'))).toBe(toRgb(cryptoLegendBefore));

      // (2) Hide the LARGEST class (US Total Market) -> reindex. Crypto's legend
      // swatch must NOT move (it was keyed on the sorted-index source, not the
      // post-filter position).
      await user.click(within(allocCard).getByLabelText(/US Total Market/));
      expect(legendSwatch('Crypto')).toBe(cryptoLegendBefore);
    });
  });

  it('renders the three-up donut grid with asset, per-ticker, and sector cards', () => {
    primeStores({
      accounts: [
        { id: 1, name: 'Brokerage', type: AccountType.ACCOUNT_BROKERAGE },
      ],
      snapshotValues: [
        { accountId: 1, snapshotDate: '2026-04-01', totalValue: 1_000 },
      ],
    });

    render(
      <MemoryRouter>
        <Investments />
      </MemoryRouter>,
    );

    // All three donut titles render in their cards. PerTickerDonut and
    // SectorDonut fall through to their empty-state cards (no holdings)
    // but still render their titles, which is enough to verify the
    // 3-up grid is wired.
    expect(screen.getByText('Asset allocation')).toBeInTheDocument();
    expect(screen.getByText('Per-company exposure')).toBeInTheDocument();
    expect(screen.getByText('Sector exposure')).toBeInTheDocument();

    // Grid container uses lg:grid-cols-3 so the three donuts sit side-
    // by-side on wide viewports and stack on narrow ones.
    const sectorCardTitle = screen.getByText('Sector exposure');
    // Climb out of: CardTitle → CardHeader → Card → grid container.
    const grid = sectorCardTitle.closest('.grid');
    expect(grid).not.toBeNull();
    expect(grid!.className).toContain('lg:grid-cols-3');
    expect(grid!.className).toContain('grid-cols-1');
  });

  // Regression for P0.5: the live Investments page crashed with
  // "Maximum update depth exceeded" thrown from recharts' JavascriptAnimate
  // after the P0 What-If fix unblocked tab nav. The root cause was render-
  // time churn on the SectorDonut data prop. Mount the page with realistic
  // holdings + ticker + fund-sector data (the only combination that
  // exercises the look-through math), wait for effects to settle, then
  // assert no React render-loop warnings reached console.error AND
  // assert that the donut store's load() is only called a bounded number
  // of times (would be unbounded if the page is looping).
  it('does not emit setState-in-render or Maximum-update-depth warnings with full fund data', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Count how many times the fund-sectors store's load() runs. The live
    // bug manifested as the page calling load() dozens of times within a
    // few seconds; a render loop would do the same here. The load() also
    // simulates the production behaviour of triggering set(), which would
    // re-notify subscribers and amplify any churn into a render storm.
    let loadFundSectorsCallCount = 0;
    const countingLoad = async () => {
      loadFundSectorsCallCount += 1;
      // Emulate the real store's set({ fundSectors: ... }) — keep the array
      // reference fresh so subscribers see a "new" value just like prod.
      useFundSectorsStore.setState({
        fundSectors: [...useFundSectorsStore.getState().fundSectors],
      });
    };
    try {
      primeStores({
        accounts: [
          { id: 1, name: 'Brokerage', type: AccountType.ACCOUNT_BROKERAGE },
        ],
        holdings: [
          { id: 1, accountId: 1, ticker: 'VTI', shareCount: 100 },
          { id: 2, accountId: 1, ticker: 'FXAIX', shareCount: 50 },
        ],
        snapshotValues: [
          { accountId: 1, snapshotDate: '2026-04-01', totalValue: 50_000 },
        ],
      });
      useTickersStore.setState({
        tickers: [
          { ticker: 'VTI', name: 'Vanguard Total', assetClass: 'US_TOTAL_MARKET', leverageFactor: 1, direction: 'LONG', userAdded: false, accentColor: null, sector: null, industry: null },
          { ticker: 'FXAIX', name: 'Fidelity 500', assetClass: 'US_LARGE_CAP', leverageFactor: 1, direction: 'LONG', userAdded: false, accentColor: null, sector: null, industry: null },
        ],
        isLoading: false,
        error: null,
        load: async () => {},
      });
      useFundSectorsStore.setState({
        fundSectors: [
          { fundTicker: 'VTI', sector: 'Technology', weight: 0.28, asOfDate: '2026-01-01' },
          { fundTicker: 'VTI', sector: 'Financial Services', weight: 0.14, asOfDate: '2026-01-01' },
          { fundTicker: 'VTI', sector: 'Healthcare', weight: 0.13, asOfDate: '2026-01-01' },
          { fundTicker: 'VTI', sector: 'Consumer Cyclical', weight: 0.11, asOfDate: '2026-01-01' },
          { fundTicker: 'FXAIX', sector: 'Technology', weight: 0.32, asOfDate: '2026-01-01' },
          { fundTicker: 'FXAIX', sector: 'Healthcare', weight: 0.13, asOfDate: '2026-01-01' },
        ],
        isLoading: false,
        error: null,
        load: countingLoad,
      });

      // StrictMode mirrors main.tsx and double-invokes effects in dev — the
      // exact environment that originally surfaced the live-app crash.
      // Mount, unmount, re-mount to mirror tab navigation (the live app
      // user saw the crash on revisit, not first load).
      const first = render(
        <StrictMode>
          <MemoryRouter><Investments /></MemoryRouter>
        </StrictMode>,
      );
      await waitFor(() => expect(screen.getByText('Sector exposure')).toBeInTheDocument());
      first.unmount();
      render(
        <StrictMode>
          <MemoryRouter><Investments /></MemoryRouter>
        </StrictMode>,
      );
      await waitFor(() => expect(screen.getByText('Sector exposure')).toBeInTheDocument());
      // Allow recharts' animation lifecycle a chance to fire the loop.
      await new Promise((r) => setTimeout(r, 200));
      // Then poke the store one more time to simulate a late update arriving
      // (e.g. fund-holdings sync completing). A healthy page absorbs this
      // without an additional render cascade; a looping page would compound.
      const beforePoke = loadFundSectorsCallCount;
      useTickersStore.setState({
        tickers: [...useTickersStore.getState().tickers],
      });
      await new Promise((r) => setTimeout(r, 100));

      const messages = errorSpy.mock.calls.map((c) => String(c[0] ?? ''));
      expect(messages.find((m) => m.includes('Maximum update depth'))).toBeUndefined();
      expect(messages.find((m) => m.includes('Cannot update a component'))).toBeUndefined();
      // load() should be called at most a few times (mount + SectorDonut
      // mount, doubled by StrictMode, repeated for the re-mount). A render
      // loop would push this into the dozens.
      expect(loadFundSectorsCallCount).toBeLessThan(20);
      // A single late store update should not cascade into many load() calls.
      expect(loadFundSectorsCallCount - beforePoke).toBeLessThan(3);
    } finally {
      errorSpy.mockRestore();
    }
  });

  // Sentinel: the Contributions area was consolidated from two adjacent bar
  // charts (single-series totals + stacked-by-bucket) into ONE stacked chart
  // whose stack height communicates the monthly total. This test catches a
  // regression where the deleted single-series chart returns, OR the
  // consolidated chart's subtitle drifts back to wording that doesn't make
  // it clear the total IS the stack height (so users don't think they're
  // missing a separate totals chart).
  it('renders exactly one consolidated contributions chart (stack height = total)', () => {
    primeStores({
      accounts: [
        { id: 1, name: 'Brokerage', type: AccountType.ACCOUNT_BROKERAGE },
      ],
      snapshotValues: [
        { accountId: 1, snapshotDate: '2026-04-01', totalValue: 50_000 },
      ],
      contributions: [
        { accountId: 1, date: '2026-04-01', amount: 1000 },
      ],
    });

    render(
      <MemoryRouter>
        <Investments />
      </MemoryRouter>,
    );

    // The deleted single-series chart's title and subtitle must not return.
    expect(screen.queryByText('Contributions (last 12 months)')).not.toBeInTheDocument();
    expect(screen.queryByText('Sum of contributions per month')).not.toBeInTheDocument();
    // The consolidated chart's subtitle must communicate that the total IS
    // the stack height — guards against a future drift back to wording that
    // makes users think they're missing a separate totals chart.
    expect(screen.getByText(/stack height = total/i)).toBeInTheDocument();
  });

  it('view filter ?view=p1 hides accounts owned by p2', () => {
    // Seed two persons so useViewFilter recognises a two-person household.
    usePersonsStore.setState({
      persons: [
        { ...basePerson, id: 1, name: 'Alice' },
        { ...basePerson, id: 2, name: 'Bob' },
      ],
      isLoading: false,
      error: null,
      load: async () => {},
    });

    primeStores({
      accounts: [
        {
          id: 1,
          name: "Alice's Brokerage",
          type: AccountType.ACCOUNT_BROKERAGE,
          ownerPersonId: 1,
        },
        {
          id: 2,
          name: "Bob's Brokerage",
          type: AccountType.ACCOUNT_BROKERAGE,
          ownerPersonId: 2,
        },
      ],
      snapshotValues: [
        { accountId: 1, snapshotDate: '2026-04-01', totalValue: 50_000 },
        { accountId: 2, snapshotDate: '2026-04-01', totalValue: 75_000 },
      ],
    });

    render(
      <MemoryRouter initialEntries={['/investments?view=p1']}>
        <Investments />
      </MemoryRouter>,
    );

    // p1's brokerage is visible (in the Accounts list)
    expect(screen.getByText("Alice's Brokerage")).toBeInTheDocument();
    // p2's brokerage is filtered out
    expect(screen.queryByText("Bob's Brokerage")).not.toBeInTheDocument();
  });
});
