import { create } from 'zustand';
import { AccountSnapshotsRepo } from '@/domain/snapshots';
import { getDatabase } from '@/db/db';
import { AccountSnapshotSchema, type AccountSnapshot } from '@/types/schema';
import type { SnapshotSource } from '@/types/enums';

interface SnapshotsState {
  snapshots: AccountSnapshot[];
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  upsert: (snapshot: Omit<AccountSnapshot, 'id'>) => Promise<number>;
  remove: (id: number) => Promise<void>;
}

interface SnapshotRow {
  id: number;
  account_id: number;
  snapshot_date: string;
  total_value: number;
  source: SnapshotSource;
}

/**
 * Snapshots use upsert (not create) because AccountSnapshotsRepo enforces a
 * unique (account_id, snapshot_date) constraint — re-deriving a month or
 * confirming a derived value flows through the same insert-or-update path.
 *
 * Loads ALL snapshots across every account; per-account or per-month scoping
 * happens in memory or directly via AccountSnapshotsRepo.
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
    const id = await repo.upsert(snapshot);
    await get().load();
    return id;
  },

  remove: async (id) => {
    const repo = new AccountSnapshotsRepo(getDatabase());
    await repo.delete(id);
    await get().load();
  },
}));
