import { create } from 'zustand';
import { ContributionsRepo } from '@/domain/contributions';
import { getDatabase } from '@/db/db';
import { ContributionSchema, type Contribution } from '@/types/schema';
import type { ContributionSource } from '@/types/enums';

interface ContributionsState {
  contributions: Contribution[];
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (contribution: Omit<Contribution, 'id'>) => Promise<number>;
  update: (id: number, patch: Partial<Omit<Contribution, 'id' | 'accountId'>>) => Promise<void>;
  remove: (id: number) => Promise<void>;
}

interface ContributionRow {
  id: number;
  account_id: number;
  person_id: number | null;
  date: string;
  amount: number;
  source: ContributionSource;
}

/**
 * Loads ALL contributions across every account. Per-account scoping is the
 * responsibility of the consumer (ContributionsTab, Investments page).
 * Components that need a SQL-level filter call ContributionsRepo directly.
 *
 * ContributionsRepo intentionally doesn't expose a listAll() (per plan
 * scoping — it lists per account or per person+month-range). The store
 * runs an unscoped query here to populate the cache for in-memory filtering.
 */
export const useContributionsStore = create<ContributionsState>((set, get) => ({
  contributions: [],
  isLoading: false,
  error: null,

  load: async () => {
    set({ isLoading: true, error: null });
    try {
      const rows = await getDatabase().select<ContributionRow>(
        'SELECT * FROM contributions ORDER BY date ASC, id ASC'
      );
      const contributions = rows.map((r) =>
        ContributionSchema.parse({
          id: r.id,
          accountId: r.account_id,
          personId: r.person_id,
          date: r.date,
          amount: r.amount,
          source: r.source,
        })
      );
      set({ contributions, isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: e instanceof Error ? e.message : 'Failed to load' });
    }
  },

  create: async (contribution) => {
    const repo = new ContributionsRepo(getDatabase());
    const id = await repo.create(contribution);
    await get().load();
    return id;
  },

  update: async (id, patch) => {
    const repo = new ContributionsRepo(getDatabase());
    await repo.update(id, patch);
    await get().load();
  },

  remove: async (id) => {
    const repo = new ContributionsRepo(getDatabase());
    await repo.delete(id);
    await get().load();
  },
}));
