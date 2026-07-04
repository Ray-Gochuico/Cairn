import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { useLoansStore } from '@/stores/loans-store';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import { usePersonsStore } from '@/stores/persons-store';
import { AccountType, LoanType, PropertyType, SnapshotSource } from '@/types/enums';
import type { Account, AccountSnapshot, Loan, Property } from '@/types/schema';

// Captured chart-level handlers — Task 11's scrub/pin tests drive these
// directly (recharts renders nothing in jsdom; mock pattern extends the
// removed stacked-bar chart test's mock).
interface CapturedChart {
  data: Array<Record<string, number | string>>;
  onMouseMove?: (s: { activeLabel?: string; isTooltipActive?: boolean }, e: unknown) => void;
  onMouseLeave?: () => void;
  onClick?: (s: { activeLabel?: string }, e: unknown) => void;
}
let captured: CapturedChart = { data: [] };

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="rc-responsive">{children}</div>
  ),
  AreaChart: ({ data, children, onMouseMove, onMouseLeave, onClick }: never) => {
    captured = { data, onMouseMove, onMouseLeave, onClick } as CapturedChart;
    return (
      <div data-testid="rc-area-chart" data-bucket-count={(data as never[]).length}>
        <pre data-testid="rc-data">{JSON.stringify(data)}</pre>
        {/* Children render inside an <svg> so the component's real SVG bits
            (<defs>/<linearGradient>/<stop>, Task 10) get the SVG namespace —
            in a <div> React logs "unrecognized tag / incorrect casing" noise
            for them on every test. */}
        <svg>{children}</svg>
      </div>
    );
  },
  Area: ({ dataKey, stroke, fill }: { dataKey: string; stroke?: string; fill?: string }) => (
    <div data-testid={`area-${dataKey}`} data-stroke={stroke ?? ''} data-fill={fill ?? ''} />
  ),
  CartesianGrid: () => null,
  XAxis: ({ ticks }: { ticks?: string[] }) => (
    <div data-testid="x-axis" data-ticks={JSON.stringify(ticks ?? [])} />
  ),
  YAxis: () => null,
  Tooltip: () => null,
  ReferenceLine: ({ x }: { x: string }) => <div data-testid="pin-line" data-x={x} />,
  ReferenceDot: ({ x, y }: { x: string; y: number }) => (
    <div data-testid="ref-dot" data-x={x} data-y={y} />
  ),
}));

import AssetValueChart, {
  AssetValueTooltipContent,
} from '@/components/charts/AssetValueChart';

function mkAccount(id: number, name: string, overrides: Partial<Account> = {}): Account {
  return {
    id, householdId: 1, ownerPersonId: null, beneficiaryDependentId: null, name,
    institution: null, type: AccountType.ACCOUNT_BROKERAGE, cryptoWalletAddress: null,
    autoFetchEnabled: false, excludedFromNetWorth: false, allowMargin: false,
    stateOfPlan: null, accentColor: null, hasEmployerMatch: null, employerMatchPct: null,
    employerMatchLimitPct: null, allowsMegaBackdoorRollover: null, hasHighFees: null,
    apyRate: null, ...overrides,
  };
}
function mkSnapshot(id: number, accountId: number, date: string, value: number): AccountSnapshot {
  return { id, accountId, snapshotDate: date, totalValue: value, source: SnapshotSource.MANUAL };
}
function mkLoan(id: number, name: string, overrides: Partial<Loan> = {}): Loan {
  return {
    id, householdId: 1, obligorPersonId: null, name, type: LoanType.MORTGAGE,
    originalAmount: 400000, currentBalance: 350000, interestRate: 0.04, termMonths: 360,
    firstPaymentDate: '2024-01-01', monthlyPayment: 1909.66, extraPaymentDefault: 0,
    linkedPropertyId: null, linkedVehicleId: null, ...overrides,
  };
}
function mkProperty(id: number, name: string, overrides: Partial<Property> = {}): Property {
  return {
    id, householdId: 1, ownerPersonId: null, name, type: PropertyType.PRIMARY_RESIDENCE,
    address: null, purchaseDate: null, purchasePrice: null, currentEstimatedValue: 400000,
    linkedLoanId: null, excludedFromNetWorth: false, ...overrides,
  };
}

function seedStores(opts: { withLoan?: boolean } = {}) {
  useAccountsStore.setState({
    accounts: [mkAccount(1, 'Schwab'), mkAccount(2, 'Fidelity 401k')],
    isLoading: false, error: null,
    load: async () => {},
  } as never);
  useSnapshotsStore.setState({
    snapshots: [
      mkSnapshot(1, 1, '2025-07-10', 90000),
      mkSnapshot(2, 1, '2026-06-05', 110000),
      mkSnapshot(3, 2, '2025-07-10', 50000),
      mkSnapshot(4, 2, '2026-06-05', 60000),
    ],
    isLoading: false, error: null, load: async () => {},
  } as never);
  usePropertiesStore.setState({ properties: [], isLoading: false, error: null, load: async () => {} } as never);
  useVehiclesStore.setState({ vehicles: [], isLoading: false, error: null, load: async () => {} } as never);
  useLoansStore.setState({
    loans: opts.withLoan ? [mkLoan(9, 'Mortgage')] : [],
    isLoading: false, error: null, load: async () => {},
  } as never);
  useAssetValueSnapshotsStore.setState({
    assetValueSnapshots: [], isLoading: false, error: null, load: async () => {},
  } as never);
}

function seedEmptyStores() {
  useAccountsStore.setState({ accounts: [], isLoading: false, error: null, load: async () => {} } as never);
  useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null, load: async () => {} } as never);
  usePropertiesStore.setState({ properties: [], isLoading: false, error: null, load: async () => {} } as never);
  useVehiclesStore.setState({ vehicles: [], isLoading: false, error: null, load: async () => {} } as never);
  useLoansStore.setState({ loans: [], isLoading: false, error: null, load: async () => {} } as never);
  useAssetValueSnapshotsStore.setState({ assetValueSnapshots: [], isLoading: false, error: null, load: async () => {} } as never);
}

function renderChart(surface: 'netWorth' | 'dashboard' | 'investments') {
  return render(
    <MemoryRouter>
      <AssetValueChart surface={surface} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-06-12T12:00:00Z') });
  localStorage.clear();
  captured = { data: [] };
});
afterEach(() => {
  vi.useRealTimers();
});

describe('AssetValueChart — skeleton', () => {
  it('netWorth surface defaults to everything → label "Net worth"', () => {
    seedStores({ withLoan: true });
    renderChart('netWorth');
    expect(screen.getByText('Net worth')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Included · 3 of 3/ })).toBeInTheDocument();
  });

  it('dashboard surface defaults to assets only → label "Total assets"', () => {
    seedStores({ withLoan: true });
    renderChart('dashboard');
    expect(screen.getByText('Total assets')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Included · 2 of 3/ })).toBeInTheDocument();
  });

  it('range tabs render, default 1Y, click persists to the surface namespace', async () => {
    seedStores();
    renderChart('netWorth');
    // Labeled (Wave-5 a11y ride-along): mirrors GrowthCard's "Time horizon"
    // TabsList so the range control has a name for SR users.
    const tabs = screen.getByRole('tablist', { name: /time range/i });
    expect(within(tabs).getAllByRole('tab').map((t) => t.textContent)).toEqual(
      ['3M', '6M', 'YTD', '1Y', '5Y', 'All'],
    );
    await userEvent.click(within(tabs).getByRole('tab', { name: '6M' }));
    expect(localStorage.getItem('netWorthChart.timeWindow')).toBe('6M');
  });

  it('dashboard persists its window independently', async () => {
    seedStores();
    renderChart('dashboard');
    await userEvent.click(screen.getByRole('tab', { name: '3M' }));
    expect(localStorage.getItem('dashboardAssetChart.timeWindow')).toBe('3M');
    expect(localStorage.getItem('netWorthChart.timeWindow')).toBeNull();
  });

  it('picker toggle persists and updates the count + label', async () => {
    seedStores({ withLoan: true });
    renderChart('netWorth');
    await userEvent.click(screen.getByRole('button', { name: /Included · 3 of 3/ }));
    const dialog = screen.getByRole('dialog', { name: /Included entities/ });
    await userEvent.click(within(dialog).getByLabelText('Mortgage'));
    expect(screen.getByRole('button', { name: /Included · 2 of 3/ })).toBeInTheDocument();
    expect(screen.getByText('Total assets')).toBeInTheDocument();
    const saved = JSON.parse(localStorage.getItem('netWorthChart.selectedEntities')!);
    expect(saved).toHaveLength(2);
  });

  it('All / None shortcuts work', async () => {
    seedStores({ withLoan: true });
    renderChart('netWorth');
    await userEvent.click(screen.getByRole('button', { name: /Included · 3 of 3/ }));
    const dialog = screen.getByRole('dialog', { name: /Included entities/ });
    await userEvent.click(within(dialog).getByRole('button', { name: 'None' }));
    expect(screen.getByText(/Select at least one/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'All' }));
    expect(screen.getByRole('button', { name: /Included · 3 of 3/ })).toBeInTheDocument();
  });

  it('renders the no-eligible-entities empty state with a CTA on the dashboard', () => {
    seedEmptyStores();
    renderChart('dashboard');
    expect(screen.getByRole('link', { name: /Add an account/ })).toHaveAttribute('href', '/inputs/accounts');
  });

  it('header shows the latest value and a signed delta with range phrase', () => {
    seedStores();
    renderChart('netWorth');
    // Latest = 110k + 60k = $170,000. 1Y window from faked today 2026-06-12 →
    // cutoff 2025-06-12; first snapshots 2025-07-10 (WEEK bucket 2025-07-12) →
    // baseline 140,000; delta +30,000; data starts inside the window → "since".
    expect(screen.getByText('$170,000')).toBeInTheDocument();
    expect(screen.getByText(/\+\$30,000/)).toBeInTheDocument();
    // The sr-only delta sentence ("Up $30,000, …, since Jul 2025") also
    // contains the phrase — assert presence, not uniqueness.
    expect(screen.getAllByText(/since Jul 2025/).length).toBeGreaterThan(0);
  });

  it('wraps the card content in a labeled region: label, value, delta (spec §3.9)', () => {
    seedStores();
    renderChart('netWorth');
    expect(
      screen.getByRole('region', {
        name: 'Net worth: $170,000, up $30,000 since Jul 2025',
      }),
    ).toBeInTheDocument();
  });

  it('dashboard surface renders the Net Worth → link; netWorth surface does not', () => {
    seedStores();
    const { unmount } = renderChart('dashboard');
    expect(screen.getByRole('link', { name: /Net Worth/ })).toHaveAttribute('href', '/net-worth');
    unmount();
    renderChart('netWorth');
    expect(screen.queryByRole('link', { name: /Net Worth/ })).not.toBeInTheDocument();
  });

  it('hydrates a saved time window from the surface namespace', () => {
    localStorage.setItem('netWorthChart.timeWindow', '5Y');
    seedStores();
    renderChart('netWorth');
    expect(screen.getByRole('tab', { name: '5Y' })).toHaveAttribute('aria-selected', 'true');
  });

  it('re-intersects a saved selection when stores hydrate after mount (deleted ids dropped)', () => {
    localStorage.setItem(
      'netWorthChart.selectedEntities',
      JSON.stringify([{ kind: 'account', id: 1 }, { kind: 'account', id: 99 }]),
    );
    seedEmptyStores();
    renderChart('netWorth');
    // Stores arrive after first paint (two-phase hydration): the saved
    // selection re-intersects with the now-eligible set — id 99 is gone.
    act(() => seedStores());
    expect(screen.getByRole('button', { name: /Included · 1 of 2/ })).toBeInTheDocument();
  });

  it('does not persist the default selection — only explicit picks write storage', () => {
    seedStores({ withLoan: true });
    renderChart('netWorth');
    expect(screen.getByRole('button', { name: /Included · 3 of 3/ })).toBeInTheDocument();
    expect(localStorage.getItem('netWorthChart.selectedEntities')).toBeNull();
  });

  it('Escape closes the picker', async () => {
    seedStores({ withLoan: true });
    renderChart('netWorth');
    await userEvent.click(screen.getByRole('button', { name: /Included · 3 of 3/ }));
    expect(screen.getByRole('dialog', { name: /Included entities/ })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: /Included entities/ })).not.toBeInTheDocument();
  });
});

describe('AssetValueTooltipContent', () => {
  const row = {
    bucketEnd: '2026-06-30', netWorth: 169925,
    'account:1': 110000, 'account:2': 60000, 'account:3': 50, 'account:4': 40,
    'account:5': 30, 'account:6': 20, 'loan:9': -215,
  };
  const nameByKey = new Map([
    ['account:1', 'Schwab'], ['account:2', '401k'], ['account:3', 'A3'],
    ['account:4', 'A4'], ['account:5', 'A5'], ['account:6', 'A6'], ['loan:9', 'Mortgage'],
  ]);

  it('renders clamped date, bold total, top-5 by |value|, signed +N more', () => {
    render(
      <AssetValueTooltipContent
        active
        payload={[{ value: 169925, payload: row }]}
        label="2026-06-30"
        nameByKey={nameByKey}
        headerLabel="Net worth"
        todayIso="2026-06-12"
      />,
    );
    expect(screen.getByText('Jun 12, 2026')).toBeInTheDocument(); // clamped from 06-30
    expect(screen.getByText('Net worth')).toBeInTheDocument();
    expect(screen.getByText('$169,925')).toBeInTheDocument();
    // Top-5 by |value|: 110000, 60000, |−215|, 50, 40 → Mortgage IS in the top-5.
    expect(screen.getByText('Schwab')).toBeInTheDocument();
    expect(screen.getByText('Mortgage')).toBeInTheDocument();
    expect(screen.getByText('−$215')).toBeInTheDocument(); // loan negative, U+2212
    expect(screen.getByText('A4')).toBeInTheDocument();
    expect(screen.queryByText('A5')).not.toBeInTheDocument(); // remainder
    expect(screen.getByText('+2 more')).toBeInTheDocument();
    // 30 + 20 = +$50, signed sum. '$50' also appears as A3's own row value,
    // so scope the assertion to the "+N more" row.
    const moreRow = screen.getByText('+2 more').closest('li')!;
    expect(within(moreRow).getByText('$50')).toBeInTheDocument();
  });

  it('renders nothing when inactive or payload empty', () => {
    const { container } = render(
      <AssetValueTooltipContent active={false} payload={[]} label="" nameByKey={nameByKey} headerLabel="x" todayIso="2026-06-12" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('canvas polish', () => {
  it('end dot sits on the last bucket; line + gradient are success-toned on an up range', () => {
    seedStores();
    renderChart('netWorth');
    const dots = screen.getAllByTestId('ref-dot');
    expect(dots).toHaveLength(1); // end dot only — no pin active
    expect(dots.some((d) => d.getAttribute('data-x') === String(captured.data[captured.data.length - 1].bucketEnd))).toBe(true);
    const area = screen.getByTestId('area-netWorth');
    expect(area.getAttribute('data-stroke')).toBe('hsl(var(--success))');
    expect(area.getAttribute('data-fill')).toMatch(/^url\(#avc-fill-netWorth-up\)$/);
  });

  it('line + gradient turn destructive on a down range', () => {
    seedStores();
    useSnapshotsStore.setState({
      snapshots: [
        mkSnapshot(1, 1, '2025-07-10', 200000),
        mkSnapshot(2, 1, '2026-06-05', 110000),
        mkSnapshot(3, 2, '2025-07-10', 50000),
        mkSnapshot(4, 2, '2026-06-05', 60000),
      ],
      isLoading: false, error: null, load: async () => {},
    } as never);
    renderChart('netWorth');
    const area = screen.getByTestId('area-netWorth');
    expect(area.getAttribute('data-stroke')).toBe('hsl(var(--destructive))');
    expect(area.getAttribute('data-fill')).toMatch(/^url\(#avc-fill-netWorth-down\)$/);
  });

  it('x-axis receives the explicit month-first tick array', () => {
    seedStores();
    renderChart('netWorth');
    const ticks = JSON.parse(screen.getByTestId('x-axis').getAttribute('data-ticks')!);
    expect(ticks.length).toBeGreaterThan(2);
    expect(ticks[0]).toBe(captured.data[0].bucketEnd);
  });

  it('scrub re-renders bail at the ChartCanvas memo boundary (recharts untouched)', () => {
    // The AreaChart mock reassigns `captured` on EVERY canvas render, so
    // object identity is a render counter: if a scrub re-render leaked
    // through the memo(ChartCanvas) boundary, `captured` would be replaced.
    seedStores();
    renderChart('netWorth');
    const before = captured;
    const firstBucket = String(captured.data[0].bucketEnd);
    act(() => captured.onMouseMove!({ activeLabel: firstBucket, isTooltipActive: true }, {}));
    expect(screen.getByTestId('asset-chart-header-value').textContent).toBe('$140,000'); // header DID move
    expect(captured).toBe(before); // canvas did NOT re-render
    act(() => captured.onMouseLeave!());
    expect(captured).toBe(before);
    // Positive control: pinning DOES change a canvas prop (pinRow), so this
    // render must pass THROUGH the memo — proving the identity assertions
    // above can actually fail and aren't vacuous against a frozen mock.
    act(() => captured.onClick!({ activeLabel: firstBucket }, {}));
    expect(captured).not.toBe(before);
  });
});

describe('hover-scrub and pin', () => {
  it('scrubbing updates the header to the hovered bucket and reverts on leave', () => {
    seedStores();
    renderChart('netWorth');
    const firstBucket = String(captured.data[0].bucketEnd);
    act(() => captured.onMouseMove!({ activeLabel: firstBucket, isTooltipActive: true }, {}));
    expect(screen.getByText('$140,000')).toBeInTheDocument(); // baseline bucket value
    act(() => captured.onMouseLeave!());
    expect(screen.getByText('$170,000')).toBeInTheDocument();
  });

  // The pin tests scope header-value assertions to the header element
  // (data-testid="asset-chart-header-value"): pinning auto-expands the
  // Task 12 breakdown panel, whose footer Total renders the same dollar
  // string. Intent unchanged — the HEADER shows the pinned/scrubbed value.
  it('clicking pins: reference line + pin dot render, header locks, Esc clears', () => {
    seedStores();
    renderChart('netWorth');
    const firstBucket = String(captured.data[0].bucketEnd);
    act(() => captured.onClick!({ activeLabel: firstBucket }, {}));
    expect(screen.getByTestId('pin-line').getAttribute('data-x')).toBe(firstBucket);
    // pin dot at the pinned bucket (a second ref-dot besides the end dot)
    const dots = screen.getAllByTestId('ref-dot');
    const pinDot = dots.find((d) => d.getAttribute('data-x') === firstBucket);
    expect(pinDot).toBeDefined();
    expect(pinDot!.getAttribute('data-y')).toBe('140000'); // y looked up from the pinned row
    expect(screen.getByTestId('asset-chart-header-value').textContent).toBe('$140,000');
    expect(screen.getByRole('button', { name: 'Clear pinned date' })).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(screen.queryByTestId('pin-line')).not.toBeInTheDocument();
    expect(screen.getByTestId('asset-chart-header-value').textContent).toBe('$170,000');
  });

  it('scrub takes precedence over pin; leave reverts to the PIN, not latest', () => {
    seedStores();
    renderChart('netWorth');
    const firstBucket = String(captured.data[0].bucketEnd);
    const lastBucket = String(captured.data[captured.data.length - 1].bucketEnd);
    act(() => captured.onClick!({ activeLabel: firstBucket }, {}));
    act(() => captured.onMouseMove!({ activeLabel: lastBucket, isTooltipActive: true }, {}));
    expect(screen.getByTestId('asset-chart-header-value').textContent).toBe('$170,000'); // scrub wins
    act(() => captured.onMouseLeave!());
    expect(screen.getByTestId('asset-chart-header-value').textContent).toBe('$140,000'); // back to pin
  });

  it('clicking the same bucket unpins; pin clears when the bucket vanishes on range change', async () => {
    seedStores();
    renderChart('netWorth');
    const firstBucket = String(captured.data[0].bucketEnd);
    act(() => captured.onClick!({ activeLabel: firstBucket }, {}));
    act(() => captured.onClick!({ activeLabel: firstBucket }, {}));
    expect(screen.queryByTestId('pin-line')).not.toBeInTheDocument();
    act(() => captured.onClick!({ activeLabel: firstBucket }, {}));
    await userEvent.click(screen.getByRole('tab', { name: '5Y' })); // WEEK→MONTH: bucket ids change
    expect(screen.queryByTestId('pin-line')).not.toBeInTheDocument();
  });

  it('picker Esc wins over pin Esc (defaultPrevented)', async () => {
    seedStores({ withLoan: true });
    renderChart('netWorth');
    const firstBucket = String(captured.data[0].bucketEnd);
    act(() => captured.onClick!({ activeLabel: firstBucket }, {}));
    await userEvent.click(screen.getByRole('button', { name: /Included · 3 of 3/ }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: /Included entities/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('pin-line')).toBeInTheDocument(); // pin SURVIVED the picker's Esc
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByTestId('pin-line')).not.toBeInTheDocument(); // second Esc clears the pin
  });

  it('dashboard surface ignores clicks (no pin)', () => {
    seedStores();
    renderChart('dashboard');
    const firstBucket = String(captured.data[0].bucketEnd);
    act(() => captured.onClick?.({ activeLabel: firstBucket }, {}));
    expect(screen.queryByTestId('pin-line')).not.toBeInTheDocument();
  });
});

describe('estimated-values footnote (spec §3.6, chart-level)', () => {
  it('shows the footnote when estimate-backed entities exceed 25% of gross included assets', () => {
    // One account with a single snapshot (150000, no growth history) plus a
    // property carrying only a flat currentEstimatedValue (no asset-value
    // snapshots — estimate-backed per estimateBackedKeys). Gross included =
    // 600000 + 150000 = 750000; estimate share = 600000 / 750000 = 80% > 25%.
    useAccountsStore.setState({
      accounts: [mkAccount(1, 'Schwab')], isLoading: false, error: null, load: async () => {},
    } as never);
    useSnapshotsStore.setState({
      snapshots: [mkSnapshot(1, 1, '2026-06-05', 150000)],
      isLoading: false, error: null, load: async () => {},
    } as never);
    usePropertiesStore.setState({
      properties: [mkProperty(1, 'Lake House', { currentEstimatedValue: 600000 })],
      isLoading: false, error: null, load: async () => {},
    } as never);
    useVehiclesStore.setState({ vehicles: [], isLoading: false, error: null, load: async () => {} } as never);
    useLoansStore.setState({ loans: [], isLoading: false, error: null, load: async () => {} } as never);
    useAssetValueSnapshotsStore.setState({
      assetValueSnapshots: [], isLoading: false, error: null, load: async () => {},
    } as never);
    renderChart('netWorth');
    expect(screen.getByText(/Estimated values make up 80% of included/)).toBeInTheDocument();
  });

  it('is absent for the standard seedStores fixture (accounts only, no estimates)', () => {
    seedStores();
    renderChart('netWorth');
    expect(screen.queryByText(/Estimated values make up/)).not.toBeInTheDocument();
  });
});

describe('breakdown panel (netWorth surface)', () => {
  it('is collapsed by default, expands with full rows + footer tie', async () => {
    seedStores({ withLoan: true });
    renderChart('netWorth');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: /Breakdown/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(toggle);
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(5); // header + 3 entities + footer
    expect(within(table).getByText('Mortgage')).toBeInTheDocument();
    const footer = rows[rows.length - 1];
    expect(within(footer).getByText('Total')).toBeInTheDocument();
    // Footer total ties to the header value (latest 170,000 − 350,000 loan = −$180,000)
    expect(within(footer).getByText('−$180,000')).toBeInTheDocument();
    expect(screen.getByText('Click the chart to pin a date.')).toBeInTheDocument();
  });

  it('pinning auto-expands and shows the pinned as-of date', () => {
    seedStores({ withLoan: true });
    renderChart('netWorth');
    const firstBucket = String(captured.data[0].bucketEnd);
    act(() => captured.onClick!({ activeLabel: firstBucket }, {}));
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getAllByText(/as of /).length).toBeGreaterThan(0);
    expect(screen.queryByText('Click the chart to pin a date.')).not.toBeInTheDocument();
  });

  it('loan row: negative value, paydown-positive Δ, Δ% em-dash; est rows would badge', async () => {
    seedStores({ withLoan: true });
    renderChart('netWorth');
    await userEvent.click(screen.getByRole('button', { name: /Breakdown/ }));
    const table = screen.getByRole('table');
    const loanRow = within(table).getByText('Mortgage').closest('tr')!;
    expect(within(loanRow).getByText('−$350,000')).toBeInTheDocument();
    // loan delta: back-walked baseline (> 350k) − 350k → positive contribution, rendered with +
    expect(within(loanRow).getByText(/^\+\$/)).toBeInTheDocument();
    const cells = within(loanRow).getAllByRole('cell');
    // Δ% cell and Share cell are both em-dash for loans
    expect(cells.some((c) => c.textContent === '—')).toBe(true);
  });

  it('"Only" focuses one entity without touching the saved selection; chip restores', async () => {
    seedStores({ withLoan: true });
    renderChart('netWorth');
    await userEvent.click(screen.getByRole('button', { name: /Breakdown/ }));
    const savedBefore = localStorage.getItem('netWorthChart.selectedEntities');
    const schwabRow = within(screen.getByRole('table')).getByText('Schwab').closest('tr')!;
    await userEvent.click(within(schwabRow).getByRole('button', { name: /^Only/ }));
    expect(screen.getByRole('button', { name: /Included · 1 of 3/ })).toBeInTheDocument();
    // Header label = the focused entity's name. Selector adjusted from the
    // task's 'div *' (matches ANY div descendant — would also hit the
    // breakdown row's name cell) to 'div': only the header-label div has
    // 'Schwab' as its own text; the table name lives in a <td>.
    expect(screen.getByText('Schwab', { selector: 'div' })).toBeInTheDocument();
    expect(localStorage.getItem('netWorthChart.selectedEntities')).toBe(savedBefore);
    await userEvent.click(screen.getByRole('button', { name: 'Clear focus' }));
    expect(screen.getByRole('button', { name: /Included · 3 of 3/ })).toBeInTheDocument();
  });

  it('opening the picker exits the focus lens — popover always shows the saved selection', async () => {
    seedStores({ withLoan: true });
    renderChart('netWorth');
    await userEvent.click(screen.getByRole('button', { name: /Breakdown/ }));
    const schwabRow = within(screen.getByRole('table')).getByText('Schwab').closest('tr')!;
    await userEvent.click(within(schwabRow).getByRole('button', { name: /^Only/ }));
    // Lens active: chip present, picker count reads the 1-entity view.
    expect(screen.getByText('Only · Schwab', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Included · 1 of 3/ })).toBeInTheDocument();
    // Opening the picker drops the lens: checkboxes must reflect the SAVED
    // selection a toggle edits, never effectiveKeys (an unchecked-looking
    // box would otherwise silently REMOVE its entity from the saved set).
    await userEvent.click(screen.getByRole('button', { name: /Included · 1 of 3/ }));
    expect(screen.queryByRole('button', { name: 'Clear focus' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Included · 3 of 3/ })).toBeInTheDocument();
    const dialog = screen.getByRole('dialog', { name: /Included entities/ });
    const boxes = within(dialog).getAllByRole('checkbox');
    expect(boxes).toHaveLength(3);
    for (const box of boxes) expect(box).toBeChecked();
    await userEvent.click(within(dialog).getByLabelText('Mortgage'));
    expect(screen.getByRole('button', { name: /Included · 2 of 3/ })).toBeInTheDocument();
  });

  it('dashboard surface renders no breakdown toggle', () => {
    seedStores();
    renderChart('dashboard');
    expect(screen.queryByRole('button', { name: /Breakdown/ })).not.toBeInTheDocument();
  });

  it('zero-eligible dashboard shows Total assets label (CF3)', () => {
    seedEmptyStores();
    renderChart('dashboard');
    expect(screen.getByText('Total assets')).toBeInTheDocument();
  });
});

describe('AssetValueChart — investments surface', () => {
  function seedInvestmentStores() {
    usePersonsStore.setState({
      persons: [], isLoading: false, error: null, load: async () => {},
    } as never);
    useAccountsStore.setState({
      accounts: [
        mkAccount(1, 'Brokerage'),
        mkAccount(2, 'Everyday cash', { type: AccountType.ACCOUNT_CASH }),
        mkAccount(3, 'No snapshots yet'),
        mkAccount(4, 'Old excluded', { excludedFromNetWorth: true }),
      ],
      isLoading: false, error: null, load: async () => {},
    } as never);
    useSnapshotsStore.setState({
      snapshots: [
        mkSnapshot(1, 1, '2025-07-10', 90000),
        mkSnapshot(2, 1, '2026-06-05', 110000),
        mkSnapshot(3, 2, '2026-06-05', 5000),
        mkSnapshot(4, 4, '2026-06-05', 7777),
      ],
      isLoading: false, error: null, load: async () => {},
    } as never);
    usePropertiesStore.setState({ properties: [], isLoading: false, error: null, load: async () => {} } as never);
    useVehiclesStore.setState({ vehicles: [], isLoading: false, error: null, load: async () => {} } as never);
    useLoansStore.setState({ loans: [mkLoan(9, 'Mortgage')], isLoading: false, error: null, load: async () => {} } as never);
    useAssetValueSnapshotsStore.setState({ assetValueSnapshots: [], isLoading: false, error: null, load: async () => {} } as never);
  }

  it('eligibility parity: any account type with ≥1 snapshot; no-snapshot and excluded accounts are out', async () => {
    seedInvestmentStores();
    renderChart('investments');
    // Brokerage + cash → 2 of 2 (loan/property/vehicle never counted).
    await userEvent.click(screen.getByRole('button', { name: /Included · 2 of 2/ }));
    const dialog = screen.getByRole('dialog', { name: /Included entities/ });
    expect(within(dialog).getByLabelText('Brokerage')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Everyday cash')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('No snapshots yet')).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Old excluded')).not.toBeInTheDocument();
    // accountsOnly scope: no Loans/Properties/Vehicles section headings.
    expect(within(dialog).queryByText('Loans')).not.toBeInTheDocument();
    expect(within(dialog).queryByText('Properties')).not.toBeInTheDocument();
  });

  it('full selection reads "Total investments"; a partial pick reads the single account name', async () => {
    seedInvestmentStores();
    renderChart('investments');
    expect(screen.getByText('Total investments')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Included · 2 of 2/ }));
    await userEvent.click(
      within(screen.getByRole('dialog', { name: /Included entities/ })).getByLabelText('Everyday cash'),
    );
    // 1 of 2 selected → single-entity rule shows the account's own name.
    // Scoped to the header-label div: the still-open picker renders the
    // same string in its checkbox <label>.
    expect(screen.getByText('Brokerage', { selector: 'div' })).toBeInTheDocument();
  });

  it('persists to the investmentChart namespace', async () => {
    seedInvestmentStores();
    renderChart('investments');
    await userEvent.click(screen.getByRole('tab', { name: '6M' }));
    expect(localStorage.getItem('investmentChart.timeWindow')).toBe('6M');
    expect(localStorage.getItem('netWorthChart.timeWindow')).toBeNull();
  });

  it('migrates legacy investment-chart prefs on mount (selection + window carry over)', async () => {
    seedInvestmentStores();
    localStorage.setItem('investment-chart-selected-accounts', JSON.stringify([1]));
    localStorage.setItem('investment-chart-time-window', '5Y');
    renderChart('investments');
    // Migrated selection: only account 1 → single-entity label.
    expect(await screen.findByText('Brokerage')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Included · 1 of 2/ })).toBeInTheDocument();
    expect(localStorage.getItem('investment-chart-selected-accounts')).toBeNull();
    expect(localStorage.getItem('investmentChart.selectedEntities')).not.toBeNull();
  });

  it('renders the breakdown toggle and no "Net Worth →" link', () => {
    seedInvestmentStores();
    renderChart('investments');
    expect(screen.getByRole('button', { name: /Breakdown/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Net Worth/ })).not.toBeInTheDocument();
  });

  it('empty state: accounts-only copy with an Add-account CTA', () => {
    usePersonsStore.setState({ persons: [], isLoading: false, error: null, load: async () => {} } as never);
    useAccountsStore.setState({ accounts: [], isLoading: false, error: null, load: async () => {} } as never);
    useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null, load: async () => {} } as never);
    usePropertiesStore.setState({ properties: [], isLoading: false, error: null, load: async () => {} } as never);
    useVehiclesStore.setState({ vehicles: [], isLoading: false, error: null, load: async () => {} } as never);
    useLoansStore.setState({ loans: [], isLoading: false, error: null, load: async () => {} } as never);
    useAssetValueSnapshotsStore.setState({ assetValueSnapshots: [], isLoading: false, error: null, load: async () => {} } as never);
    renderChart('investments');
    expect(screen.getByText(/balance snapshots/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Add an account/ })).toHaveAttribute('href', '/inputs/accounts');
    // Zero-eligible label fallback is the surface's full-set label.
    expect(screen.getByText('Total investments')).toBeInTheDocument();
  });

  it('respects the ?view person filter (parity with the old chart) and drops the "· Household" suffix', async () => {
    seedInvestmentStores();
    usePersonsStore.setState({
      persons: [
        { id: 1, householdId: 1, name: 'Alice' },
        { id: 2, householdId: 1, name: 'Bob' },
      ],
      isLoading: false, error: null, load: async () => {},
    } as never);
    useAccountsStore.setState({
      accounts: [
        mkAccount(1, 'Alice Brokerage', { ownerPersonId: 1 }),
        mkAccount(2, 'Bob Brokerage', { ownerPersonId: 2 }),
      ],
      isLoading: false, error: null, load: async () => {},
    } as never);
    useSnapshotsStore.setState({
      snapshots: [
        mkSnapshot(1, 1, '2026-06-05', 50000),
        mkSnapshot(2, 2, '2026-06-05', 200000),
      ],
      isLoading: false, error: null, load: async () => {},
    } as never);
    render(
      <MemoryRouter initialEntries={['/?view=p1']}>
        <AssetValueChart surface="investments" />
      </MemoryRouter>,
    );
    // Only Alice's account is eligible under ?view=p1 → 1 of 1, and the
    // single-entity label is her account's own name (never "· Household").
    expect(screen.queryByText(/· Household/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Included · 1 of 1/ }));
    const dialog = screen.getByRole('dialog', { name: /Included entities/ });
    expect(within(dialog).getByLabelText('Alice Brokerage')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Bob Brokerage')).not.toBeInTheDocument();
  });
});
