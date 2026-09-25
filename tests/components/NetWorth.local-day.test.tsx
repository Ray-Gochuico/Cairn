import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { usePropertiesStore } from '@/stores/properties-store';
import { useVehiclesStore } from '@/stores/vehicles-store';
import { useLoansStore } from '@/stores/loans-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useAssetValueSnapshotsStore } from '@/stores/asset-value-snapshots-store';
import { AccountsRepo } from '@/domain/accounts';
import { AccountSnapshotsRepo } from '@/domain/snapshots';
import { AccountType, SnapshotSource } from '@/types/enums';
import NetWorth from '@/pages/NetWorth';

// Its own file, so no other test's store state can reach it. (Appended to
// NetWorth.test.tsx these arms first failed because a test there stubbed the
// snapshots store's `load` and never restored it, so every later mount loaded
// no snapshots; that file now restores its stubs after each test.) Harness
// mirrors NetWorth.test.tsx (real in-memory DB, the page's own hydration).
function resetStores() {
  useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null });
  usePropertiesStore.setState({ properties: [], isLoading: false, error: null });
  useVehiclesStore.setState({ vehicles: [], isLoading: false, error: null });
  useLoansStore.setState({ loans: [], isLoading: false, error: null });
  useAccountsStore.setState({ accounts: [], isLoading: false, error: null });
  usePersonsStore.setState({ persons: [], isLoading: false, error: null });
  useAssetValueSnapshotsStore.setState({ assetValueSnapshots: [], isLoading: false, error: null });
}

async function seedAccount(db: SqliteAdapter, name: string): Promise<number> {
  return new AccountsRepo(db).create({
    householdId: 1, ownerPersonId: null, beneficiaryDependentId: null, name,
    institution: null, type: AccountType.ACCOUNT_BROKERAGE, cryptoWalletAddress: null,
    autoFetchEnabled: false, excludedFromNetWorth: false, stateOfPlan: null, accentColor: null,
  });
}

async function seedSnapshot(db: SqliteAdapter, accountId: number, snapshotDate: string, totalValue: number) {
  await new AccountSnapshotsRepo(db).upsert({
    accountId, snapshotDate, totalValue, source: SnapshotSource.USER_CONFIRMED,
  });
}

// v1.7.0 R4 smoke (reader half): the growth card's "Now" is the latest value
// on or before today, and the page handed computeHorizonGrowth a LOCAL-midnight
// Date that it reads through UTC accessors — the PREVIOUS day east of UTC, so
// an Auckland balance entered today never reached "Now". The page now hands
// it the local day's UTC-noon bridge. The New York arm guards the west (where
// the old anchor already agreed) against a UTC-day-of-the-instant anchor,
// which would count a row dated the next local day.
describe('NetWorth — the growth card reads the LOCAL day', () => {
  const ORIGINAL_TZ = process.env.TZ;
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);
    resetStores();
    vi.useFakeTimers({ toFake: ['Date'] });
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
    await db.close();
  });

  // A year-old row gives every horizon a baseline, so the context line renders.
  async function growthNowWith(rows: Array<[string, number]>): Promise<HTMLElement> {
    const accountId = await seedAccount(db, 'Schwab');
    for (const [date, value] of rows) await seedSnapshot(db, accountId, date, value);
    render(
      <MemoryRouter>
        <NetWorth />
      </MemoryRouter>,
    );
    await screen.findByText('Net worth growth', {}, { timeout: 5000 });
    return screen.findByTestId('growth-context', {}, { timeout: 5000 });
  }

  it('Pacific/Auckland, 09:00 NZST (21:00 UTC the previous day): Now is the local 25th\'s balance', async () => {
    process.env.TZ = 'Pacific/Auckland';
    vi.setSystemTime(new Date('2026-09-24T21:00:00Z'));
    const context = await growthNowWith([['2025-09-01', 90_000], ['2026-09-20', 100_000], ['2026-09-25', 120_000]]);
    await waitFor(() => expect(context).toHaveTextContent('Now $120,000'));
  });

  it('New York, 23:33 EDT (03:33 UTC the next day): Now is the local 24th\'s balance, not the next day\'s', async () => {
    process.env.TZ = 'America/New_York';
    vi.setSystemTime(new Date('2026-09-25T03:33:00Z'));
    const context = await growthNowWith([['2025-09-01', 90_000], ['2026-09-20', 100_000], ['2026-09-24', 120_000], ['2026-09-25', 150_000]]);
    await waitFor(() => expect(context).toHaveTextContent('Now $120,000'));
  });
});
