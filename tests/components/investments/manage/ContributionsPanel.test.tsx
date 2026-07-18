import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useAccountsStore } from '@/stores/accounts-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { AccountsRepo } from '@/domain/accounts';
import { ContributionsRepo } from '@/domain/contributions';
import { AccountType, ContributionSource } from '@/types/enums';
import ContributionsPanel from '@/components/investments/manage/ContributionsPanel';

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
    allowMargin: false,
    stateOfPlan: null,
    accentColor: null,
  });
}

async function seedContribution(db: SqliteAdapter, accountId: number, amount: number): Promise<number> {
  const repo = new ContributionsRepo(db);
  return repo.create({
    accountId,
    personId: null,
    date: '2026-01-15',
    amount,
    source: ContributionSource.PAYCHECK,
  });
}

describe('ContributionsPanel (W14 Manage surface)', () => {
  let db: SqliteAdapter;
  let accountId: number;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    useAccountsStore.setState({ accounts: [], isLoading: false, error: null });
    usePersonsStore.setState({ persons: [], isLoading: false, error: null });
    useContributionsStore.setState({ contributions: [], isLoading: false, error: null });
    accountId = await seedAccount(db, 'Test brokerage');
  });

  afterEach(async () => {
    await db.close();
  });

  it('renders an Import CSV button', async () => {
    render(<MemoryRouter><ContributionsPanel /></MemoryRouter>);
    // Wait for the settled main branch (its header remounts), then query.
    await screen.findByRole('button', { name: /add contribution/i });
    expect(
      screen.getByRole('button', { name: /import csv/i }),
    ).toBeInTheDocument();
  });

  it('Add contribution opens the drawer; saving calls create and closes', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ContributionsPanel /></MemoryRouter>);
    await waitFor(() => screen.getByRole('button', { name: /add contribution/i }));
    await user.click(screen.getByRole('button', { name: /add contribution/i }));

    const drawer = await screen.findByRole('dialog', { name: /add contribution/i });
    const amount = within(drawer).getByLabelText(/amount/i);
    await user.clear(amount);
    await user.type(amount, '500');
    await user.click(within(drawer).getByRole('button', { name: /save/i }));

    await waitFor(() => {
      const { contributions } = useContributionsStore.getState();
      expect(contributions).toHaveLength(1);
      expect(contributions[0].amount).toBe(500);
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('row Edit opens a prefilled drawer; saving calls update', async () => {
    await seedContribution(db, accountId, 250);
    const user = userEvent.setup();
    render(<MemoryRouter><ContributionsPanel /></MemoryRouter>);

    await user.click(await screen.findByRole('button', { name: /^edit$/i }));
    const drawer = await screen.findByRole('dialog', { name: /edit contribution/i });
    const amount = within(drawer).getByLabelText(/amount/i) as HTMLInputElement;
    expect(amount).toHaveValue(250);
    await user.clear(amount);
    await user.type(amount, '300');
    await user.click(within(drawer).getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(useContributionsStore.getState().contributions[0].amount).toBe(300);
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Delete asks for confirmation with the tab’s exact copy', async () => {
    await seedContribution(db, accountId, 250);
    const user = userEvent.setup();
    render(<MemoryRouter><ContributionsPanel /></MemoryRouter>);

    await user.click(await screen.findByRole('button', { name: /^delete$/i }));
    expect(await screen.findByText(/delete this contribution\?/i)).toBeInTheDocument();
    expect(
      screen.getByText(/permanently removes the contribution record/i),
    ).toBeInTheDocument();
    // Cancel keeps it.
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(useContributionsStore.getState().contributions).toHaveLength(1);
  });
});
