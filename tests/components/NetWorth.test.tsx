import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { useLoansStore } from '@/stores/loans-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
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
import type { Person } from '@/types/schema';
import NetWorth from '@/pages/NetWorth';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

const loadInitialMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');
const loadAccountMarginMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0007_add_account_margin.sql'), 'utf-8');
const loadAccentColorsMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0015_add_accent_colors.sql'), 'utf-8');
const loadAppSettingsMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0014_add_app_settings.sql'), 'utf-8');
const loadCashApyMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0024_cash_apy.sql'), 'utf-8');
const loadAssetValueSnapshotsMigration = () =>
  readFileSync(
    resolve(__dirname, '../../src/db/migrations/0026_asset_value_snapshots.sql'),
    'utf-8',
  );

function resetStores() {
  useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null });
  usePropertiesStore.setState({ properties: [], isLoading: false, error: null });
  useVehiclesStore.setState({ vehicles: [], isLoading: false, error: null });
  useLoansStore.setState({ loans: [], isLoading: false, error: null });
  useAccountsStore.setState({ accounts: [], isLoading: false, error: null });
  usePersonsStore.setState({ persons: [], isLoading: false, error: null });
  useAssetValueSnapshotsStore.setState({
    assetValueSnapshots: [],
    isLoading: false,
    error: null,
  });
}

async function seedAccount(
  db: SqliteAdapter,
  name: string,
  ownerPersonId: number | null = null,
  excludedFromNetWorth = false,
): Promise<number> {
  const repo = new AccountsRepo(db);
  return repo.create({
    householdId: 1,
    ownerPersonId,
    beneficiaryDependentId: null,
    name,
    institution: null,
    type: AccountType.ACCOUNT_BROKERAGE,
    cryptoWalletAddress: null,
    autoFetchEnabled: false,
    excludedFromNetWorth,
    stateOfPlan: null,
    accentColor: null,
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
  obligorPersonId: number | null = null,
): Promise<void> {
  const repo = new LoansRepo(db);
  await repo.create({
    householdId: 1,
    obligorPersonId,
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
    await runMigrations(db, [
      { version: '0001_initial', sql: loadInitialMigration() },
      { version: '0007_add_account_margin', sql: loadAccountMarginMigration() },
      { version: '0015_add_accent_colors', sql: loadAccentColorsMigration() },
      { version: '0014_add_app_settings', sql: loadAppSettingsMigration() },
      { version: '0024_cash_apy', sql: loadCashApyMigration() },
      {
        version: '0026_asset_value_snapshots',
        sql: loadAssetValueSnapshotsMigration(),
      },
    ]);
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
    // Wave-4 polish elevated this empty state to match Goals' Card +
    // friendly copy + primary-CTA-button pattern. Verify the new copy AND
    // the CTA so a future refactor that drops the button is caught — the
    // CTA is the user-research-validated next step, not optional.
    await waitFor(() => {
      expect(screen.getByText(/no net worth snapshots yet/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: /add an account/i })).toHaveAttribute(
      'href',
      '/inputs/accounts',
    );
    // Should NOT render the chart hero in the empty state.
    expect(
      screen.queryByTestId('asset-chart-header-value'),
    ).not.toBeInTheDocument();
  });

  it('renders the chart hero with the as-of net worth when at least one snapshot exists', async () => {
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

    // The AssetValueChart header is now the page's single current-value
    // source (spec §3.7). Expected value under as-of semantics with the
    // netWorth surface's ALL-eligible default selection:
    //   account:  latest snapshot on-or-before today → Schwab 2024-06-28
    //             = 150,000 (carries forward as-of, never expires)
    //   property: no value snapshots + no purchaseDate → flat
    //             currentEstimatedValue = 600,000
    //   vehicle:  same flat-estimate rule → 25,000
    //   loan:     back-walk anchored at today → currentBalance = 350,000
    //             (future buckets hold flat at the anchor, no projection)
    //   150,000 + 600,000 + 25,000 − 350,000 = 425,000
    // No fake clock needed: every fixture is an absolute date whose value
    // carries forward to any "today" ≥ 2024-06-28, so the LATEST bucket is
    // clock-independent (deltas/baselines are not asserted here).
    const header = await screen.findByTestId('asset-chart-header-value');
    await waitFor(() => expect(header.textContent).toBe('$425,000'));

    // The three MetricCard tiles are gone — "one fact, one place": the
    // current value lives in the chart header, MoM/YoY in GrowthCard's
    // 1m/1y horizons.
    expect(screen.queryByText('Current Net Worth')).not.toBeInTheDocument();
    expect(screen.queryByText('Month over Month')).not.toBeInTheDocument();
  });

  it('renders the chart hero (range tabs) and dual donuts', async () => {
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

    // The chart hero renders its header value and the 3M…All range tabs.
    // (Two tablists exist since Wave 3: chart windows + GrowthCard chips —
    // assert the chart's own 3M tab rather than a lone tablist.)
    await screen.findByTestId('asset-chart-header-value');
    expect(screen.getAllByRole('tablist').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('tab', { name: '3M' })).toBeInTheDocument();

    // The two donuts render their card titles.
    expect(screen.getByText('Assets')).toBeInTheDocument();
    expect(screen.getByText('Liabilities')).toBeInTheDocument();
  });

  it('does NOT render the legacy LineChartCard "Last 12 months" subtitle', async () => {
    const accountId = await seedAccount(db, 'Schwab');
    await seedSnapshot(db, accountId, '2024-06-28', 100000);

    render(
      <MemoryRouter>
        <NetWorth />
      </MemoryRouter>,
    );

    await screen.findByTestId('asset-chart-header-value');
    expect(screen.queryByText(/last 12 months/i)).not.toBeInTheDocument();
  });

  it('does NOT render the legacy "Assets by category" or "Liabilities by type" widgets', async () => {
    const accountId = await seedAccount(db, 'Schwab');
    await seedSnapshot(db, accountId, '2024-06-28', 100000);
    await seedProperty(db, 400000);
    await seedLoan(db, LoanType.AUTO, 15000);

    render(
      <MemoryRouter>
        <NetWorth />
      </MemoryRouter>,
    );

    await screen.findByTestId('asset-chart-header-value');
    expect(screen.queryByText(/Assets by category/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Liabilities by type/i)).not.toBeInTheDocument();
  });

  it('view filter ?view=p1: chart stays household-scoped (labeled), GrowthCard scopes to p1', async () => {
    // The 0001 migration already seeds household(id=1); we just need persons
    // so the accounts.owner_person_id FK resolves. Inserted via raw SQL
    // because the 0001 migration has a narrower persons schema than
    // PersonsRepo.create expects (the commission/employment columns land in
    // later migrations not loaded by this test).
    await db.execute(
      `INSERT INTO persons (id, household_id, name, date_of_birth, target_retirement_age) VALUES (1, 1, 'Alice', '1990-01-01', 65)`,
    );
    await db.execute(
      `INSERT INTO persons (id, household_id, name, date_of_birth, target_retirement_age) VALUES (2, 1, 'Bob', '1990-01-01', 65)`,
    );

    // Mirror the DB state in the persons-store so useViewFilter sees a
    // two-person household. (The page doesn't call loadPersons itself, so we
    // can't rely on the store to be in sync with the DB without doing this.)
    usePersonsStore.setState({
      persons: [
        { ...basePerson, id: 1, name: 'Alice' },
        { ...basePerson, id: 2, name: 'Bob' },
      ],
      isLoading: false,
      error: null,
      load: async () => {},
    });

    // p1 owns a brokerage with $50k. p2 owns a brokerage with $200k.
    const p1Account = await seedAccount(db, "Alice's Brokerage", 1);
    const p2Account = await seedAccount(db, "Bob's Brokerage", 2);
    await seedSnapshot(db, p1Account, '2024-06-28', 50_000);
    await seedSnapshot(db, p2Account, '2024-06-28', 200_000);

    render(
      <MemoryRouter initialEntries={['/net-worth?view=p1']}>
        <NetWorth />
      </MemoryRouter>,
    );

    // The chart hero is household-scoped BY DESIGN (spec §3.1): it keeps the
    // full $250k household total ($50k + $200k) and flags the scope with a
    // "· Household" label suffix instead of silently filtering.
    const header = await screen.findByTestId('asset-chart-header-value');
    await waitFor(() => expect(header.textContent).toBe('$250,000'));
    expect(screen.getByText(/· Household/)).toBeInTheDocument();

    // The GrowthCard IS person-filtered (fed from the visible* slices): its
    // current value shows only p1's $50k…
    const hits = await screen.findAllByText('$50,000');
    expect(hits.length).toBeGreaterThanOrEqual(1);
    // …and p2's $200k never appears outside the household-labeled chart.
    expect(screen.queryByText('$200,000')).not.toBeInTheDocument();
  });

  it('GrowthCard net worth drops excludedFromNetWorth accounts (agrees with the chart)', async () => {
    const a = await seedAccount(db, 'Visible');
    const b = await seedAccount(db, 'Hidden', null, true);
    await seedSnapshot(db, a, '2026-06-01', 100_000);
    await seedSnapshot(db, b, '2026-06-01', 50_000);

    render(
      <MemoryRouter>
        <NetWorth />
      </MemoryRouter>,
    );
    await screen.findByText('Net worth growth');
    // The leak would render $150,000 in the growth card while the chart
    // header shows $100,000. Post-fix both agree: $150,000 appears nowhere.
    await waitFor(() => {
      expect(screen.queryByText('$150,000')).not.toBeInTheDocument();
      expect(screen.getAllByText('$100,000').length).toBeGreaterThan(0);
    });
  });

  it('imports a snapshot CSV end-to-end and persists the new row', async () => {
    const accountId = await seedAccount(db, 'Fidelity 401k');
    await seedSnapshot(db, accountId, '2024-06-28', 50_000);
    useAccountsStore.setState({
      accounts: [
        {
          id: accountId,
          householdId: 1,
          ownerPersonId: null,
          beneficiaryDependentId: null,
          name: 'Fidelity 401k',
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
    });

    render(
      <MemoryRouter>
        <NetWorth />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /import csv/i })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: /import csv/i }));

    const file = new File(
      ['account,snapshot_date,total_value\nFidelity 401k,2023-06-30,60000\n'],
      'snap.csv',
      { type: 'text/csv' },
    );
    const input = screen.getByTestId('import-csv-file-input') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file] });
    fireEvent.change(input);

    await screen.findByRole('dialog');
    expect(screen.getByText(/import account snapshots from csv/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^commit/i }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    const repo = new AccountSnapshotsRepo(db);
    const all = await repo.listForAccount(accountId);
    const imported = all.find((s) => s.snapshotDate === '2023-06-30');
    expect(imported).toBeDefined();
    expect(imported?.totalValue).toBe(60_000);
  });
});
