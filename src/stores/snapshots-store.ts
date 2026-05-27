import { create } from 'zustand';
import { AccountSnapshotsRepo } from '@/domain/snapshots';
import { AccountsRepo } from '@/domain/accounts';
import { HoldingsRepo } from '@/domain/holdings';
import { getDatabase } from '@/db/db';
import { AccountSnapshotSchema, type AccountSnapshot } from '@/types/schema';
import type { SnapshotSource } from '@/types/enums';
import { PriceCache } from '@/market/price-cache';
import { YahooClient } from '@/market/yahoo-client';
import { deriveLast12Months } from '@/market/snapshot-derivation';

interface SnapshotsState {
  snapshots: AccountSnapshot[];
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  upsert: (snapshot: Omit<AccountSnapshot, 'id'>) => Promise<number>;
  remove: (id: number) => Promise<void>;
  /**
   * Re-derive last-12-months snapshots and reload. User-triggered (e.g. via
   * the Monthly mini-window's Refresh prices button), so it awaits derivation
   * and rethrows on failure — different from load(), which absorbs errors.
   */
  refresh: () => Promise<void>;
}

interface SnapshotRow {
  id: number;
  account_id: number;
  snapshot_date: string;
  total_value: number;
  source: SnapshotSource;
}

let nextTempId = -1;
const allocTempId = () => nextTempId--;

/**
 * Sort by snapshot_date asc, then id asc — mirrors the SELECT ordering in
 * load() below so the optimistic insert path produces the same final array
 * as a full reload would.
 */
function sortSnapshots(rows: AccountSnapshot[]): AccountSnapshot[] {
  return [...rows].sort((a, b) => {
    if (a.snapshotDate !== b.snapshotDate) {
      return a.snapshotDate < b.snapshotDate ? -1 : 1;
    }
    return (a.id ?? 0) - (b.id ?? 0);
  });
}

/**
 * Snapshots use upsert (not create) because AccountSnapshotsRepo enforces a
 * unique (account_id, snapshot_date) constraint — re-deriving a month or
 * confirming a derived value flows through the same insert-or-update path.
 *
 * Loads ALL snapshots across every account; per-account or per-month scoping
 * happens in memory or directly via AccountSnapshotsRepo.
 *
 * Optimistic updates: upsert/remove apply the change to the local array
 * synchronously and roll back on DB failure, eliminating the post-write
 * full-table SELECT that previously kicked every subscriber on every edit.
 */
export const useSnapshotsStore = create<SnapshotsState>((set, get) => ({
  snapshots: [],
  isLoading: false,
  error: null,

  load: async () => {
    set({ isLoading: true, error: null });
    try {
      const rows = await getDatabase().select<SnapshotRow>(
        'SELECT * FROM account_snapshots ORDER BY snapshot_date ASC, id ASC'
      );
      const snapshots = rows.map((r) =>
        AccountSnapshotSchema.parse({
          id: r.id,
          accountId: r.account_id,
          snapshotDate: r.snapshot_date,
          totalValue: r.total_value,
          source: r.source,
        })
      );
      set({ snapshots, isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: e instanceof Error ? e.message : 'Failed to load' });
    }
  },

  upsert: async (snapshot) => {
    const repo = new AccountSnapshotsRepo(getDatabase());
    const current = get().snapshots;
    // Determine whether this is an insert or an update by the natural key
    // (accountId, snapshotDate). If a matching row exists, replace it in
    // memory; otherwise append a temp-id row.
    const existingIdx = current.findIndex(
      (s) =>
        s.accountId === snapshot.accountId &&
        s.snapshotDate === snapshot.snapshotDate,
    );
    const tempId = existingIdx >= 0 ? current[existingIdx].id! : allocTempId();
    const optimistic: AccountSnapshot = { ...snapshot, id: tempId };
    const nextArr = [...current];
    if (existingIdx >= 0) {
      nextArr[existingIdx] = optimistic;
    } else {
      nextArr.push(optimistic);
    }
    set({ snapshots: sortSnapshots(nextArr) });
    try {
      const realId = await repo.upsert(snapshot);
      // For inserts, swap the temp ID for the real one. For updates, the
      // ID is already correct (existingIdx path used the real id above).
      if (tempId !== realId) {
        set({
          snapshots: sortSnapshots(
            get().snapshots.map((s) =>
              s.id === tempId ? { ...s, id: realId } : s,
            ),
          ),
        });
      }
      return realId;
    } catch (e) {
      // Rollback: restore the original snapshot array.
      set({ snapshots: current });
      throw e;
    }
  },

  remove: async (id) => {
    const repo = new AccountSnapshotsRepo(getDatabase());
    const prev = get().snapshots;
    const target = prev.find((s) => s.id === id);
    set({ snapshots: prev.filter((s) => s.id !== id) });
    try {
      await repo.delete(id);
    } catch (e) {
      // Restore: re-insert and re-sort (target may have been the only
      // row at that date so position matters).
      if (target) {
        set({ snapshots: sortSnapshots([...get().snapshots, target]) });
      }
      throw e;
    }
  },

  refresh: async () => {
    const db = getDatabase();
    const accounts = new AccountsRepo(db);
    const holdings = new HoldingsRepo(db);
    const snapshots = new AccountSnapshotsRepo(db);
    const prices = new PriceCache(db, new YahooClient());
    await deriveLast12Months({ accounts, holdings, snapshots, prices });
    await get().load();
  },
}));
