import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AddAnnualTotalButton } from '@/components/contributions/AddAnnualTotalButton';
import { useAccountsStore } from '@/stores/accounts-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { AccountType } from '@/types/enums';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mig = (file: string) => ({
  version: file,
  sql: readFileSync(resolve(__dirname, `../../../src/db/migrations/${file}.sql`), 'utf-8'),
});

describe('AddAnnualTotalButton', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      mig('0001_initial'),
      mig('0007_add_account_margin'),
      mig('0015_add_accent_colors'),
    ]);
    setDatabase(db);
    useAccountsStore.setState({
      accounts: [
        {
          id: 1,
          householdId: 1,
          ownerPersonId: null,
          beneficiaryDependentId: null,
          name: 'Fidelity 401k',
          institution: null,
          type: AccountType.ACCOUNT_401K,
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
    usePersonsStore.setState({ persons: [], isLoading: false, error: null });
    useContributionsStore.setState({ contributions: [], isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  it('renders a button that opens the annual-total dialog', () => {
    render(<AddAnnualTotalButton />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /annual total/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/add annual contribution total/i)).toBeInTheDocument();
  });
});
