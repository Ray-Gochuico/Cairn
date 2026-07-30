import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AssetsDonut from '@/components/charts/AssetsDonut';
import LiabilitiesDonut from '@/components/charts/LiabilitiesDonut';
import { usePersonsStore } from '@/stores/persons-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import { useLoansStore } from '@/stores/loans-store';
import { AccountType, SnapshotSource } from '@/types/enums';

// Wave A D4 (supersedes W10 T7 for these two donuts): AssetsDonut /
// LiabilitiesDonut are GENUINELY FILTERED by the person view now — every
// input entity is ownable. The '· Household' title suffix is gone because
// the data is scoped; a filtered-to-empty donut names the hidden counts
// (C27). PerTickerDonut/SectorDonut (protected views) keep their
// household-wide data + suffix — deliberately untouched by Wave A (the
// wave gate diffs them as receipts); their unit suites carry no suffix pin.
function seedTwoPersons() {
  const noop = async () => {};
  usePersonsStore.setState({
    persons: [{ id: 1, name: 'Alice' } as never, { id: 2, name: 'Bob' } as never],
    isLoading: false, error: null, load: noop,
  } as never);
  useAccountsStore.setState({ accounts: [], isLoading: false, error: null, load: noop } as never);
  useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null, load: noop } as never);
  usePropertiesStore.setState({ properties: [], isLoading: false, error: null, load: noop } as never);
  useVehiclesStore.setState({ vehicles: [], isLoading: false, error: null, load: noop } as never);
  useAssetValueSnapshotsStore.setState({ assetValueSnapshots: [], isLoading: false, error: null, load: noop } as never);
  useLoansStore.setState({ loans: [], isLoading: false, error: null, load: noop } as never);
}

function account(id: number, name: string, ownerPersonId: number | null) {
  return {
    id, householdId: 1, ownerPersonId, beneficiaryDependentId: null, name,
    institution: null, type: AccountType.ACCOUNT_BROKERAGE, cryptoWalletAddress: null,
    autoFetchEnabled: false, excludedFromNetWorth: false, stateOfPlan: null, accentColor: null,
  };
}

function snapshot(id: number, accountId: number, totalValue: number) {
  return { id, accountId, snapshotDate: '2024-06-28', totalValue, source: SnapshotSource.MANUAL };
}

function loan(id: number, name: string, obligorPersonId: number | null, currentBalance = 10_000) {
  return {
    id, householdId: 1, obligorPersonId, name, type: 'MORTGAGE', originalAmount: currentBalance + 1,
    currentBalance, interestRate: 0.05, termMonths: 360, firstPaymentDate: '2020-01-01',
    monthlyPayment: 100, extraPaymentDefault: 0, linkedPropertyId: null, linkedVehicleId: null,
  };
}

function jointProperty(id: number, name: string, value: number) {
  return {
    id, householdId: 1, ownerPersonId: null, name, type: 'PRIMARY_RESIDENCE', address: null,
    purchaseDate: null, purchasePrice: null, currentEstimatedValue: value,
    linkedLoanId: null, excludedFromNetWorth: false,
  };
}

describe('Wave A D4: Assets/Liabilities donuts genuinely filter', () => {
  beforeEach(seedTwoPersons);

  it('AssetsDonut filters to the selected owner and drops the · Household suffix', () => {
    useAccountsStore.setState({
      accounts: [account(1, 'Alice Brokerage', 1), account(2, 'Bob Brokerage', 2)],
      isLoading: false, error: null, load: async () => {},
    } as never);
    useSnapshotsStore.setState({
      snapshots: [snapshot(1, 1, 50_000), snapshot(2, 2, 70_000)],
      isLoading: false, error: null, load: async () => {},
    } as never);
    usePropertiesStore.setState({
      properties: [jointProperty(1, 'Home', 500_000)],
      isLoading: false, error: null, load: async () => {},
    } as never);
    render(<MemoryRouter initialEntries={['/net-worth?view=p1']}><AssetsDonut /></MemoryRouter>);
    expect(screen.getByText('Assets')).toBeInTheDocument(); // no suffix — genuinely scoped now
    expect(screen.queryByText('Assets · Household')).not.toBeInTheDocument();
    // Slice set: Alice's account only — Bob's account and the joint home are out.
    expect(screen.queryByText('Bob Brokerage')).not.toBeInTheDocument();
    expect(screen.queryByText('Home')).not.toBeInTheDocument();
  });

  it('C27: filtered-empty AssetsDonut names the hidden count', () => {
    useAccountsStore.setState({
      accounts: [account(2, 'Bob Brokerage', 2)],
      isLoading: false, error: null, load: async () => {},
    } as never);
    useSnapshotsStore.setState({
      snapshots: [snapshot(1, 2, 70_000)],
      isLoading: false, error: null, load: async () => {},
    } as never);
    usePropertiesStore.setState({
      properties: [jointProperty(1, 'Home', 500_000)],
      isLoading: false, error: null, load: async () => {},
    } as never);
    render(<MemoryRouter initialEntries={['/net-worth?view=p1']}><AssetsDonut /></MemoryRouter>);
    expect(
      screen.getByText("No assets in Alice's name — 2 household items not shown."),
    ).toBeInTheDocument();
    expect(screen.queryByText('No assets recorded yet.')).not.toBeInTheDocument();
  });

  it('C27 joint grammar: AssetsDonut joint-empty names individually owned', () => {
    useAccountsStore.setState({
      accounts: [account(1, 'Alice Brokerage', 1)],
      isLoading: false, error: null, load: async () => {},
    } as never);
    useSnapshotsStore.setState({
      snapshots: [snapshot(1, 1, 50_000)],
      isLoading: false, error: null, load: async () => {},
    } as never);
    render(<MemoryRouter initialEntries={['/net-worth?view=joint']}><AssetsDonut /></MemoryRouter>);
    expect(
      screen.getByText('No joint assets — 1 individually owned not shown.'),
    ).toBeInTheDocument();
  });

  it('AssetsDonut true-empty keeps the plain empty copy in any view', () => {
    render(<MemoryRouter initialEntries={['/net-worth?view=p1']}><AssetsDonut /></MemoryRouter>);
    expect(screen.getByText('No assets recorded yet.')).toBeInTheDocument();
  });

  it('LiabilitiesDonut filters to the selected obligor and drops the suffix', () => {
    useLoansStore.setState({
      loans: [loan(1, 'Alice Car', 1), loan(2, 'Joint Mortgage', null)],
      isLoading: false, error: null, load: async () => {},
    } as never);
    render(<MemoryRouter initialEntries={['/net-worth?view=p1']}><LiabilitiesDonut /></MemoryRouter>);
    expect(screen.getByText('Liabilities')).toBeInTheDocument();
    expect(screen.queryByText('Liabilities · Household')).not.toBeInTheDocument();
    expect(screen.queryByText('Joint Mortgage')).not.toBeInTheDocument();
  });

  it('C27: filtered-empty LiabilitiesDonut names the hidden loan count', () => {
    useLoansStore.setState({
      loans: [loan(1, 'Joint Mortgage', null), loan(2, 'Bob Car', 2)],
      isLoading: false, error: null, load: async () => {},
    } as never);
    render(<MemoryRouter initialEntries={['/net-worth?view=p1']}><LiabilitiesDonut /></MemoryRouter>);
    expect(
      screen.getByText("No loans in Alice's name — 2 household loans not shown."),
    ).toBeInTheDocument();
    expect(screen.queryByText('No loans recorded yet.')).not.toBeInTheDocument();
  });

  it('LiabilitiesDonut true-empty keeps the plain empty copy in any view', () => {
    render(<MemoryRouter initialEntries={['/net-worth?view=p1']}><LiabilitiesDonut /></MemoryRouter>);
    expect(screen.getByText('No loans recorded yet.')).toBeInTheDocument();
  });
});
