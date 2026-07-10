import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useAccountsStore } from '@/stores/accounts-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { AccountsRepo } from '@/domain/accounts';
import { HoldingsRepo } from '@/domain/holdings';
import { AccountType } from '@/types/enums';
import HoldingsPanel from '@/components/investments/manage/HoldingsPanel';

async function seedAccount(
  db: SqliteAdapter,
  name: string,
  opts: { allowMargin?: boolean } = {},
): Promise<number> {
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
    allowMargin: opts.allowMargin ?? false,
    stateOfPlan: null,
    accentColor: null,
  });
}

async function seedHolding(
  db: SqliteAdapter,
  accountId: number,
  ticker: string,
  shareCount: number,
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

describe('HoldingsPanel (W14 Manage surface — verbatim tab port)', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    useAccountsStore.setState({ accounts: [], isLoading: false, error: null });
    useHoldingsStore.setState({ holdings: [], isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  it('shows "Add accounts first" when no accounts exist', async () => {
    render(<MemoryRouter><HoldingsPanel /></MemoryRouter>);
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
    render(<MemoryRouter><HoldingsPanel /></MemoryRouter>);

    await waitFor(() => {
      const tickers = screen.getAllByLabelText(/ticker/i) as HTMLInputElement[];
      expect(tickers).toHaveLength(3); // 2 rows + add row
    });

    const picker = screen.getByLabelText(/^account$/i) as HTMLSelectElement;
    await user.selectOptions(picker, String(b));

    await waitFor(() => {
      expect(screen.getByText(/no holdings in this account yet/i)).toBeInTheDocument();
    });
  });

  it('adds a holding to the selected account', async () => {
    const a = await seedAccount(db, 'Account A');
    const user = userEvent.setup();
    render(<MemoryRouter><HoldingsPanel /></MemoryRouter>);

    await waitFor(() => screen.getByText(/no holdings in this account yet/i));

    await user.type(screen.getByLabelText(/ticker/i), 'AAPL');
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
    render(<MemoryRouter><HoldingsPanel /></MemoryRouter>);

    await waitFor(() => {
      const tickers = screen.getAllByLabelText(/ticker/i) as HTMLInputElement[];
      expect(tickers[0].value).toBe('VTI');
    });

    const tickerInputs = screen.getAllByLabelText(/ticker/i) as HTMLInputElement[];
    await user.clear(tickerInputs[0]);
    await user.type(tickerInputs[0], 'VOO');
    const saveButtons = screen.getAllByRole('button', { name: /^save$/i });
    await user.click(saveButtons[0]);

    await waitFor(() => {
      expect(useHoldingsStore.getState().holdings[0].ticker).toBe('VOO');
    });
  });

  it('deletes a holding only after confirming in the dialog', async () => {
    const a = await seedAccount(db, 'Account A');
    await seedHolding(db, a, 'VTI', 100);

    const user = userEvent.setup();
    render(<MemoryRouter><HoldingsPanel /></MemoryRouter>);

    await waitFor(() => {
      const tickers = screen.getAllByLabelText(/ticker/i) as HTMLInputElement[];
      expect(tickers[0].value).toBe('VTI');
    });

    await user.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(useHoldingsStore.getState().holdings).toHaveLength(1);
    expect(await screen.findByText(/delete vti\?/i)).toBeInTheDocument();

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }));

    await waitFor(() => {
      expect(useHoldingsStore.getState().holdings).toHaveLength(0);
    });
    expect(screen.getByText(/no holdings in this account yet/i)).toBeInTheDocument();
  });

  it('renders an Import CSV button', async () => {
    await seedAccount(db, 'Brokerage');
    render(<MemoryRouter><HoldingsPanel /></MemoryRouter>);
    expect(
      await screen.findByRole('button', { name: /import csv/i }),
    ).toBeInTheDocument();
  });
});
