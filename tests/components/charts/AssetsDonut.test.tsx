import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import { AccountType, PropertyType, SnapshotSource } from '@/types/enums';
import type {
  Account,
  AccountSnapshot,
  AssetValueSnapshot,
  Property,
  Vehicle,
} from '@/types/schema';

// Recharts in jsdom doesn't render real wedges; mock the Pie so we can
// assert on slice contents. Mirrors DonutChartCard.test.tsx + SectorDonut.test.tsx.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="rc-responsive">{children}</div>
  ),
  PieChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="rc-piechart">{children}</div>
  ),
  Pie: ({
    data,
    children,
  }: {
    data: Array<{ name: string; value: number; color?: string }>;
    children?: React.ReactNode;
  }) => (
    <div data-testid="rc-pie">
      {data.map((d) => (
        <span
          key={d.name}
          data-testid={`slice-${d.name}`}
          data-value={d.value}
          data-color={d.color ?? ''}
        >
          {d.name}:{d.value}
        </span>
      ))}
      {children}
    </div>
  ),
  Cell: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

import AssetsDonut from '@/components/charts/AssetsDonut';

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

function resetStores() {
  useAccountsStore.setState({ accounts: [], isLoading: false, error: null });
  useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null });
  usePropertiesStore.setState({ properties: [], isLoading: false, error: null });
  useVehiclesStore.setState({ vehicles: [], isLoading: false, error: null });
  useAssetValueSnapshotsStore.setState({
    assetValueSnapshots: [],
    isLoading: false,
    error: null,
  });
}

describe('AssetsDonut', () => {
  beforeEach(() => {
    resetStores();
  });

  it('renders the card title', () => {
    render(<AssetsDonut />);
    expect(screen.getByText('Assets')).toBeInTheDocument();
  });

  it('renders one slice per asset entity using latest values', () => {
    useAccountsStore.setState({
      accounts: [
        mkAccount(1, 'Brokerage'),
        mkAccount(2, 'Roth IRA'),
      ],
      isLoading: false,
      error: null,
    });
    useSnapshotsStore.setState({
      snapshots: [
        mkSnapshot(1, 1, '2026-01-15', 5000),
        mkSnapshot(2, 1, '2026-03-15', 6000),
        mkSnapshot(3, 2, '2026-03-15', 3400),
      ],
      isLoading: false,
      error: null,
    });
    usePropertiesStore.setState({
      properties: [mkProperty(10, 'Home', { currentEstimatedValue: 500000 })],
      isLoading: false,
      error: null,
    });
    useVehiclesStore.setState({
      vehicles: [mkVehicle(20, 'Camry', { currentEstimatedValue: 22000 })],
      isLoading: false,
      error: null,
    });

    render(<AssetsDonut />);

    // Latest snapshot for account 1 = 6000, for account 2 = 3400.
    expect(screen.getByTestId('slice-Brokerage')).toHaveAttribute('data-value', '6000');
    expect(screen.getByTestId('slice-Roth IRA')).toHaveAttribute('data-value', '3400');
    expect(screen.getByTestId('slice-Home')).toHaveAttribute('data-value', '500000');
    expect(screen.getByTestId('slice-Camry')).toHaveAttribute('data-value', '22000');
  });

  it('uses the latest asset_value_snapshot for properties/vehicles when present', () => {
    usePropertiesStore.setState({
      properties: [mkProperty(10, 'Home', { currentEstimatedValue: 500000 })],
      isLoading: false,
      error: null,
    });
    const assetSnaps: AssetValueSnapshot[] = [
      { id: 1, ownerType: 'PROPERTY', ownerId: 10, snapshotDate: '2026-01-15', value: 510000 },
      { id: 2, ownerType: 'PROPERTY', ownerId: 10, snapshotDate: '2026-04-10', value: 525000 },
    ];
    useAssetValueSnapshotsStore.setState({
      assetValueSnapshots: assetSnaps,
      isLoading: false,
      error: null,
    });

    render(<AssetsDonut />);

    expect(screen.getByTestId('slice-Home')).toHaveAttribute('data-value', '525000');
  });

  it('falls back to currentEstimatedValue when no asset_value_snapshot exists', () => {
    usePropertiesStore.setState({
      properties: [mkProperty(10, 'Home', { currentEstimatedValue: 400000 })],
      isLoading: false,
      error: null,
    });
    useVehiclesStore.setState({
      vehicles: [mkVehicle(20, 'Camry', { currentEstimatedValue: 22000 })],
      isLoading: false,
      error: null,
    });

    render(<AssetsDonut />);

    expect(screen.getByTestId('slice-Home')).toHaveAttribute('data-value', '400000');
    expect(screen.getByTestId('slice-Camry')).toHaveAttribute('data-value', '22000');
  });

  it('excludes properties and vehicles marked excludedFromNetWorth', () => {
    usePropertiesStore.setState({
      properties: [
        mkProperty(10, 'Home', { currentEstimatedValue: 400000 }),
        mkProperty(11, 'Rental', {
          currentEstimatedValue: 300000,
          excludedFromNetWorth: true,
        }),
      ],
      isLoading: false,
      error: null,
    });
    useVehiclesStore.setState({
      vehicles: [
        mkVehicle(20, 'Camry'),
        mkVehicle(21, 'Beater', {
          currentEstimatedValue: 2000,
          excludedFromNetWorth: true,
        }),
      ],
      isLoading: false,
      error: null,
    });

    render(<AssetsDonut />);

    expect(screen.queryByTestId('slice-Home')).toBeInTheDocument();
    expect(screen.queryByTestId('slice-Camry')).toBeInTheDocument();
    expect(screen.queryByTestId('slice-Rental')).not.toBeInTheDocument();
    expect(screen.queryByTestId('slice-Beater')).not.toBeInTheDocument();
  });

  it('skips entities whose latest value is <= 0', () => {
    useAccountsStore.setState({
      accounts: [
        mkAccount(1, 'Brokerage'),
        // No snapshot at all -> latest value = 0 -> skip.
        mkAccount(2, 'No snapshots'),
      ],
      isLoading: false,
      error: null,
    });
    useSnapshotsStore.setState({
      snapshots: [mkSnapshot(1, 1, '2026-03-15', 6000)],
      isLoading: false,
      error: null,
    });
    usePropertiesStore.setState({
      // null currentEstimatedValue and no snapshots -> skip.
      properties: [mkProperty(10, 'Unvalued', { currentEstimatedValue: null })],
      isLoading: false,
      error: null,
    });

    render(<AssetsDonut />);

    expect(screen.queryByTestId('slice-Brokerage')).toBeInTheDocument();
    expect(screen.queryByTestId('slice-No snapshots')).not.toBeInTheDocument();
    expect(screen.queryByTestId('slice-Unvalued')).not.toBeInTheDocument();
  });

  it('shows an empty-state hint when no entities to chart', () => {
    render(<AssetsDonut />);
    expect(screen.getByText(/no assets recorded/i)).toBeInTheDocument();
  });
});
