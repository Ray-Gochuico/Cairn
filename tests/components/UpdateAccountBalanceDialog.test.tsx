import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UpdateAccountBalanceDialog } from '@/components/dialogs/UpdateAccountBalanceDialog';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { setDatabase } from '@/db/db';
import { runMigrations } from '@/db/migrations';
import { AccountsRepo } from '@/domain/accounts';
import { AccountSnapshotsRepo } from '@/domain/snapshots';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { AccountType } from '@/types/enums';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadInitialMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');
const loadAccountMarginMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0007_add_account_margin.sql'), 'utf-8');

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

describe('UpdateAccountBalanceDialog', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: loadInitialMigration() },
      { version: '0007_add_account_margin', sql: loadAccountMarginMigration() },
    ]);
    setDatabase(db);
    useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  it('inserts an account_snapshots row on Save and closes', async () => {
    const accountId = await seedAccount(db, 'Test Savings');

    const onOpenChange = vi.fn();
    const onSuccess = vi.fn();
    const user = userEvent.setup();

    render(
      <UpdateAccountBalanceDialog
        open={true}
        onOpenChange={onOpenChange}
        accountId={accountId}
        accountName="Test Savings"
        onSuccess={onSuccess}
      />
    );

    // Fill the amount field
    const amountInput = screen.getByLabelText(/current balance/i);
    await user.type(amountInput, '5200');

    // Submit
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    // Assert the snapshot was created
    const snapshots = await new AccountSnapshotsRepo(db).listForAccount(accountId);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].totalValue).toBe(5200);

    // Assert callbacks fired
    expect(onSuccess).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('blocks save and shows error when amount is empty', async () => {
    const accountId = await seedAccount(db, 'Test Savings');

    render(
      <UpdateAccountBalanceDialog
        open={true}
        onOpenChange={vi.fn()}
        accountId={accountId}
        accountName="Test Savings"
      />
    );

    // Save button should be disabled when amount is empty
    const saveButton = screen.getByRole('button', { name: /^save$/i });
    expect(saveButton).toBeDisabled();
  });
});
