/**
 * C034 (v1.8.0 W4): every account the "Close {Month} — confirm N balances"
 * row counts gets exactly one card on the Monthly check-in, so the close can
 * be finished there:
 *   (a) a row dated exactly on last month's close: the derived card, as before;
 *   (b) else the latest AUTO_DERIVED row dated in last month: a derived card
 *       of that row, confirmed on that row's own date;
 *   (c) else a month-end balance card: "What was the balance on Oct 30, 2026?",
 *       starting empty, saved as a MANUAL row on the close date, in its own
 *       section and never batched by Confirm all.
 * Real page, real stores, an all-migrations in-memory DB. Only Date is faked,
 * to literal local days (each `it` sets its own).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useLoansStore } from '@/stores/loans-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useGoalsStore } from '@/stores/goals-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useHouseholdStore } from '@/stores/household-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useCategoriesStore } from '@/stores/categories-store';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { useTickersStore } from '@/stores/tickers-store';
import { useFundHoldingsStore } from '@/stores/fund-holdings-store';
import { useRoadmapOverridesStore } from '@/stores/roadmap-overrides-store';
import { useSettingsStore } from '@/stores/settings-store';
import { AccountsRepo } from '@/domain/accounts';
import { AccountSnapshotsRepo } from '@/domain/snapshots';
import { createAccountWithBalance } from '@/domain/setup-flow/steps/accounts-gate';
import { DEFAULT_ACCOUNT } from '@/lib/entity-scaffolds';
import { monthlyInputPendingFor, pendingCloseAccountIds } from '@/lib/input-pending';
import { AccountType, FilingStatus, SnapshotSource } from '@/types/enums';
import MonthlyMiniWindow from '@/pages/MonthlyMiniWindow';
import Dashboard from '@/pages/Dashboard';
import { makeAccount, makePerson } from '../factories';

const real = {
  accLoad: useAccountsStore.getState().load,
  snapLoad: useSnapshotsStore.getState().load,
  snapUpsert: useSnapshotsStore.getState().upsert,
  loanLoad: useLoansStore.getState().load,
  propLoad: usePropertiesStore.getState().load,
  vehLoad: useVehiclesStore.getState().load,
};

const BALANCE_ONLY: Array<{ name: string; type: AccountType; balance: number }> = [
  { name: 'Ray 401(k)', type: AccountType.ACCOUNT_401K, balance: 120_000 },
  { name: 'Spouse 401(k)', type: AccountType.ACCOUNT_401K, balance: 80_000 },
  { name: 'Ray Roth IRA', type: AccountType.ACCOUNT_ROTH_IRA, balance: 30_000 },
  { name: 'Family HSA', type: AccountType.ACCOUNT_HSA, balance: 8_000 },
  { name: 'Taxable Brokerage', type: AccountType.ACCOUNT_BROKERAGE, balance: 50_000 },
];

let db: SqliteAdapter;
type Row = { snapshot_date: string; total_value: number; source: string };
const rowsFor = async (accountId: number) =>
  (await db.select<Row>(
    'SELECT snapshot_date, total_value, source FROM account_snapshots WHERE account_id = ? ORDER BY snapshot_date',
    [accountId],
  )).map((r) => [r.snapshot_date, r.total_value, r.source]);

function at(localIso: string) {
  vi.setSystemTime(new Date(`${localIso}T12:00:00`));
}

/** The real setup gate (MANUAL row dated `dateIso`), once per balance-only account, plus Joint Checking. */
async function setupHousehold(dateIso: string): Promise<number[]> {
  const ids: number[] = [];
  for (const a of BALANCE_ONLY) {
    ids.push(await createAccountWithBalance({ ...DEFAULT_ACCOUNT, name: a.name, type: a.type }, a.balance, dateIso));
  }
  await createAccountWithBalance({ ...DEFAULT_ACCOUNT, name: 'Joint Checking', type: AccountType.ACCOUNT_CASH }, 12_000, dateIso);
  return ids;
}

function renderMonthly(entry = '/monthly') {
  render(<MemoryRouter initialEntries={[entry]}><MonthlyMiniWindow /></MemoryRouter>);
}

const pendingNow = (today: Date) =>
  pendingCloseAccountIds(today, useAccountsStore.getState().accounts, useSnapshotsStore.getState().snapshots);

/** Type a figure into each month-end card and save it. */
async function saveMonthEnd(user: ReturnType<typeof userEvent.setup>, entries: Array<[string, string]>) {
  for (const [name, figure] of entries) {
    await user.type(screen.getByLabelText(`balance for ${name}`), figure);
    await user.click(screen.getByRole('button', { name: `Save ${name} balance` }));
    // A saved card drops its box and Save button and reads "Saved".
    await waitFor(() => expect(screen.queryByLabelText(`balance for ${name}`)).not.toBeInTheDocument());
  }
}

function monthEndSection(): HTMLElement {
  return screen.getByText("Enter last month's balances").closest('section') as HTMLElement;
}

/** Move the faked clock to a later local moment and tell the page, as a tab coming back would. */
function moveClockTo(localDateTime: string) {
  vi.setSystemTime(new Date(localDateTime));
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

/** Family HSA and Ray Roth IRA, each entered Sep 10 through the setup gate. */
async function hsaAndRoth(): Promise<[number, number]> {
  const hsa = await createAccountWithBalance({ ...DEFAULT_ACCOUNT, name: 'Family HSA', type: AccountType.ACCOUNT_HSA }, 8_000, '2026-09-10');
  const roth = await createAccountWithBalance({ ...DEFAULT_ACCOUNT, name: 'Ray Roth IRA', type: AccountType.ACCOUNT_ROTH_IRA }, 30_000, '2026-09-10');
  return [hsa, roth];
}

describe("C034: the Monthly check-in lists every account the close counts", () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    at('2026-11-14');
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    useAccountsStore.setState({ accounts: [], isLoading: false, error: null, load: real.accLoad } as never);
    useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null, load: real.snapLoad, upsert: real.snapUpsert } as never);
    useLoansStore.setState({ loans: [], isLoading: false, error: null, load: real.loanLoad } as never);
    usePropertiesStore.setState({ properties: [], isLoading: false, error: null, load: real.propLoad } as never);
    useVehiclesStore.setState({ vehicles: [], isLoading: false, error: null, load: real.vehLoad } as never);
    usePersonsStore.setState({ persons: [], isLoading: false, error: null, load: async () => {} } as never);
  });

  afterEach(async () => {
    cleanup();
    vi.useRealTimers();
    await db.close();
  });

  it('a fresh setup on Nov 14 has nothing to close for October: no month-end or derived cards', async () => {
    await setupHousehold('2026-11-14');
    renderMonthly();
    expect(await screen.findByText('Joint Checking')).toBeInTheDocument();
    expect(screen.queryByText("Enter last month's balances")).not.toBeInTheDocument();
    expect(screen.queryByText("Confirm last month's values")).not.toBeInTheDocument();
    for (const a of BALANCE_ONLY) expect(screen.queryByText(a.name)).not.toBeInTheDocument();
  });

  it('accounts entered Sep 10: five month-end cards ask for Oct 30; saving all five clears the close', async () => {
    const ids = await setupHousehold('2026-09-10');
    const user = userEvent.setup();
    renderMonthly();
    const section = await waitFor(() => monthEndSection());
    expect(within(section).getByText('These accounts have no derived value for this close, so Cairn asks for the balance instead.')).toBeInTheDocument();
    expect(within(section).getAllByText('What was the balance on Oct 30, 2026?')).toHaveLength(5);
    for (const a of BALANCE_ONLY) expect(within(section).getByLabelText(`balance for ${a.name}`)).toHaveValue(null);
    expect(within(section).getByText('(Last entered: $120,000.00)')).toBeInTheDocument();
    await saveMonthEnd(user, BALANCE_ONLY.map((a) => [a.name, String(a.balance + 500)]));
    await waitFor(() => expect(within(monthEndSection()).getAllByText('Saved')).toHaveLength(5));
    expect(await rowsFor(ids[0])).toEqual([['2026-09-10', 120_000, 'MANUAL'], ['2026-10-30', 120_500, 'MANUAL']]);
    expect(pendingNow(new Date(2026, 10, 14))).toEqual([]);
  });

  it('the year boundary: on Jan 12, 2027, November setup rows get Dec 31 month-end cards; saving them clears the December close', async () => {
    await setupHousehold('2026-11-14');
    at('2027-01-12');
    const user = userEvent.setup();
    renderMonthly();
    const section = await waitFor(() => monthEndSection());
    expect(within(section).getAllByText('What was the balance on Dec 31, 2026?')).toHaveLength(5);
    await saveMonthEnd(user, BALANCE_ONLY.map((a) => [a.name, String(a.balance)]));
    await waitFor(() => expect(within(monthEndSection()).getAllByText('Saved')).toHaveLength(5));
    const jan12 = new Date(2027, 0, 12);
    expect(pendingNow(jan12)).toEqual([]);
    expect(monthlyInputPendingFor(jan12, useAccountsStore.getState().accounts, useSnapshotsStore.getState().snapshots)).toBe(false);
  });

  it('an AUTO_DERIVED row on Thu Oct 29 (close Fri Oct 30) gives a derived card "as of Oct 29, 2026"; Confirm ratifies that row and the card stays', async () => {
    const id = await new AccountsRepo(db).create(makeAccount({ name: 'Brokerage One', type: AccountType.ACCOUNT_BROKERAGE }));
    const repo = new AccountSnapshotsRepo(db);
    await repo.upsert({ accountId: id, snapshotDate: '2026-09-30', totalValue: 46_000, source: SnapshotSource.USER_CONFIRMED });
    await repo.upsert({ accountId: id, snapshotDate: '2026-10-29', totalValue: 48_213.55, source: SnapshotSource.AUTO_DERIVED });
    const user = userEvent.setup();
    renderMonthly();
    expect(await screen.findByText('Brokerage One · as of Oct 29, 2026')).toBeInTheDocument();
    expect(screen.getByTestId('derived-prior')).toHaveTextContent('was $46,000.00 (+4.8%)');
    await user.click(screen.getByRole('button', { name: 'Confirm Brokerage One' }));
    expect(await screen.findByText(/✓ Confirmed/)).toBeInTheDocument();
    expect(screen.getByText('Brokerage One · as of Oct 29, 2026')).toBeInTheDocument();
    expect(await rowsFor(id)).toEqual([['2026-09-30', 46_000, 'USER_CONFIRMED'], ['2026-10-29', 48_213.55, 'USER_CONFIRMED']]);
    expect(pendingNow(new Date(2026, 10, 14))).toEqual([]);
  });

  it('the (b) card is the LATEST derived row of last month: never an earlier October row, never a November one', async () => {
    const id = await new AccountsRepo(db).create(makeAccount({ name: 'Brokerage One', type: AccountType.ACCOUNT_BROKERAGE }));
    const repo = new AccountSnapshotsRepo(db);
    await repo.upsert({ accountId: id, snapshotDate: '2026-10-15', totalValue: 47_000, source: SnapshotSource.AUTO_DERIVED });
    await repo.upsert({ accountId: id, snapshotDate: '2026-10-29', totalValue: 48_213.55, source: SnapshotSource.AUTO_DERIVED });
    await repo.upsert({ accountId: id, snapshotDate: '2026-11-13', totalValue: 49_000, source: SnapshotSource.AUTO_DERIVED });
    const user = userEvent.setup();
    renderMonthly();
    expect(await screen.findByText('Brokerage One · as of Oct 29, 2026')).toBeInTheDocument();
    expect(screen.getByTestId('derived-prior')).toHaveTextContent('was $47,000.00 (+2.6%)');
    await user.click(screen.getByRole('button', { name: 'Confirm Brokerage One' }));
    expect(await screen.findByText(/✓ Confirmed/)).toBeInTheDocument();
    expect(await rowsFor(id)).toEqual([
      ['2026-10-15', 47_000, 'AUTO_DERIVED'],
      ['2026-10-29', 48_213.55, 'USER_CONFIRMED'],
      ['2026-11-13', 49_000, 'AUTO_DERIVED'],
    ]);
    expect(pendingNow(new Date(2026, 10, 14))).toEqual([]);
  });

  it('a saved month-end card keeps its place and reads "Saved"', async () => {
    await setupHousehold('2026-09-10');
    const user = userEvent.setup();
    renderMonthly();
    await waitFor(() => monthEndSection());
    await saveMonthEnd(user, [['Family HSA', '8100']]);
    const card = within(monthEndSection()).getByText('Family HSA').closest('[class*="rounded"]') as HTMLElement;
    await waitFor(() => expect(within(card).getByText('Saved')).toBeInTheDocument());
    expect(screen.queryByText("Confirm last month's values")).not.toBeInTheDocument();
  });

  it('a page left open into December asks for Nov 30 in a fresh box: no "Saved" and no typed figure carried over', async () => {
    vi.setSystemTime(new Date('2026-11-30T21:00:00'));
    const [hsa] = await hsaAndRoth();
    const user = userEvent.setup();
    renderMonthly();
    await waitFor(() => monthEndSection());
    await user.type(screen.getByLabelText('balance for Ray Roth IRA'), '31000');
    await saveMonthEnd(user, [['Family HSA', '8100']]);
    moveClockTo('2026-12-01T09:00:00');
    expect(await screen.findByText('November 2026 close · December 1, 2026')).toBeInTheDocument();
    const section = monthEndSection();
    expect(within(section).getAllByText('What was the balance on Nov 30, 2026?')).toHaveLength(2);
    expect(within(section).queryByText('Saved')).not.toBeInTheDocument();
    expect(within(section).getByLabelText('balance for Family HSA')).toHaveValue(null);
    expect(within(section).getByLabelText('balance for Ray Roth IRA')).toHaveValue(null);
    await saveMonthEnd(user, [['Family HSA', '8200']]);
    expect(await rowsFor(hsa)).toEqual([
      ['2026-09-10', 8_000, 'MANUAL'],
      ['2026-10-30', 8_100, 'MANUAL'],
      ['2026-11-30', 8_200, 'MANUAL'],
    ]);
  });

  it('a card saved for the October close does not hold its account in the month-end section for November', async () => {
    vi.setSystemTime(new Date('2026-11-30T21:00:00'));
    const [hsa] = await hsaAndRoth();
    const user = userEvent.setup();
    renderMonthly();
    await waitFor(() => monthEndSection());
    await saveMonthEnd(user, [['Family HSA', '8100']]);
    // The HSA's Nov 30 balance is entered elsewhere while this page stays open.
    await act(async () => {
      await useSnapshotsStore.getState().upsert({ accountId: hsa, snapshotDate: '2026-11-30', totalValue: 8_150, source: SnapshotSource.MANUAL });
    });
    moveClockTo('2026-12-01T09:00:00');
    expect(await screen.findByText('November 2026 close · December 1, 2026')).toBeInTheDocument();
    expect(screen.getByText('Family HSA · as of Nov 30, 2026')).toBeInTheDocument();
    expect(within(monthEndSection()).queryByText('Family HSA')).not.toBeInTheDocument();
    // Saving another account's November card does not bring the HSA back.
    await saveMonthEnd(user, [['Ray Roth IRA', '31000']]);
    expect(within(monthEndSection()).queryByText('Family HSA')).not.toBeInTheDocument();
    expect(screen.getByText('Family HSA · as of Nov 30, 2026')).toBeInTheDocument();
    expect(pendingNow(new Date(2026, 11, 1))).toEqual([]);
  });

  it('a month-end box and its Save are described by the question that names the close date; a cash card by its own question', async () => {
    await createAccountWithBalance({ ...DEFAULT_ACCOUNT, name: 'Family HSA', type: AccountType.ACCOUNT_HSA }, 8_000, '2026-09-10');
    await createAccountWithBalance({ ...DEFAULT_ACCOUNT, name: 'Joint Checking', type: AccountType.ACCOUNT_CASH }, 12_000, '2026-11-14');
    renderMonthly();
    await waitFor(() => monthEndSection());
    const monthEnd = /^What was the balance on Oct 30, 2026\?/;
    expect(screen.getByLabelText('balance for Family HSA')).toHaveAccessibleDescription(monthEnd);
    expect(screen.getByRole('button', { name: 'Save Family HSA balance' })).toHaveAccessibleDescription(monthEnd);
    const today = /^What's the balance as of today\?/;
    expect(screen.getByLabelText('balance for Joint Checking')).toHaveAccessibleDescription(today);
    expect(screen.getByRole('button', { name: 'Save Joint Checking balance' })).toHaveAccessibleDescription(today);
  });

  it('an untouched month-end Save says "Enter a number" and writes nothing', async () => {
    const ids = await setupHousehold('2026-09-10');
    const user = userEvent.setup();
    renderMonthly();
    await waitFor(() => monthEndSection());
    await user.click(screen.getByRole('button', { name: 'Save Ray 401(k) balance' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a number');
    expect(await rowsFor(ids[0])).toEqual([['2026-09-10', 120_000, 'MANUAL']]);
  });

  it('Confirm all ratifies the derived cards only; a month-end card still waits for a typed balance', async () => {
    const hsa = await createAccountWithBalance({ ...DEFAULT_ACCOUNT, name: 'Family HSA', type: AccountType.ACCOUNT_HSA }, 8_000, '2026-09-10');
    const brk = await new AccountsRepo(db).create(makeAccount({ name: 'Brokerage One', type: AccountType.ACCOUNT_BROKERAGE }));
    await new AccountSnapshotsRepo(db).upsert({ accountId: brk, snapshotDate: '2026-10-30', totalValue: 48_000, source: SnapshotSource.AUTO_DERIVED });
    const user = userEvent.setup();
    renderMonthly();
    await user.click(await screen.findByRole('button', { name: 'Confirm all (1)' }));
    expect(await screen.findByText('Confirmed 1 account value.')).toBeInTheDocument();
    expect(await rowsFor(brk)).toEqual([['2026-10-30', 48_000, 'USER_CONFIRMED']]);
    expect(await rowsFor(hsa)).toEqual([['2026-09-10', 8_000, 'MANUAL']]);
    expect(within(monthEndSection()).getByLabelText('balance for Family HSA')).toBeInTheDocument();
    expect(pendingNow(new Date(2026, 10, 14))).toEqual([hsa]);
  });

  it('person view: p1 sees only its own month-end card; the hidden one is counted', async () => {
    await db.execute(
      `INSERT INTO persons (id, household_id, name, date_of_birth, target_retirement_age, annual_salary_pretax, pretax_401k_pct)
       VALUES (1, 1, 'Alice', '1990-01-01', 65, 0, 0), (2, 1, 'Bob', '1992-01-01', 65, 0, 0)`,
    );
    usePersonsStore.setState({
      persons: [makePerson({ id: 1, name: 'Alice' }), makePerson({ id: 2, name: 'Bob' })],
      isLoading: false, error: null, load: async () => {},
    } as never);
    await createAccountWithBalance({ ...DEFAULT_ACCOUNT, name: 'Alice 401(k)', type: AccountType.ACCOUNT_401K, ownerPersonId: 1 }, 10_000, '2026-09-10');
    await createAccountWithBalance({ ...DEFAULT_ACCOUNT, name: 'Bob 401(k)', type: AccountType.ACCOUNT_401K, ownerPersonId: 2 }, 20_000, '2026-09-10');
    renderMonthly('/monthly?view=p1');
    expect(await screen.findByLabelText('balance for Alice 401(k)')).toBeInTheDocument();
    expect(screen.queryByText('Bob 401(k)')).not.toBeInTheDocument();
    expect(screen.getByText('1 household item hidden by this view is still unconfirmed.')).toBeInTheDocument();
    cleanup();
    renderMonthly('/monthly?view=joint');
    expect(await screen.findByText('Nothing to check in this view.')).toBeInTheDocument();
    expect(screen.getByText('2 household items still awaiting review in other views.')).toBeInTheDocument();
  });

  it('person view after a household save: a saved month-end card is not counted as hidden and unconfirmed', async () => {
    await db.execute(
      `INSERT INTO persons (id, household_id, name, date_of_birth, target_retirement_age, annual_salary_pretax, pretax_401k_pct)
       VALUES (1, 1, 'Alice', '1990-01-01', 65, 0, 0), (2, 1, 'Bob', '1992-01-01', 65, 0, 0)`,
    );
    usePersonsStore.setState({
      persons: [makePerson({ id: 1, name: 'Alice' }), makePerson({ id: 2, name: 'Bob' })],
      isLoading: false, error: null, load: async () => {},
    } as never);
    await createAccountWithBalance({ ...DEFAULT_ACCOUNT, name: 'Alice 401(k)', type: AccountType.ACCOUNT_401K, ownerPersonId: 1 }, 10_000, '2026-09-10');
    await createAccountWithBalance({ ...DEFAULT_ACCOUNT, name: 'Bob 401(k)', type: AccountType.ACCOUNT_401K, ownerPersonId: 2 }, 20_000, '2026-09-10');
    let go: (to: string) => void = () => {};
    function ViewSwitch() {
      go = useNavigate();
      return null;
    }
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={['/monthly']}><ViewSwitch /><MonthlyMiniWindow /></MemoryRouter>);
    await waitFor(() => monthEndSection());
    await saveMonthEnd(user, [['Bob 401(k)', '20500']]);
    // The same mounted page moves to Alice's view: Bob's saved card is hidden, and nothing of his waits.
    act(() => go('/monthly?view=p1'));
    expect(await screen.findByLabelText('balance for Alice 401(k)')).toBeInTheDocument();
    expect(screen.queryByText('Bob 401(k)')).not.toBeInTheDocument();
    expect(screen.queryByText(/hidden by this view/)).not.toBeInTheDocument();
  });

  it('parity: every account the Dashboard row counts has exactly one card on the Monthly check-in', async () => {
    const make = (name: string, type: AccountType) => new AccountsRepo(db).create(makeAccount({ name, type }));
    const repo = new AccountSnapshotsRepo(db);
    const a = await make('Close-day Brokerage', AccountType.ACCOUNT_BROKERAGE);
    await repo.upsert({ accountId: a, snapshotDate: '2026-10-30', totalValue: 40_000, source: SnapshotSource.AUTO_DERIVED });
    const b = await make('Mid-month IRA', AccountType.ACCOUNT_ROTH_IRA);
    await repo.upsert({ accountId: b, snapshotDate: '2026-10-21', totalValue: 25_000, source: SnapshotSource.AUTO_DERIVED });
    const c = await make('Balance-only HSA', AccountType.ACCOUNT_HSA);
    await repo.upsert({ accountId: c, snapshotDate: '2026-08-15', totalValue: 6_000, source: SnapshotSource.MANUAL });
    const d = await make('Confirmed 401(k)', AccountType.ACCOUNT_401K);
    await repo.upsert({ accountId: d, snapshotDate: '2026-09-30', totalValue: 88_000, source: SnapshotSource.USER_CONFIRMED });
    await repo.upsert({ accountId: d, snapshotDate: '2026-10-15', totalValue: 90_000, source: SnapshotSource.MANUAL });
    const e = await make('New 529', AccountType.ACCOUNT_529);
    await repo.upsert({ accountId: e, snapshotDate: '2026-11-02', totalValue: 3_000, source: SnapshotSource.MANUAL });
    await useAccountsStore.getState().load();
    await useSnapshotsStore.getState().load();
    const counted = pendingNow(new Date(2026, 10, 14));
    expect(counted).toEqual([a, b, c]);

    renderMonthly();
    await screen.findByText("Confirm last month's values");
    const names = new Map([[a, 'Close-day Brokerage'], [b, 'Mid-month IRA'], [c, 'Balance-only HSA']]);
    for (const id of counted) expect(screen.getAllByText(new RegExp(`^${names.get(id)!.replace(/[()]/g, '\\$&')}( ·|$)`))).toHaveLength(1);
    expect(screen.queryByText(/^Confirmed 401\(k\)/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^New 529/)).not.toBeInTheDocument();
    cleanup();

    // The Dashboard's row reads the same selector: "confirm 3 balances".
    const noop = async () => {};
    const accounts = useAccountsStore.getState().accounts;
    const snapshots = useSnapshotsStore.getState().snapshots;
    useAccountsStore.setState({ accounts, isLoading: false, error: null, load: noop } as never);
    useSnapshotsStore.setState({ snapshots, isLoading: false, error: null, load: noop } as never);
    for (const [store, key] of [
      [useGoalsStore, 'goals'], [useContributionsStore, 'contributions'], [useLoansStore, 'loans'],
      [usePropertiesStore, 'properties'], [useVehiclesStore, 'vehicles'], [useTransactionsStore, 'transactions'],
      [useCategoriesStore, 'categories'], [useAssetValueSnapshotsStore, 'assetValueSnapshots'],
      [useHoldingsStore, 'holdings'], [useTickersStore, 'tickers'], [useFundHoldingsStore, 'fundHoldings'],
    ] as const) {
      (store as unknown as { setState: (s: object) => void }).setState({ [key]: [], isLoading: false, error: null, load: noop });
    }
    useRoadmapOverridesStore.setState({ overridesByNodeId: new Map(), isLoading: false, error: null, load: noop } as never);
    useHouseholdStore.setState({
      household: {
        filingStatus: FilingStatus.MFJ, state: 'CA', city: null, monthlyExpenseBaseline: 5000, withdrawalRate: 0.04,
        inflationAssumption: 0.03, growthScenarios: [{ label: 'Moderate', rate: 0.06 }],
      },
      isLoading: false, error: null, load: noop,
    } as never);
    useSettingsStore.setState({
      settings: { id: 1, lastRefreshAt: null, refreshCadence: 'EVERY_LAUNCH', lastSeenMonth: null, lastVisitDate: null, briefingBaselineDate: null },
      isLoading: false, error: null, load: noop, update: noop,
    } as never);
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(within(await screen.findByTestId('briefing-card')).getByText('Close October — confirm 3 balances.')).toBeInTheDocument();
  });
});
