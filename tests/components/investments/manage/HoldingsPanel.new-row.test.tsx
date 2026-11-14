import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// Same offline seam as tests/components/investments/manage/HoldingsPanel.test.tsx.
vi.mock('@/market/fetch-on-add', () => ({ fetchMarketDataOnAdd: vi.fn() }));

import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useAccountsStore } from '@/stores/accounts-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { AccountsRepo } from '@/domain/accounts';
import { HoldingsRepo } from '@/domain/holdings';
import { AccountType } from '@/types/enums';
import HoldingsPanel from '@/components/investments/manage/HoldingsPanel';

async function seedAccount(db: SqliteAdapter, name: string): Promise<number> {
  return new AccountsRepo(db).create({
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

async function seedHolding(
  db: SqliteAdapter,
  accountId: number,
  ticker: string,
  targetAllocationPct: number | null = null,
): Promise<number> {
  return new HoldingsRepo(db).create({
    accountId,
    ticker,
    shareCount: 100,
    targetAllocationPct,
    costBasis: null,
  });
}

/** The "Add holding" row is the last HoldingForm row on the panel. */
function addRow() {
  const last = <T extends HTMLElement>(label: RegExp) => screen.getAllByLabelText(label).at(-1) as T;
  return {
    ticker: last<HTMLInputElement>(/^ticker$/),
    shares: last<HTMLInputElement>(/^shares$/),
    target: last<HTMLInputElement>(/^target allocation \(%\)$/),
    cost: last<HTMLInputElement>(/^cost basis$/),
  };
}

async function typeAddRow(user: ReturnType<typeof userEvent.setup>) {
  await user.type(addRow().ticker, 'AAPL');
  await user.clear(addRow().shares);
  await user.type(addRow().shares, '10');
  await user.type(addRow().target, '60');
  await user.type(addRow().cost, '1500');
}

function expectTypedAddRow() {
  expect(addRow().ticker).toHaveValue('AAPL');
  expect(addRow().shares).toHaveValue(10);
  expect(addRow().target).toHaveValue(60);
  expect(addRow().cost).toHaveValue(1500);
}

// The store's own create, put back before every test: one test swaps in a
// rejecting create, and no test may inherit it.
const realCreate = useHoldingsStore.getState().create;

describe('v1.8.0 O1 (RC1, D-O1-1): the Manage new-holding row keeps what was typed until its own add', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    useAccountsStore.setState({ accounts: [], isLoading: false, error: null });
    useHoldingsStore.setState({ holdings: [], isLoading: false, error: null, create: realCreate });
  });

  afterEach(async () => {
    await db.close();
  });

  it('an account pick keeps the typed row, and Add saves it to the account shown', async () => {
    await seedAccount(db, 'Account A');
    const b = await seedAccount(db, 'Account B');
    const user = userEvent.setup();
    render(<MemoryRouter><HoldingsPanel /></MemoryRouter>);
    await waitFor(() => screen.getByText(/no holdings in this account yet/i));
    await typeAddRow(user);
    const ticker = addRow().ticker;

    await user.selectOptions(screen.getByLabelText(/^account$/i), String(b));

    expectTypedAddRow();
    expect(ticker.isConnected).toBe(true); // the same row, never a fresh one
    await user.click(screen.getByRole('button', { name: /^add$/i }));
    await waitFor(() => expect(useHoldingsStore.getState().holdings).toHaveLength(1));
    expect(useHoldingsStore.getState().holdings[0]).toMatchObject({
      accountId: b,
      ticker: 'AAPL',
      shareCount: 10,
      targetAllocationPct: 0.6,
      costBasis: 1500,
    });
  });

  it('the target check on Add runs against the account the picker shows', async () => {
    await seedAccount(db, 'Account A');
    const b = await seedAccount(db, 'Account B');
    await seedHolding(db, b, 'VTI', 0.5);
    const user = userEvent.setup();
    render(<MemoryRouter><HoldingsPanel /></MemoryRouter>);
    await waitFor(() => screen.getByText(/no holdings in this account yet/i));
    await typeAddRow(user);

    await user.selectOptions(screen.getByLabelText(/^account$/i), String(b));
    await waitFor(() => expect(screen.getAllByLabelText(/^ticker$/)).toHaveLength(2));

    expectTypedAddRow();
    await user.click(screen.getByRole('button', { name: /^add$/i }));
    expect(
      await screen.findByText(/Target allocations sum to 110\.0% \(cap: 100%\)/),
    ).toBeInTheDocument();
    expect(useHoldingsStore.getState().holdings).toHaveLength(1);
    expect(addRow().ticker).toHaveValue('AAPL');
  });

  it('an account pick takes away a target-check message about the other account and keeps the typed row', async () => {
    const a = await seedAccount(db, 'Account A');
    const b = await seedAccount(db, 'Account B');
    await seedHolding(db, b, 'VTI', 0.5);
    const user = userEvent.setup();
    render(<MemoryRouter><HoldingsPanel /></MemoryRouter>);
    await waitFor(() => screen.getByText(/no holdings in this account yet/i));
    const picker = screen.getByLabelText(/^account$/i);
    await user.selectOptions(picker, String(b));
    await waitFor(() => expect(screen.getAllByLabelText(/^ticker$/)).toHaveLength(2));
    await typeAddRow(user);
    await user.click(screen.getByRole('button', { name: /^add$/i }));
    expect(
      await screen.findByText(/Target allocations sum to 110\.0% \(cap: 100%\)/),
    ).toBeInTheDocument();

    await user.selectOptions(picker, String(a));
    await waitFor(() => screen.getByText(/no holdings in this account yet/i));

    expect(screen.queryByText(/Target allocations sum to/)).toBeNull();
    expectTypedAddRow();
    await user.click(screen.getByRole('button', { name: /^add$/i }));
    await waitFor(() => expect(useHoldingsStore.getState().holdings).toHaveLength(2));
    expect(useHoldingsStore.getState().holdings.find((h) => h.ticker === 'AAPL')).toMatchObject({
      accountId: a,
      targetAllocationPct: 0.6,
      costBasis: 1500,
    });
  });

  // The cap-message effect clears only when the account changes. A panel
  // re-render on the same account (here a holdings reload) keeps the message
  // and the typed row (code review, MINOR: pins against over-clearing).
  it('a holdings reload on the same account keeps a target-check message and the typed row', async () => {
    const a = await seedAccount(db, 'Account A');
    await seedHolding(db, a, 'VTI', 0.5);
    const user = userEvent.setup();
    render(<MemoryRouter><HoldingsPanel /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByLabelText(/^ticker$/)).toHaveLength(2));
    await typeAddRow(user);
    await user.click(screen.getByRole('button', { name: /^add$/i }));
    expect(
      await screen.findByText(/Target allocations sum to 110\.0% \(cap: 100%\)/),
    ).toBeInTheDocument();

    await act(async () => {
      await useHoldingsStore.getState().load();
    });

    expect(screen.getByText(/Target allocations sum to 110\.0% \(cap: 100%\)/)).toBeInTheDocument();
    expectTypedAddRow();
    expect(useHoldingsStore.getState().holdings).toHaveLength(1);
  });

  it('deleting a listed holding keeps the typed new-holding row', async () => {
    const a = await seedAccount(db, 'Account A');
    await seedHolding(db, a, 'VTI');
    const user = userEvent.setup();
    render(<MemoryRouter><HoldingsPanel /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByLabelText(/^ticker$/)[0]).toHaveValue('VTI'));
    await typeAddRow(user);

    await user.click(screen.getByRole('button', { name: /^delete$/i }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(useHoldingsStore.getState().holdings).toHaveLength(0));
    await waitFor(() => screen.getByText(/no holdings in this account yet/i));

    expectTypedAddRow();
  });

  it('a successful add clears the new-holding row (D-O1-1)', async () => {
    await seedAccount(db, 'Account A');
    const user = userEvent.setup();
    render(<MemoryRouter><HoldingsPanel /></MemoryRouter>);
    await waitFor(() => screen.getByText(/no holdings in this account yet/i));
    await typeAddRow(user);

    await user.click(screen.getByRole('button', { name: /^add$/i }));
    await waitFor(() => expect(useHoldingsStore.getState().holdings).toHaveLength(1));

    await waitFor(() => expect(addRow().ticker).toHaveValue(''));
    expect(addRow().shares).toHaveValue(0);
    expect(addRow().target).toHaveValue(null);
    expect(addRow().cost).toHaveValue(null);
  });

  it('a failed add keeps the typed row', async () => {
    await seedAccount(db, 'Account A');
    useHoldingsStore.setState({ create: vi.fn().mockRejectedValue(new Error('disk full')) });
    const user = userEvent.setup();
    render(<MemoryRouter><HoldingsPanel /></MemoryRouter>);
    await waitFor(() => screen.getByText(/no holdings in this account yet/i));
    await typeAddRow(user);

    await user.click(screen.getByRole('button', { name: /^add$/i }));

    expect(await screen.findByText(/Couldn’t save — disk full\./)).toBeInTheDocument();
    expectTypedAddRow();
  });
});
