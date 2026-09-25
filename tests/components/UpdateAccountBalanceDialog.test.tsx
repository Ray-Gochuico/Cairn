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
import { localTodayISO } from '@/lib/dates';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { roadmapReadsOf } from '../helpers/roadmap-local-day-reads';

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
      accentColor: null,
  });
}

describe('UpdateAccountBalanceDialog', () => {
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

/**
 * v1.7.0 R4 smoke regression: the dialog's "As of" default was the UTC day,
 * so an evening update west of UTC saved a snapshot dated TOMORROW — outside
 * the Roadmap's local-day reads. The default is now the LOCAL day.
 */
describe('UpdateAccountBalanceDialog — the As-of default is the LOCAL day', () => {
  const ORIGINAL_TZ = process.env.TZ;
  let db: SqliteAdapter;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      { version: '0001_initial', sql: loadInitialMigration() },
      { version: '0007_add_account_margin', sql: loadAccountMarginMigration() },
      { version: '0015_add_accent_colors', sql: loadAccentColorsMigration() },
      { version: '0014_add_app_settings', sql: loadAppSettingsMigration() },
      { version: '0024_cash_apy', sql: loadCashApyMigration() },
    ]);
    setDatabase(db);
    useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null });
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
    await db.close();
  });

  async function saveDefaultDatedBalance(): Promise<{ accountId: number; snapshotDate: string; totalValue: number }> {
    const accountId = await seedAccount(db, 'College 529');
    const user = userEvent.setup();
    render(
      <UpdateAccountBalanceDialog
        open={true}
        onOpenChange={vi.fn()}
        accountId={accountId}
        accountName="College 529"
      />
    );
    await user.type(screen.getByLabelText(/current balance/i), '12500');
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    await vi.waitFor(async () => {
      expect(await new AccountSnapshotsRepo(db).listForAccount(accountId)).toHaveLength(1);
    });
    const [row] = await new AccountSnapshotsRepo(db).listForAccount(accountId);
    return { accountId, snapshotDate: row.snapshotDate, totalValue: row.totalValue };
  }

  it('New York, 23:33 EDT (03:33 UTC the next day): saved as of the local 24th, and the Roadmap sees it', async () => {
    process.env.TZ = 'America/New_York';
    vi.setSystemTime(new Date('2026-09-25T03:33:00Z'));
    expect(localTodayISO()).toBe('2026-09-24'); // the arm's premise

    const saved = await saveDefaultDatedBalance();
    const { collegeLine, invested } = roadmapReadsOf(saved);
    expect(collegeLine).toMatch(/^\$12,500 across 529 accounts plus \$500\/mo grows to/);
    expect(invested).toBe(12_500);
    expect(saved.snapshotDate).toBe('2026-09-24');
  });

  it('Pacific/Kiritimati, 02:00 (12:00 UTC the previous day): saved as of the local 25th, ahead of UTC', async () => {
    process.env.TZ = 'Pacific/Kiritimati';
    vi.setSystemTime(new Date('2026-09-24T12:00:00Z'));
    expect(localTodayISO()).toBe('2026-09-25'); // the arm's premise

    const saved = await saveDefaultDatedBalance();
    expect(saved.snapshotDate).toBe('2026-09-25');
    const { collegeLine, invested } = roadmapReadsOf(saved);
    expect(collegeLine).toMatch(/^\$12,500 across 529 accounts plus \$500\/mo grows to/);
    expect(invested).toBe(12_500);
  });
});
