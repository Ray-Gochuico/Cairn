/**
 * C003 (v1.8.0 W4): the Monthly check-in's balance and value boxes start
 * empty, so a figure typed after a click is the figure saved (a prefilled
 * box glued it onto the old one: 12000 typed into 12000 saved
 * $1,200,012,000, and a cents balance swallowed the new figure). The last
 * figure stays beside the question. Real page, real stores, an all-migrations
 * in-memory DB; only Date is faked, to the literal local day 2026-11-14
 * (last month's close: 2026-10-30).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useLoansStore } from '@/stores/loans-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import { AccountsRepo } from '@/domain/accounts';
import { AccountSnapshotsRepo } from '@/domain/snapshots';
import { PropertiesRepo } from '@/domain/properties';
import { VehiclesRepo } from '@/domain/vehicles';
import { createAccountWithBalance } from '@/domain/setup-flow/steps/accounts-gate';
import { DEFAULT_ACCOUNT } from '@/lib/entity-scaffolds';
import { AccountType, SnapshotSource } from '@/types/enums';
import MonthlyMiniWindow from '@/pages/MonthlyMiniWindow';
import { UpdateAccountBalanceDialog } from '@/components/dialogs/UpdateAccountBalanceDialog';
import AccountBalanceHistory from '@/components/investments/manage/AccountBalanceHistory';
import { makeAccount, makeProperty, makeVehicle } from '../factories';

const TODAY = '2026-11-14';
const OCT_CLOSE = '2026-10-30';

const real = {
  accLoad: useAccountsStore.getState().load,
  snapLoad: useSnapshotsStore.getState().load,
  snapUpsert: useSnapshotsStore.getState().upsert,
  loanLoad: useLoansStore.getState().load,
  propLoad: usePropertiesStore.getState().load,
  propUpdate: usePropertiesStore.getState().update,
  vehLoad: useVehiclesStore.getState().load,
  vehUpdate: useVehiclesStore.getState().update,
  avsLoad: useAssetValueSnapshotsStore.getState().load,
};

type Row = { snapshot_date: string; total_value: number; source: string };
let db: SqliteAdapter;

const rowsFor = async (accountId: number) =>
  (await db.select<Row>(
    'SELECT snapshot_date, total_value, source FROM account_snapshots WHERE account_id = ? ORDER BY snapshot_date',
    [accountId],
  )).map((r) => [r.snapshot_date, r.total_value, r.source]);

async function seedCash(name: string, type: AccountType, date: string, value: number): Promise<number> {
  const id = await new AccountsRepo(db).create(makeAccount({ name, type }));
  await new AccountSnapshotsRepo(db).upsert({ accountId: id, snapshotDate: date, totalValue: value, source: SnapshotSource.MANUAL });
  return id;
}

function renderPage() {
  render(<MemoryRouter><MonthlyMiniWindow /></MemoryRouter>);
}

describe('C003: the Monthly check-in boxes start empty', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(`${TODAY}T12:00:00`));
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    useAccountsStore.setState({ accounts: [], isLoading: false, error: null, load: real.accLoad } as never);
    useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null, load: real.snapLoad, upsert: real.snapUpsert } as never);
    useLoansStore.setState({ loans: [], isLoading: false, error: null, load: real.loanLoad } as never);
    usePropertiesStore.setState({ properties: [], isLoading: false, error: null, load: real.propLoad, update: real.propUpdate } as never);
    useVehiclesStore.setState({ vehicles: [], isLoading: false, error: null, load: real.vehLoad, update: real.vehUpdate } as never);
    useAssetValueSnapshotsStore.setState({ assetValueSnapshots: [], isLoading: false, error: null, load: real.avsLoad } as never);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await db.close();
  });

  it('the balance box renders empty, with "(Last entered: $12,000.00)" still beside the question', async () => {
    await seedCash('Joint Checking', AccountType.ACCOUNT_CASH, '2026-10-31', 12000);
    renderPage();
    const input = (await screen.findByLabelText('balance for Joint Checking')) as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('0.00');
    expect(screen.getByText('(Last entered: $12,000.00)')).toBeInTheDocument();
  });

  it('setup-day $12,000 (the real setup gate): click, type 12000, Save → today\'s row is 12000', async () => {
    const id = await createAccountWithBalance({ ...DEFAULT_ACCOUNT, name: 'Joint Checking', type: AccountType.ACCOUNT_CASH }, 12000, TODAY);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByLabelText('balance for Joint Checking'));
    await user.keyboard('12000');
    await user.click(screen.getByRole('button', { name: 'Save Joint Checking balance' }));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(await rowsFor(id)).toEqual([[TODAY, 12000, 'MANUAL']]);
  });

  it('Oct-31 $12,000: click, type 12500, Save → Oct-31 kept, Nov-14 12500', async () => {
    const id = await seedCash('Joint Checking', AccountType.ACCOUNT_CASH, '2026-10-31', 12000);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByLabelText('balance for Joint Checking'));
    await user.keyboard('12500');
    await user.click(screen.getByRole('button', { name: 'Save Joint Checking balance' }));
    await screen.findByText('Saved');
    expect(await rowsFor(id)).toEqual([['2026-10-31', 12000, 'MANUAL'], [TODAY, 12500, 'MANUAL']]);
  });

  it('a cents balance ($15,234.56): click, type 15400, Save → 15400 lands, not 15234.56154', async () => {
    const id = await seedCash('Savings', AccountType.ACCOUNT_SAVINGS, '2026-10-31', 15234.56);
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByLabelText('balance for Savings'));
    await user.keyboard('15400');
    await user.click(screen.getByRole('button', { name: 'Save Savings balance' }));
    await screen.findByText('Saved');
    expect(await rowsFor(id)).toEqual([['2026-10-31', 15234.56, 'MANUAL'], [TODAY, 15400, 'MANUAL']]);
  });

  it('a click mid-field then 12500 → 12500', async () => {
    const id = await seedCash('Wallet', AccountType.ACCOUNT_CRYPTO, '2026-10-31', 12000);
    const user = userEvent.setup();
    renderPage();
    const input = await screen.findByLabelText('balance for Wallet');
    await user.pointer([{ target: input, offset: 2, keys: '[MouseLeft]' }]);
    await user.keyboard('12500');
    await user.click(screen.getByRole('button', { name: 'Save Wallet balance' }));
    await screen.findByText('Saved');
    expect(await rowsFor(id)).toEqual([['2026-10-31', 12000, 'MANUAL'], [TODAY, 12500, 'MANUAL']]);
  });

  it('property $650,000: the value box renders empty; click, type 655000, Save → estimate and today\'s value 655000', async () => {
    const pid = await new PropertiesRepo(db).create(makeProperty({ name: 'Home', currentEstimatedValue: 650000 }));
    const user = userEvent.setup();
    renderPage();
    const input = (await screen.findByLabelText('value for Home')) as HTMLInputElement;
    expect(input.value).toBe('');
    expect(screen.getByText('($650,000.00)')).toBeInTheDocument();
    await user.click(input);
    await user.keyboard('655000');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Updated');
    expect(await db.select('SELECT current_estimated_value FROM properties WHERE id = ?', [pid]))
      .toEqual([{ current_estimated_value: 655000 }]);
    expect(await db.select("SELECT snapshot_date, value FROM asset_value_snapshots WHERE owner_type = 'PROPERTY' AND owner_id = ?", [pid]))
      .toEqual([{ snapshot_date: TODAY, value: 655000 }]);
  });

  it('vehicle $18,500: click, type 17900, Save → 17900', async () => {
    const vid = await new VehiclesRepo(db).create(makeVehicle({ name: 'Car', currentEstimatedValue: 18500 }));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByLabelText('value for Car'));
    await user.keyboard('17900');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Updated');
    expect(await db.select('SELECT current_estimated_value FROM vehicles WHERE id = ?', [vid]))
      .toEqual([{ current_estimated_value: 17900 }]);
  });

  it('an untouched Save on the balance box and on the value box says "Enter a number" and writes nothing', async () => {
    const id = await seedCash('Joint Checking', AccountType.ACCOUNT_CASH, '2026-10-31', 12000);
    const pid = await new PropertiesRepo(db).create(makeProperty({ name: 'Home', currentEstimatedValue: 650000 }));
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Save Joint Checking balance' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getAllByRole('alert').map((a) => a.textContent)).toEqual(['Enter a number', 'Enter a number']));
    expect(await rowsFor(id)).toEqual([['2026-10-31', 12000, 'MANUAL']]);
    expect(await db.select('SELECT current_estimated_value FROM properties WHERE id = ?', [pid]))
      .toEqual([{ current_estimated_value: 650000 }]);
  });

  it('derived Oct close $48,213.55: Edit opens an empty box; click, type 48500, Save → USER_CONFIRMED 48500', async () => {
    const id = await new AccountsRepo(db).create(makeAccount({ name: 'Brokerage One', type: AccountType.ACCOUNT_BROKERAGE }));
    await new AccountSnapshotsRepo(db).upsert({ accountId: id, snapshotDate: OCT_CLOSE, totalValue: 48213.55, source: SnapshotSource.AUTO_DERIVED });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Edit Brokerage One' }));
    const input = screen.getByLabelText('override value for Brokerage One') as HTMLInputElement;
    expect(input.value).toBe('');
    await user.click(input);
    await user.keyboard('48500');
    await user.click(screen.getByRole('button', { name: 'Save Brokerage One' }));
    expect(await screen.findByText(/✓ Confirmed/)).toBeInTheDocument();
    expect(await rowsFor(id)).toEqual([[OCT_CLOSE, 48500, 'USER_CONFIRMED']]);
  });

  it('Edit → type → Cancel → Edit opens the box empty again', async () => {
    const id = await new AccountsRepo(db).create(makeAccount({ name: 'Brokerage One', type: AccountType.ACCOUNT_BROKERAGE }));
    await new AccountSnapshotsRepo(db).upsert({ accountId: id, snapshotDate: OCT_CLOSE, totalValue: 48213.55, source: SnapshotSource.AUTO_DERIVED });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Edit Brokerage One' }));
    await user.type(screen.getByLabelText('override value for Brokerage One'), '123');
    await user.click(screen.getByRole('button', { name: 'Cancel editing Brokerage One' }));
    await user.click(screen.getByRole('button', { name: 'Edit Brokerage One' }));
    expect((screen.getByLabelText('override value for Brokerage One') as HTMLInputElement).value).toBe('');
  });

  it('controls: Tab into the box and type, or clear and type, saves the typed figure', async () => {
    const a = await seedCash('Joint Checking', AccountType.ACCOUNT_CASH, '2026-10-31', 12000);
    const b = await seedCash('Savings', AccountType.ACCOUNT_SAVINGS, '2026-10-31', 9000);
    const user = userEvent.setup();
    renderPage();
    const first = (await screen.findByLabelText('balance for Joint Checking')) as HTMLInputElement;
    for (let i = 0; i < 12 && document.activeElement !== first; i++) await user.tab();
    expect(document.activeElement).toBe(first);
    await user.keyboard('12500');
    await user.click(screen.getByRole('button', { name: 'Save Joint Checking balance' }));
    await user.clear(screen.getByLabelText('balance for Savings'));
    await user.type(screen.getByLabelText('balance for Savings'), '9100');
    await user.click(screen.getByRole('button', { name: 'Save Savings balance' }));
    await waitFor(() => expect(screen.getAllByText('Saved')).toHaveLength(2));
    expect(await rowsFor(a)).toEqual([['2026-10-31', 12000, 'MANUAL'], [TODAY, 12500, 'MANUAL']]);
    expect(await rowsFor(b)).toEqual([['2026-10-31', 9000, 'MANUAL'], [TODAY, 9100, 'MANUAL']]);
  });

  it('house precedent (unchanged): the Update balance dialog opens with an empty amount', async () => {
    const id = await seedCash('Joint Checking', AccountType.ACCOUNT_CASH, '2026-10-31', 12000);
    render(<UpdateAccountBalanceDialog open onOpenChange={() => {}} accountId={id} accountName="Joint Checking" />);
    expect(((await screen.findByLabelText('Current balance')) as HTMLInputElement).value).toBe('');
  });

  // The two recovery controls the route keeps (C003-impact I4, I5): green
  // before and after, so the release note's "Delete removes one" stays true.
  it('control: a same-day re-save replaces the day\'s row in place', async () => {
    const id = await seedCash('Joint Checking', AccountType.ACCOUNT_CASH, '2026-10-31', 12000);
    await new AccountSnapshotsRepo(db).upsert({ accountId: id, snapshotDate: TODAY, totalValue: 1200012500, source: SnapshotSource.MANUAL });
    const user = userEvent.setup();
    renderPage();
    await user.tripleClick(await screen.findByLabelText('balance for Joint Checking'));
    await user.keyboard('12500');
    await user.click(screen.getByRole('button', { name: 'Save Joint Checking balance' }));
    await screen.findByText('Saved');
    expect(await rowsFor(id)).toEqual([['2026-10-31', 12000, 'MANUAL'], [TODAY, 12500, 'MANUAL']]);
  });

  it('control: Balance history Delete removes one saved row and keeps last month\'s', async () => {
    const id = await seedCash('Joint Checking', AccountType.ACCOUNT_CASH, '2026-10-31', 12000);
    await new AccountSnapshotsRepo(db).upsert({ accountId: id, snapshotDate: TODAY, totalValue: 1200012500, source: SnapshotSource.MANUAL });
    const user = userEvent.setup();
    render(<AccountBalanceHistory accountId={id} accountName="Joint Checking" />);
    await user.click(await screen.findByText(/Balance history \(2\)/));
    await user.click(await screen.findByRole('button', { name: `Delete Joint Checking snapshot ${TODAY}` }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(async () => expect(await rowsFor(id)).toEqual([['2026-10-31', 12000, 'MANUAL']]));
  });
});
