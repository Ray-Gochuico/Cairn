import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useAccountsStore } from '@/stores/accounts-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { AccountsRepo } from '@/domain/accounts';
import { AccountType } from '@/types/enums';
import ContributionsTab from '@/pages/inputs/ContributionsTab';

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

describe('ContributionsTab', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    useAccountsStore.setState({ accounts: [], isLoading: false, error: null });
    usePersonsStore.setState({ persons: [], isLoading: false, error: null });
    useContributionsStore.setState({ contributions: [], isLoading: false, error: null });
    // Seed an account so ContributionsTab renders its main list (not the
    // "Add accounts first" short-circuit empty state).
    await seedAccount(db, 'Test brokerage');
  });

  afterEach(async () => {
    await db.close();
  });

  it('renders an Import CSV button in the page header', async () => {
    render(<MemoryRouter><ContributionsTab /></MemoryRouter>);
    expect(
      await screen.findByRole('button', { name: /import csv/i }),
    ).toBeInTheDocument();
  });

  it('Import CSV button has the hidden file input wired', async () => {
    render(<MemoryRouter><ContributionsTab /></MemoryRouter>);
    expect(
      await screen.findByTestId('import-csv-file-input'),
    ).toBeInTheDocument();
  });
});
