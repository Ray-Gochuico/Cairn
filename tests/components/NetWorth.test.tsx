import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { useLoansStore } from '@/stores/loans-store';
import { AccountsRepo } from '@/domain/accounts';
import { AccountSnapshotsRepo } from '@/domain/snapshots';
import { PropertiesRepo } from '@/domain/properties';
import { VehiclesRepo } from '@/domain/vehicles';
import { LoansRepo } from '@/domain/loans';
import {
  AccountType,
  LoanType,
  PropertyType,
  SnapshotSource,
} from '@/types/enums';
import NetWorth from '@/pages/NetWorth';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadInitialMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');

function resetStores() {
  useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null });
  usePropertiesStore.setState({ properties: [], isLoading: false, error: null });
  useVehiclesStore.setState({ vehicles: [], isLoading: false, error: null });
  useLoansStore.setState({ loans: [], isLoading: false, error: null });
}

async function seedAccount(db: SqliteAdapter, name: string): Promise<number> {
  const repo = new AccountsRepo(db);
  return repo.create({
    householdId: 1,
    ownerPersonId: null,
    beneficiaryDependentId: null,
    name,
    institution: null,
    type: AccountType.ACCOUNT_BROKERAGE,
    cryptoWalletAddress: null,
    autoFetchEnabled: false,
    excludedFromNetWorth: false,
    stateOfPlan: null,
  });
}

async function seedSnapshot(
  db: SqliteAdapter,
  accountId: number,
  snapshotDate: string,
  totalValue: number,
): Promise<void> {
  const repo = new AccountSnapshotsRepo(db);
  await repo.upsert({
    accountId,
    snapshotDate,
    totalValue,
    source: SnapshotSource.USER_CONFIRMED,
  });
}

async function seedProperty(db: SqliteAdapter, value: number): Promise<void> {
  const repo = new PropertiesRepo(db);
  await repo.create({
    householdId: 1,
    ownerPersonId: null,
    name: 'Primary',
    type: PropertyType.PRIMARY_RESIDENCE,
    address: null,
    purchaseDate: null,
    purchasePrice: null,
    currentEstimatedValue: value,
    linkedLoanId: null,
    excludedFromNetWorth: false,
  });
}

async function seedVehicle(db: SqliteAdapter, value: number): Promise<void> {
  const repo = new VehiclesRepo(db);
  await repo.create({
    householdId: 1,
    ownerPersonId: null,
    name: 'Car',
    year: 2020,
    make: 'Toyota',
    model: 'Camry',
    purchaseDate: null,
    purchasePrice: null,
    currentEstimatedValue: value,
    linkedLoanId: null,
    excludedFromNetWorth: false,
  });
}

async function seedLoan(
  db: SqliteAdapter,
  type: LoanType,
  currentBalance: number,
): Promise<void> {
  const repo = new LoansRepo(db);
  await repo.create({
    householdId: 1,
    obligorPersonId: null,
    name: `${type} loan`,
    type,
    originalAmount: currentBalance + 50000,
    currentBalance,
    interestRate: 0.05,
    termMonths: 360,
    firstPaymentDate: '2024-01-01',
    monthlyPayment: 1000,
    extraPaymentDefault: 0,
    linkedPropertyId: null,
    linkedVehicleId: null,
  });
}

describe('NetWorth page', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [{ version: '0001_initial', sql: loadInitialMigration() }]);
    setDatabase(db);
    resetStores();
  });

  afterEach(async () => {
    await db.close();
  });

  it('renders the empty state when there is no data', async () => {
    render(
      <MemoryRouter>
        <NetWorth />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText(/no data yet/i)).toBeInTheDocument();
    });
    // Should NOT render the chart card title in the empty state.
    expect(screen.queryByText('Current Net Worth')).not.toBeInTheDocument();
  });

  it('renders the current net worth when at least one snapshot exists', async () => {
    const accountId = await seedAccount(db, 'Schwab');
    await seedSnapshot(db, accountId, '2024-06-28', 150000);
    await seedProperty(db, 600000);
    await seedVehicle(db, 25000);
    await seedLoan(db, LoanType.MORTGAGE, 350000);

    render(
      <MemoryRouter>
        <NetWorth />
      </MemoryRouter>,
    );

    // 150000 + 600000 + 25000 - 350000 = 425000
    await waitFor(() => {
      expect(screen.getByText(/Current Net Worth/i)).toBeInTheDocument();
    });
    expect(await screen.findByText('$425,000')).toBeInTheDocument();
  });

  it('renders the 12-month chart card and asset breakdown', async () => {
    const accountId = await seedAccount(db, 'Schwab');
    await seedSnapshot(db, accountId, '2024-05-31', 100000);
    await seedSnapshot(db, accountId, '2024-06-28', 105000);
    await seedProperty(db, 400000);
    await seedLoan(db, LoanType.AUTO, 15000);

    render(
      <MemoryRouter>
        <NetWorth />
      </MemoryRouter>,
    );

    // LineChartCard title text — sufficient signal that the chart card
    // mounted (Recharts' SVG is finicky in jsdom; see ChartCards.test.tsx).
    await waitFor(() => {
      expect(screen.getByText('Net Worth')).toBeInTheDocument();
    });
    expect(screen.getByText(/last 12 months/i)).toBeInTheDocument();

    // Assets-by-category breakdown card present.
    expect(screen.getByText(/Assets by category/i)).toBeInTheDocument();
    expect(screen.getByText('Investments')).toBeInTheDocument();
    expect(screen.getByText('Property')).toBeInTheDocument();

    // Liabilities card present.
    expect(screen.getByText(/Liabilities by type/i)).toBeInTheDocument();
  });
});
