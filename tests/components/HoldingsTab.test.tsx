import { StrictMode } from 'react';
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
import HoldingsTab from '@/pages/inputs/HoldingsTab';

async function seedAccount(
  db: SqliteAdapter,
  name: string,
  opts: { allowMargin?: boolean } = {}
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
  targetAllocationPct: number | null = null,
): Promise<number> {
  const repo = new HoldingsRepo(db);
  return repo.create({
    accountId,
    ticker,
    shareCount,
    targetAllocationPct,
    costBasis: null,
  });
}

describe('HoldingsTab', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    // Full migration chain — AccountsRepo.update() references 0018 columns
    // (has_employer_match, etc.) added by the roadmap rule engine (W7-R1).
    await runMigrations(db, await loadAllMigrations());
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

  it('blocks save when target % sum exceeds 100% on a non-margin account, allows it after enabling margin', async () => {
    const a = await seedAccount(db, 'Account A', { allowMargin: false });
    await seedHolding(db, a, 'VTI', 100, 0.5);
    await seedHolding(db, a, 'VXUS', 50, 0.3);

    const user = userEvent.setup();
    render(<MemoryRouter><HoldingsTab /></MemoryRouter>);

    // Wait for the existing two rows + the add row.
    await waitFor(() => {
      const tickers = screen.getAllByLabelText(/^ticker$/i) as HTMLInputElement[];
      expect(tickers).toHaveLength(3);
    });

    // Fill the Add row with a new holding that would push the sum to 110%.
    const tickerInputs = screen.getAllByLabelText(/^ticker$/i) as HTMLInputElement[];
    const sharesInputs = screen.getAllByLabelText(/^shares$/i) as HTMLInputElement[];
    const targetInputs = screen.getAllByLabelText(/^target allocation/i) as HTMLInputElement[];
    // The add row is the last one.
    const addTicker = tickerInputs[tickerInputs.length - 1];
    const addShares = sharesInputs[sharesInputs.length - 1];
    const addTarget = targetInputs[targetInputs.length - 1];

    await user.type(addTicker, 'BND');
    await user.clear(addShares);
    await user.type(addShares, '20');
    await user.clear(addTarget);
    await user.type(addTarget, '30');

    await user.click(screen.getByRole('button', { name: /^add$/i }));

    // Save should be BLOCKED: holdings store should still have only 2 entries
    // and an inline error message should appear.
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/110(\.0)?%/);
    });
    expect(useHoldingsStore.getState().holdings).toHaveLength(2);

    // Now flip the account to allowMargin via the accounts store; the
    // validator should permit the save.
    await useAccountsStore.getState().update(a, { allowMargin: true });

    await waitFor(() => {
      const acct = useAccountsStore.getState().accounts.find((x) => x.id === a);
      expect(acct?.allowMargin).toBe(true);
    });

    // Re-submit the Add row (form values still present).
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => {
      const { holdings } = useHoldingsStore.getState();
      expect(holdings).toHaveLength(3);
      const bnd = holdings.find((h) => h.ticker === 'BND');
      expect(bnd).toBeDefined();
      // DB still stores 0..1 fraction; UI converts × 100 / ÷ 100.
      expect(bnd?.targetAllocationPct).toBeCloseTo(0.3, 6);
    });
  });

  it('enables Save when target % is changed on an existing row with non-null default', async () => {
    const a = await seedAccount(db, 'Account A', { allowMargin: false });
    await seedHolding(db, a, 'VTI', 100, 0.3);

    const user = userEvent.setup();
    // Wrap in StrictMode to match the production main.tsx render and surface
    // React-19 double-render races inside HoldingForm's RHF initialization.
    render(
      <StrictMode>
        <MemoryRouter><HoldingsTab /></MemoryRouter>
      </StrictMode>
    );

    // Wait for the existing row + add row.
    await waitFor(() => {
      const tickers = screen.getAllByLabelText(/^ticker$/i) as HTMLInputElement[];
      expect(tickers).toHaveLength(2);
    });

    // Target% inputs: first is the existing row's, second is the add row's.
    const targetInputs = screen.getAllByLabelText(/^target allocation/i) as HTMLInputElement[];
    expect(targetInputs).toHaveLength(2);
    const existingTarget = targetInputs[0];
    // Defaults render as whole-number percent (0.3 fraction → 30).
    expect(existingTarget.value).toBe('30');

    // Save button for the existing row should start disabled.
    const saveButtons = screen.getAllByRole('button', { name: /^save$/i });
    expect(saveButtons[0]).toBeDisabled();

    // Edit the target%: clear and type 45 — Save should now be enabled.
    await user.clear(existingTarget);
    await user.type(existingTarget, '45');

    // Confirm the value is what we expect after the edit.
    expect(existingTarget.value).toBe('45');

    const saveButtonsAfter = screen.getAllByRole('button', { name: /^save$/i });
    expect(saveButtonsAfter[0]).not.toBeDisabled();
  });

  it('deletes a holding only after confirming in the dialog', async () => {
    const a = await seedAccount(db, 'Account A');
    await seedHolding(db, a, 'VTI', 100);

    const user = userEvent.setup();
    render(<MemoryRouter><HoldingsTab /></MemoryRouter>);

    await waitFor(() => {
      const tickers = screen.getAllByLabelText(/ticker/i) as HTMLInputElement[];
      expect(tickers[0].value).toBe('VTI');
    });

    // Clicking the row's Delete opens a confirm — it does NOT remove yet.
    await user.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(useHoldingsStore.getState().holdings).toHaveLength(1);
    expect(await screen.findByText(/delete vti\?/i)).toBeInTheDocument();

    // Confirm via the dialog's destructive button.
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }));

    await waitFor(() => {
      const { holdings } = useHoldingsStore.getState();
      expect(holdings).toHaveLength(0);
    });
    expect(screen.getByText(/no holdings in this account yet/i)).toBeInTheDocument();
  });

  it('canceling the delete dialog keeps the holding', async () => {
    const a = await seedAccount(db, 'Account A');
    await seedHolding(db, a, 'VTI', 100);

    const user = userEvent.setup();
    render(<MemoryRouter><HoldingsTab /></MemoryRouter>);

    await waitFor(() => {
      const tickers = screen.getAllByLabelText(/ticker/i) as HTMLInputElement[];
      expect(tickers[0].value).toBe('VTI');
    });

    await user.click(screen.getByRole('button', { name: /^delete$/i }));
    await screen.findByText(/delete vti\?/i);
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    await waitFor(() =>
      expect(screen.queryByText(/delete vti\?/i)).not.toBeInTheDocument(),
    );
    expect(useHoldingsStore.getState().holdings).toHaveLength(1);
  });

  it('renders an Import CSV button in the page header', async () => {
    // Seed an account so the tab renders the main list (not the "Add accounts first" empty state).
    await seedAccount(db, 'Brokerage');
    render(<MemoryRouter><HoldingsTab /></MemoryRouter>);
    expect(
      await screen.findByRole('button', { name: /import csv/i }),
    ).toBeInTheDocument();
  });

  it('Import CSV button has the hidden file input wired', async () => {
    await seedAccount(db, 'Brokerage');
    render(<MemoryRouter><HoldingsTab /></MemoryRouter>);
    expect(
      await screen.findByTestId('import-csv-file-input'),
    ).toBeInTheDocument();
  });
});
