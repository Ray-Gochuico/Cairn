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
import { AccountType, LoanType, SnapshotSource } from '@/types/enums';
import type { Account, AccountSnapshot, Loan } from '@/types/schema';

// Captured chart-level handlers — Task 11's scrub/pin tests drive these
// directly (recharts renders nothing in jsdom; mock pattern extends the
// old NetWorthTimeSeriesChart.test mock).
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
        {children}
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
    <div data-testid="end-dot" data-x={x} data-y={y} />
  ),
}));

import AssetValueChart from '@/components/charts/AssetValueChart';

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

function renderChart(surface: 'netWorth' | 'dashboard') {
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
    const tabs = screen.getByRole('tablist');
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
