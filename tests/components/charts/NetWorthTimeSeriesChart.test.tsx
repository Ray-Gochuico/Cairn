import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { useLoansStore } from '@/stores/loans-store';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import {
  AccountType,
  LoanType,
  PropertyType,
  SnapshotSource,
} from '@/types/enums';
import { entityKey } from '@/lib/entity-key';
import {
  getGranularity,
  getSelectedEntities,
  getTimeWindow,
  setSelectedEntities,
} from '@/lib/net-worth-chart-prefs';
import type {
  Account,
  AccountSnapshot,
  Loan,
  Property,
  Vehicle,
} from '@/types/schema';

// Recharts in jsdom doesn't compose meaningful SVG — mock the
// ComposedChart trio so we can assert via DOM `data-*` attributes the
// chart-data wiring works end-to-end.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="rc-responsive">{children}</div>
  ),
  ComposedChart: ({
    data,
    children,
  }: {
    data: Array<Record<string, number | string>>;
    children: React.ReactNode;
  }) => (
    <div data-testid="rc-composed" data-bucket-count={data.length}>
      <pre data-testid="rc-data">{JSON.stringify(data)}</pre>
      {children}
    </div>
  ),
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  ReferenceLine: () => null,
  Tooltip: () => null,
  Legend: () => null,
  Bar: ({ dataKey, stackId }: { dataKey: string; stackId?: string }) => (
    <div data-testid={`bar-${dataKey}`} data-stack={stackId ?? ''} />
  ),
  Line: ({ dataKey }: { dataKey: string }) => (
    <div data-testid={`line-${dataKey}`} />
  ),
}));

import NetWorthTimeSeriesChart from '@/components/charts/NetWorthTimeSeriesChart';

function mkAccount(
  id: number,
  name: string,
  overrides: Partial<Account> = {},
): Account {
  return {
    id,
    householdId: 1,
    ownerPersonId: null,
    beneficiaryDependentId: null,
    name,
    institution: null,
    type: AccountType.ACCOUNT_BROKERAGE,
    cryptoWalletAddress: null,
    autoFetchEnabled: false,
    excludedFromNetWorth: false,
    allowMargin: false,
    stateOfPlan: null,
    accentColor: null,
    hasEmployerMatch: null,
    employerMatchPct: null,
    employerMatchLimitPct: null,
    allowsMegaBackdoorRollover: null,
    hasHighFees: null,
    apyRate: null,
    ...overrides,
  };
}

function mkSnapshot(
  id: number,
  accountId: number,
  date: string,
  value: number,
): AccountSnapshot {
  return {
    id,
    accountId,
    snapshotDate: date,
    totalValue: value,
    source: SnapshotSource.MANUAL,
  };
}

function mkProperty(
  id: number,
  name: string,
  overrides: Partial<Property> = {},
): Property {
  return {
    id,
    householdId: 1,
    ownerPersonId: null,
    name,
    type: PropertyType.PRIMARY_RESIDENCE,
    address: null,
    purchaseDate: null,
    purchasePrice: null,
    currentEstimatedValue: 400000,
    linkedLoanId: null,
    excludedFromNetWorth: false,
    ...overrides,
  };
}

function mkVehicle(
  id: number,
  name: string,
  overrides: Partial<Vehicle> = {},
): Vehicle {
  return {
    id,
    householdId: 1,
    ownerPersonId: null,
    name,
    year: 2020,
    make: 'Toyota',
    model: 'Camry',
    purchaseDate: null,
    purchasePrice: null,
    currentEstimatedValue: 22000,
    linkedLoanId: null,
    excludedFromNetWorth: false,
    ...overrides,
  };
}

function mkLoan(
  id: number,
  name: string,
  overrides: Partial<Loan> = {},
): Loan {
  return {
    id,
    householdId: 1,
    obligorPersonId: null,
    name,
    type: LoanType.MORTGAGE,
    originalAmount: 400000,
    currentBalance: 350000,
    interestRate: 0.04,
    termMonths: 360,
    firstPaymentDate: '2024-01-01',
    monthlyPayment: 1909.66,
    extraPaymentDefault: 0,
    linkedPropertyId: null,
    linkedVehicleId: null,
    ...overrides,
  };
}

function resetStores() {
  useAccountsStore.setState({ accounts: [], isLoading: false, error: null });
  useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null });
  usePropertiesStore.setState({ properties: [], isLoading: false, error: null });
  useVehiclesStore.setState({ vehicles: [], isLoading: false, error: null });
  useLoansStore.setState({ loans: [], isLoading: false, error: null });
  useAssetValueSnapshotsStore.setState({
    assetValueSnapshots: [],
    isLoading: false,
    error: null,
  });
  localStorage.clear();
}

function readChartData(): Array<Record<string, number | string>> {
  const el = screen.queryByTestId('rc-data');
  if (!el) return [];
  return JSON.parse(el.textContent ?? '[]');
}

describe('NetWorthTimeSeriesChart (component)', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders the title and Granularity / Window controls', () => {
    render(<NetWorthTimeSeriesChart />);
    // Title is the exact card title — empty-state copy also contains
    // "net worth over time" so use an exact-string match.
    expect(screen.getByText('Net Worth Over Time')).toBeInTheDocument();
    expect(screen.getByLabelText(/granularity/i)).toHaveValue('MONTH');
    expect(screen.getByLabelText(/window/i)).toHaveValue('ALL');
  });

  it('changes granularity and persists it to localStorage', async () => {
    const user = userEvent.setup();
    render(<NetWorthTimeSeriesChart />);
    const select = screen.getByLabelText(/granularity/i);
    await user.selectOptions(select, 'QUARTER');
    expect(getGranularity()).toBe('QUARTER');
    expect(select).toHaveValue('QUARTER');
  });

  it('changes time window and persists it to localStorage', async () => {
    const user = userEvent.setup();
    render(<NetWorthTimeSeriesChart />);
    const select = screen.getByLabelText(/window/i);
    await user.selectOptions(select, '1Y');
    expect(getTimeWindow()).toBe('1Y');
    expect(select).toHaveValue('1Y');
  });

  it('grouped picker shows Accounts, Properties, Vehicles, Loans sections', async () => {
    useAccountsStore.setState({
      accounts: [mkAccount(1, 'Brokerage')],
      isLoading: false,
      error: null,
    });
    useSnapshotsStore.setState({
      snapshots: [mkSnapshot(1, 1, '2026-03-15', 5000)],
      isLoading: false,
      error: null,
    });
    usePropertiesStore.setState({
      properties: [mkProperty(10, 'Home')],
      isLoading: false,
      error: null,
    });
    useVehiclesStore.setState({
      vehicles: [mkVehicle(20, 'Camry')],
      isLoading: false,
      error: null,
    });
    useLoansStore.setState({
      loans: [mkLoan(30, 'Mortgage')],
      isLoading: false,
      error: null,
    });
    const user = userEvent.setup();
    render(<NetWorthTimeSeriesChart />);

    await user.click(screen.getByRole('button', { name: /entities/i }));
    const picker = screen.getByRole('dialog', { name: /select entities/i });

    expect(within(picker).getByText(/accounts/i)).toBeInTheDocument();
    expect(within(picker).getByText(/^properties$/i)).toBeInTheDocument();
    expect(within(picker).getByText(/^vehicles$/i)).toBeInTheDocument();
    expect(within(picker).getByText(/^loans$/i)).toBeInTheDocument();

    // Each entity name appears as a labelled checkbox.
    expect(within(picker).getByLabelText(/brokerage/i)).toBeInTheDocument();
    expect(within(picker).getByLabelText(/home/i)).toBeInTheDocument();
    expect(within(picker).getByLabelText(/camry/i)).toBeInTheDocument();
    expect(within(picker).getByLabelText(/mortgage/i)).toBeInTheDocument();
  });

  it('persists selection via localStorage when an entity is toggled', async () => {
    useAccountsStore.setState({
      accounts: [mkAccount(1, 'Brokerage')],
      isLoading: false,
      error: null,
    });
    useSnapshotsStore.setState({
      snapshots: [mkSnapshot(1, 1, '2026-03-15', 5000)],
      isLoading: false,
      error: null,
    });
    useLoansStore.setState({
      loans: [mkLoan(30, 'Mortgage')],
      isLoading: false,
      error: null,
    });

    const user = userEvent.setup();
    render(<NetWorthTimeSeriesChart />);

    await user.click(screen.getByRole('button', { name: /entities/i }));
    const picker = screen.getByRole('dialog', { name: /select entities/i });

    // Brokerage is default-selected; uncheck it.
    await user.click(within(picker).getByLabelText(/brokerage/i));

    const persisted = getSelectedEntities();
    expect(persisted).not.toBeNull();
    expect(persisted!.some((e) => e.kind === 'account' && e.id === 1)).toBe(
      false,
    );
  });

  it('rehydrates selection from localStorage on mount', () => {
    setSelectedEntities([{ kind: 'account', id: 1 }]);
    useAccountsStore.setState({
      accounts: [mkAccount(1, 'Brokerage'), mkAccount(2, 'Roth')],
      isLoading: false,
      error: null,
    });
    useSnapshotsStore.setState({
      snapshots: [
        mkSnapshot(1, 1, '2026-03-15', 5000),
        mkSnapshot(2, 2, '2026-03-15', 4000),
      ],
      isLoading: false,
      error: null,
    });
    render(<NetWorthTimeSeriesChart />);
    // chart data should show only account 1's value at the latest bucket.
    const data = readChartData();
    expect(data.length).toBeGreaterThan(0);
    const last = data[data.length - 1];
    expect(last[entityKey('account', 1)]).toBe(5000);
    expect(last[entityKey('account', 2)]).toBeUndefined();
  });

  it('renders empty-state when nothing is selected', async () => {
    useAccountsStore.setState({
      accounts: [mkAccount(1, 'Brokerage')],
      isLoading: false,
      error: null,
    });
    useSnapshotsStore.setState({
      snapshots: [mkSnapshot(1, 1, '2026-03-15', 5000)],
      isLoading: false,
      error: null,
    });

    const user = userEvent.setup();
    render(<NetWorthTimeSeriesChart />);

    await user.click(screen.getByRole('button', { name: /entities/i }));
    const picker = screen.getByRole('dialog', { name: /select entities/i });
    // Uncheck Brokerage (the only eligible default selection).
    await user.click(within(picker).getByLabelText(/brokerage/i));

    expect(
      screen.getByText(/select at least one account, property, vehicle, or loan/i),
    ).toBeInTheDocument();
  });

  it('renders empty-state when there are no eligible entities at all', () => {
    render(<NetWorthTimeSeriesChart />);
    expect(
      screen.getByText(/add an account, property, vehicle, or loan/i),
    ).toBeInTheDocument();
  });

  it('renders a Bar per asset (positive stack) and Bar per loan (negative stack), plus a netWorth Line', async () => {
    useAccountsStore.setState({
      accounts: [mkAccount(1, 'Brokerage')],
      isLoading: false,
      error: null,
    });
    useSnapshotsStore.setState({
      snapshots: [mkSnapshot(1, 1, '2026-03-15', 5000)],
      isLoading: false,
      error: null,
    });
    useLoansStore.setState({
      loans: [mkLoan(30, 'Mortgage')],
      isLoading: false,
      error: null,
    });

    setSelectedEntities([
      { kind: 'account', id: 1 },
      { kind: 'loan', id: 30 },
    ]);

    render(<NetWorthTimeSeriesChart />);

    expect(screen.getByTestId(`bar-${entityKey('account', 1)}`)).toHaveAttribute(
      'data-stack',
      'assets',
    );
    expect(screen.getByTestId(`bar-${entityKey('loan', 30)}`)).toHaveAttribute(
      'data-stack',
      'liabilities',
    );
    expect(screen.getByTestId('line-netWorth')).toBeInTheDocument();
  });
});
