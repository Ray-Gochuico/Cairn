import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  describe('entity picker', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    function seedThreeAssets() {
      useAccountsStore.setState({
        accounts: [mkAccount(1, 'Brokerage'), mkAccount(2, 'Roth IRA')],
        isLoading: false,
        error: null,
      });
      useSnapshotsStore.setState({
        snapshots: [
          mkSnapshot(1, 1, '2026-04-01', 6000),
          mkSnapshot(2, 2, '2026-04-01', 3400),
        ],
        isLoading: false,
        error: null,
      });
      usePropertiesStore.setState({
        properties: [mkProperty(10, 'Home', { currentEstimatedValue: 500000 })],
        isLoading: false,
        error: null,
      });
    }

    it('renders an Entities picker button with the count of visible entities', () => {
      seedThreeAssets();
      render(<AssetsDonut />);
      expect(
        screen.getByRole('button', { name: /Included · 3 of 3/ }),
      ).toBeInTheDocument();
    });

    it('each slice carries a resolved color (not empty)', () => {
      seedThreeAssets();
      render(<AssetsDonut />);
      for (const name of ['Brokerage', 'Roth IRA', 'Home']) {
        expect(
          screen.getByTestId(`slice-${name}`).getAttribute('data-color'),
          name,
        ).toMatch(/^#[0-9a-f]{6}$/i);
      }
    });

    it('a kept slice keeps its color after another entity is hidden (no legend desync)', async () => {
      seedThreeAssets();
      render(<AssetsDonut />);
      // Home is the LAST entity in insertion order; hiding the FIRST entity
      // (Brokerage) would reindex Home under the old positional fallback.
      const before = screen.getByTestId('slice-Home').getAttribute('data-color');
      expect(before).toMatch(/^#[0-9a-f]{6}$/i);
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /Included ·/ }));
      await user.click(screen.getByRole('checkbox', { name: /Brokerage/ }));
      expect(screen.queryByTestId('slice-Brokerage')).not.toBeInTheDocument();
      expect(screen.getByTestId('slice-Home').getAttribute('data-color')).toBe(before);
    });

    it('honors a per-account accent override on the wedge color', () => {
      useAccountsStore.setState({
        accounts: [
          mkAccount(1, 'Brokerage', { accentColor: '#123456' }),
          mkAccount(2, 'Roth IRA'),
        ],
        isLoading: false,
        error: null,
      });
      useSnapshotsStore.setState({
        snapshots: [
          mkSnapshot(1, 1, '2026-04-01', 6000),
          mkSnapshot(2, 2, '2026-04-01', 3400),
        ],
        isLoading: false,
        error: null,
      });
      render(<AssetsDonut />);
      expect(screen.getByTestId('slice-Brokerage').getAttribute('data-color')).toBe('#123456');
    });

    it('share % stays anchored to the full asset universe when an entity is hidden', async () => {
      // Brokerage 6000, Roth IRA 3400, Home 500000 → full total 509400.
      // Hide Roth IRA: Brokerage's legend share must still read 1.2%
      // (6000/509400), NOT 6000/506000 ≈ 1.2%… use Home instead for a
      // discriminating number: Home stays 98.2% (500000/509400), NOT 98.8%.
      seedThreeAssets();
      render(<AssetsDonut />);
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /Included ·/ }));
      await user.click(screen.getByRole('checkbox', { name: /Roth IRA/ }));
      expect(screen.getByText(/\$500,000 · 98\.2%/)).toBeInTheDocument();
      expect(screen.queryByText(/98\.8%/)).not.toBeInTheDocument();
    });

    it('picker lives in the card header, not an absolute overlay', () => {
      seedThreeAssets();
      render(<AssetsDonut />);
      const trigger = screen.getByRole('button', { name: /Included ·/ });
      expect(trigger.closest('[class*="absolute"]')).toBeNull();
    });

    it('hiding an entity removes its slice from the donut', async () => {
      seedThreeAssets();
      render(<AssetsDonut />);
      // All three slices present at start.
      expect(screen.getByTestId('slice-Brokerage')).toBeInTheDocument();
      expect(screen.getByTestId('slice-Roth IRA')).toBeInTheDocument();
      expect(screen.getByTestId('slice-Home')).toBeInTheDocument();

      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /Included ·/ }));
      await user.click(screen.getByRole('checkbox', { name: /Roth IRA/ }));

      expect(screen.queryByTestId('slice-Roth IRA')).not.toBeInTheDocument();
      expect(screen.getByTestId('slice-Brokerage')).toBeInTheDocument();
      expect(screen.getByTestId('slice-Home')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /Included · 2 of 3/ }),
      ).toBeInTheDocument();
    });

    it('persists hidden selection across remount', async () => {
      seedThreeAssets();
      const { unmount } = render(<AssetsDonut />);
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /Included ·/ }));
      await user.click(screen.getByRole('checkbox', { name: /Roth IRA/ }));
      expect(screen.queryByTestId('slice-Roth IRA')).not.toBeInTheDocument();
      unmount();

      render(<AssetsDonut />);
      expect(screen.queryByTestId('slice-Roth IRA')).not.toBeInTheDocument();
      expect(screen.getByTestId('slice-Brokerage')).toBeInTheDocument();
      expect(screen.getByTestId('slice-Home')).toBeInTheDocument();
    });

    it('shows the all-hidden message when every entity is hidden', async () => {
      seedThreeAssets();
      render(<AssetsDonut />);
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /Included ·/ }));
      await user.click(screen.getByRole('button', { name: /hide all/i }));
      expect(screen.getByText(/all entities hidden/i)).toBeInTheDocument();
      // Picker button still visible so the user can recover.
      expect(
        screen.getByRole('button', { name: /Included · 0 of 3/ }),
      ).toBeInTheDocument();
    });
  });
});
