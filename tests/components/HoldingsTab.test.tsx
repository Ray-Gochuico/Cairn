import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useAccountsStore } from '@/stores/accounts-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { AccountsRepo } from '@/domain/accounts';
import { HoldingsRepo } from '@/domain/holdings';
import { AccountType } from '@/types/enums';
import HoldingsTab from '@/pages/inputs/HoldingsTab';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loadInitialMigration = () =>
  readFileSync(resolve(__dirname, '../../src/db/migrations/0001_initial.sql'), 'utf-8');

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

async function seedHolding(
  db: SqliteAdapter,
  accountId: number,
  ticker: string,
  shareCount: number
): Promise<number> {
  const repo = new HoldingsRepo(db);
  return repo.create({
    accountId,
    ticker,
    shareCount,
    targetAllocationPct: null,
    costBasis: null,
  });
}

describe('HoldingsTab', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [{ version: '0001_initial', sql: loadInitialMigration() }]);
    setDatabase(db);
    useAccountsStore.setState({ accounts: [], isLoading: false, error: null });
    useHoldingsStore.setState({ holdings: [], isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  it('shows "Add accounts first" when no accounts exist', async () => {
    render(<MemoryRouter><HoldingsTab /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText(/add accounts first/i)).toBeInTheDocument();
    });
  });

  it('filters holdings by selected account', async () => {
    const a = await seedAccount(db, 'Account A');
    const b = await seedAccount(db, 'Account B');
    await seedHolding(db, a, 'VTI', 100);
    await seedHolding(db, a, 'VXUS', 50);

    const user = userEvent.setup();
    render(<MemoryRouter><HoldingsTab /></MemoryRouter>);

    // Wait for account A to be auto-selected; both holdings visible.
    await waitFor(() => {
      const tickers = screen.getAllByLabelText(/ticker/i) as HTMLInputElement[];
      // 2 existing rows + 1 add row = 3
      expect(tickers).toHaveLength(3);
    });

    // Existing rows should show VTI and VXUS
    const tickerInputs = screen.getAllByLabelText(/ticker/i) as HTMLInputElement[];
    expect(tickerInputs[0].value).toBe('VTI');
    expect(tickerInputs[1].value).toBe('VXUS');

    // Switch to Account B
    const picker = screen.getByLabelText(/^account$/i) as HTMLSelectElement;
    await user.selectOptions(picker, String(b));

    // Now empty
    await waitFor(() => {
      expect(screen.getByText(/no holdings in this account yet/i)).toBeInTheDocument();
    });
    // Only the add row remains
    const remainingTickers = screen.getAllByLabelText(/ticker/i) as HTMLInputElement[];
    expect(remainingTickers).toHaveLength(1);
    expect(remainingTickers[0].value).toBe('');
  });

  it('adds a holding to the selected account', async () => {
    const a = await seedAccount(db, 'Account A');

    const user = userEvent.setup();
    render(<MemoryRouter><HoldingsTab /></MemoryRouter>);

    await waitFor(() => screen.getByText(/no holdings in this account yet/i));

    // The Add row is the only one
    const tickerInput = screen.getByLabelText(/ticker/i) as HTMLInputElement;
    await user.type(tickerInput, 'AAPL');
    const sharesInput = screen.getByLabelText(/shares/i) as HTMLInputElement;
    await user.clear(sharesInput);
    await user.type(sharesInput, '10');

    await user.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => {
      const { holdings } = useHoldingsStore.getState();
      expect(holdings).toHaveLength(1);
      expect(holdings[0].accountId).toBe(a);
      expect(holdings[0].ticker).toBe('AAPL');
      expect(holdings[0].shareCount).toBe(10);
    });
  });

  it('edits a holding inline and saves', async () => {
    const a = await seedAccount(db, 'Account A');
    await seedHolding(db, a, 'VTI', 100);

    const user = userEvent.setup();
    render(<MemoryRouter><HoldingsTab /></MemoryRouter>);

    await waitFor(() => {
      const tickers = screen.getAllByLabelText(/ticker/i) as HTMLInputElement[];
      expect(tickers[0].value).toBe('VTI');
    });

    const tickerInputs = screen.getAllByLabelText(/ticker/i) as HTMLInputElement[];
    await user.clear(tickerInputs[0]);
    await user.type(tickerInputs[0], 'VOO');

    // Click the Save button for that row (the first Save button in the rendered order)
    const saveButtons = screen.getAllByRole('button', { name: /^save$/i });
    await user.click(saveButtons[0]);

    await waitFor(() => {
      const { holdings } = useHoldingsStore.getState();
      expect(holdings[0].ticker).toBe('VOO');
    });
  });

  it('deletes a holding', async () => {
    const a = await seedAccount(db, 'Account A');
    await seedHolding(db, a, 'VTI', 100);

    const user = userEvent.setup();
    render(<MemoryRouter><HoldingsTab /></MemoryRouter>);

    await waitFor(() => {
      const tickers = screen.getAllByLabelText(/ticker/i) as HTMLInputElement[];
      expect(tickers[0].value).toBe('VTI');
    });

    await user.click(screen.getByRole('button', { name: /delete/i }));

    await waitFor(() => {
      const { holdings } = useHoldingsStore.getState();
      expect(holdings).toHaveLength(0);
    });
    expect(screen.getByText(/no holdings in this account yet/i)).toBeInTheDocument();
    // Silence within unused-import lint by referencing it (kept for explanatory value if extended)
    void within;
  });
});
