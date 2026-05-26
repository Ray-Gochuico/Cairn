import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useLoansStore } from '@/stores/loans-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { AccountsRepo } from '@/domain/accounts';
import { AccountSnapshotsRepo } from '@/domain/snapshots';
import { LoansRepo } from '@/domain/loans';
import { AccountType, LoanType, SnapshotSource } from '@/types/enums';
import MonthlyMiniWindow from '@/pages/MonthlyMiniWindow';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadInitialMigration = () =>
  readFileSync(
    resolve(__dirname, '../../src/db/migrations/0001_initial.sql'),
    'utf-8',
  );
const loadAccountMarginMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0007_add_account_margin.sql'), 'utf-8');
const loadAccentColorsMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0015_add_accent_colors.sql'), 'utf-8');
const loadAppSettingsMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0014_add_app_settings.sql'), 'utf-8');
const loadCashApyMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0024_cash_apy.sql'), 'utf-8');

function resetStores() {
  useAccountsStore.setState({ accounts: [], isLoading: false, error: null });
  useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null });
  useLoansStore.setState({ loans: [], isLoading: false, error: null });
  usePropertiesStore.setState({ properties: [], isLoading: false, error: null });
  useVehiclesStore.setState({ vehicles: [], isLoading: false, error: null });
}

describe('MonthlyMiniWindow', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: loadInitialMigration() },
      { version: '0007_add_account_margin', sql: loadAccountMarginMigration() },
      { version: '0015_add_accent_colors', sql: loadAccentColorsMigration() },
      { version: '0014_add_app_settings', sql: loadAppSettingsMigration() },
      { version: '0024_cash_apy', sql: loadCashApyMigration() },
    ]);
    setDatabase(db);
    resetStores();
  });

  afterEach(async () => {
    await db.close();
  });

  it('renders the empty state with a back-to-dashboard button when there is nothing to confirm', async () => {
    render(
      <MemoryRouter>
        <MonthlyMiniWindow />
      </MemoryRouter>,
    );

    expect(await screen.findByText(/nothing to confirm this month/i))
      .toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /back to dashboard/i }),
    ).toBeInTheDocument();
  });

  it('renders a derived-value card when an AUTO_DERIVED snapshot exists for last month', async () => {
    // Seed an account + an AUTO_DERIVED snapshot dated last month's close.
    const accountsRepo = new AccountsRepo(db);
    const accountId = await accountsRepo.create({
      householdId: 1,
      ownerPersonId: null,
      beneficiaryDependentId: null,
      name: 'Brokerage One',
      institution: null,
      type: AccountType.ACCOUNT_BROKERAGE,
      cryptoWalletAddress: null,
      autoFetchEnabled: false,
      excludedFromNetWorth: false,
      stateOfPlan: null,
      accentColor: null,
    });

    const snapshotsRepo = new AccountSnapshotsRepo(db);
    // Pick a date in the previous month — pick a Friday for safety. The page
    // queries by lastBusinessDayOfMonth(lastMonth), so seed exactly that.
    const today = new Date();
    const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastBizDayUtc = new Date(
      Date.UTC(prev.getFullYear(), prev.getMonth() + 1, 0),
    );
    while (lastBizDayUtc.getUTCDay() === 0 || lastBizDayUtc.getUTCDay() === 6) {
      lastBizDayUtc.setUTCDate(lastBizDayUtc.getUTCDate() - 1);
    }
    const seedDate = lastBizDayUtc.toISOString().slice(0, 10);
    await snapshotsRepo.upsert({
      accountId,
      snapshotDate: seedDate,
      totalValue: 12345.67,
      source: SnapshotSource.AUTO_DERIVED,
    });

    render(
      <MemoryRouter>
        <MonthlyMiniWindow />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Brokerage One')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /^confirm$/i })).toBeInTheDocument();
    expect(screen.getByText(/\$12,345\.67/)).toBeInTheDocument();
  });

  it('renders a cash-balance card for CASH accounts', async () => {
    const accountsRepo = new AccountsRepo(db);
    await accountsRepo.create({
      householdId: 1,
      ownerPersonId: null,
      beneficiaryDependentId: null,
      name: 'Checking',
      institution: null,
      type: AccountType.ACCOUNT_CASH,
      cryptoWalletAddress: null,
      autoFetchEnabled: false,
      excludedFromNetWorth: false,
      stateOfPlan: null,
      accentColor: null,
    });

    render(
      <MemoryRouter>
        <MonthlyMiniWindow />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Checking')).toBeInTheDocument();
    });
    expect(
      screen.getByLabelText(/balance for checking/i),
    ).toBeInTheDocument();
  });

  it('confirms a derived value as USER_CONFIRMED on click', async () => {
    const user = userEvent.setup();
    const accountsRepo = new AccountsRepo(db);
    const accountId = await accountsRepo.create({
      householdId: 1,
      ownerPersonId: null,
      beneficiaryDependentId: null,
      name: 'Brokerage One',
      institution: null,
      type: AccountType.ACCOUNT_BROKERAGE,
      cryptoWalletAddress: null,
      autoFetchEnabled: false,
      excludedFromNetWorth: false,
      stateOfPlan: null,
      accentColor: null,
    });

    const snapshotsRepo = new AccountSnapshotsRepo(db);
    const today = new Date();
    const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const lastBizDayUtc = new Date(
      Date.UTC(prev.getFullYear(), prev.getMonth() + 1, 0),
    );
    while (lastBizDayUtc.getUTCDay() === 0 || lastBizDayUtc.getUTCDay() === 6) {
      lastBizDayUtc.setUTCDate(lastBizDayUtc.getUTCDate() - 1);
    }
    const seedDate = lastBizDayUtc.toISOString().slice(0, 10);
    await snapshotsRepo.upsert({
      accountId,
      snapshotDate: seedDate,
      totalValue: 5000,
      source: SnapshotSource.AUTO_DERIVED,
    });

    render(
      <MemoryRouter>
        <MonthlyMiniWindow />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /^confirm$/i }),
      ).toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', { name: /^confirm$/i }));

    await waitFor(() => {
      const all = useSnapshotsStore.getState().snapshots;
      const updated = all.find(
        (s) => s.accountId === accountId && s.snapshotDate === seedDate,
      );
      expect(updated?.source).toBe(SnapshotSource.USER_CONFIRMED);
    });
  });

  it('renders a loan-payment card with the next amortization entry', async () => {
    const loansRepo = new LoansRepo(db);
    const future = new Date();
    future.setMonth(future.getMonth() + 1);
    const firstPayment = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-01`;
    await loansRepo.create({
      householdId: 1,
      obligorPersonId: null,
      name: 'Test Mortgage',
      type: LoanType.MORTGAGE,
      originalAmount: 100000,
      currentBalance: 100000,
      interestRate: 0.05,
      termMonths: 360,
      firstPaymentDate: firstPayment,
      monthlyPayment: 536.82,
      extraPaymentDefault: 0,
      linkedPropertyId: null,
      linkedVehicleId: null,
    });

    render(
      <MemoryRouter>
        <MonthlyMiniWindow />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Test Mortgage')).toBeInTheDocument();
    });
    expect(screen.getByText(/next scheduled payment/i)).toBeInTheDocument();
  });
});
