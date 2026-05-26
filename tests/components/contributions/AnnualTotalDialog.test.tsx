import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AnnualTotalDialog } from '@/components/contributions/AnnualTotalDialog';
import { useContributionsStore } from '@/stores/contributions-store';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { ContributionsRepo } from '@/domain/contributions';
import { AccountsRepo } from '@/domain/accounts';
import { AccountType, ContributionSource } from '@/types/enums';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mig = (file: string) => ({
  version: file,
  sql: readFileSync(resolve(__dirname, `../../../src/db/migrations/${file}.sql`), 'utf-8'),
});

const baseProps = {
  open: true,
  accounts: [{ id: 1, name: 'Fidelity 401k' }],
  persons: [{ id: 1, name: 'Alice' }],
};

describe('AnnualTotalDialog', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      mig('0001_initial'),
      mig('0007_add_account_margin'),
      mig('0014_add_app_settings'),
      mig('0015_add_accent_colors'),
      mig('0024_cash_apy'),
    ]);
    setDatabase(db);

    // Real account so the FK on contributions.account_id is satisfied.
    const accountsRepo = new AccountsRepo(db);
    await accountsRepo.create({
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
    });

    useContributionsStore.setState({ contributions: [], isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  it('renders the form fields', () => {
    render(<AnnualTotalDialog {...baseProps} onOpenChange={vi.fn()} />);
    expect(screen.getByLabelText(/account/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/year/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/total \(\$\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/person/i)).toBeInTheDocument();
  });

  it('disables Save until fields are valid', () => {
    render(<AnnualTotalDialog {...baseProps} onOpenChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
  });

  it('inserts a contribution row on Save and closes', async () => {
    const onOpenChange = vi.fn();
    render(<AnnualTotalDialog {...baseProps} onOpenChange={onOpenChange} />);
    fireEvent.change(screen.getByLabelText(/account/i), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/year/i), { target: { value: '2024' } });
    fireEvent.change(screen.getByLabelText(/total \(\$\)/i), { target: { value: '22500' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));

    const repo = new ContributionsRepo(db);
    const all = await repo.listAll();
    const found = all.find(
      (c) => c.source === ContributionSource.ANNUAL_TOTAL && c.date === '2024-12-31',
    );
    expect(found).toBeDefined();
    expect(found?.amount).toBe(22500);
  });

  it('prompts to replace when an annual total already exists for the same account+year', async () => {
    const repo = new ContributionsRepo(db);
    const existingId = await repo.create({
      accountId: 1,
      personId: null,
      date: '2024-12-31',
      amount: 20_000,
      source: ContributionSource.ANNUAL_TOTAL,
    });
    await useContributionsStore.getState().load();
    expect(useContributionsStore.getState().contributions).toHaveLength(1);

    const onOpenChange = vi.fn();
    render(<AnnualTotalDialog {...baseProps} onOpenChange={onOpenChange} />);
    fireEvent.change(screen.getByLabelText(/account/i), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(/year/i), { target: { value: '2024' } });
    fireEvent.change(screen.getByLabelText(/total \(\$\)/i), { target: { value: '22500' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /replace/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /replace/i }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));

    const all = await repo.listAll();
    expect(all).toHaveLength(1);
    expect(all[0].amount).toBe(22500);
    expect(all[0].id).not.toBe(existingId);
  });
});
