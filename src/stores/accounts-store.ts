import { create } from 'zustand';
import { AccountsRepo } from '@/domain/accounts';
import { getDatabase } from '@/db/db';
import type { Account } from '@/types/schema';

// Roadmap chart-answer columns are owned by roadmap decision nodes, not
// the account CRUD form. Accept the narrower shape here and default
// them to null on the way to the repo.
type AccountCreateInput = Omit<
  Account,
  | 'id'
  | 'hasEmployerMatch'
  | 'employerMatchPct'
  | 'employerMatchLimitPct'
  | 'allowsMegaBackdoorRollover'
  | 'hasHighFees'
>;

interface AccountsState {
  accounts: Account[];
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (account: AccountCreateInput) => Promise<number>;
  update: (id: number, patch: Partial<Omit<Account, 'id' | 'householdId'>>) => Promise<void>;
  remove: (id: number) => Promise<void>;
}

/**
 * In-flight de-dupe: if a load() is already in progress, return its promise
 * instead of starting a second DB round-trip. Cleared after settle so later
 * load() calls (after a CRUD mutation) still re-fetch. Same pattern as
 * snapshots-store / loans-store; matters here because the always-mounted
 * sidebar pending-dot hook load()s this store alongside every page that
 * reads accounts.
 */
let accountsInflight: Promise<void> | null = null;

export const useAccountsStore = create<AccountsState>((set, get) => ({
  accounts: [],
  isLoading: false,
  error: null,

  load: async () => {
    if (accountsInflight) return accountsInflight;
    accountsInflight = (async () => {
      set({ isLoading: true, error: null });
      try {
        const repo = new AccountsRepo(getDatabase());
        const accounts = await repo.list();
        set({ accounts, isLoading: false });
      } catch (e) {
        set({ isLoading: false, error: e instanceof Error ? e.message : 'Failed to load' });
      } finally {
        accountsInflight = null;
      }
    })();
    return accountsInflight;
  },

  create: async (account) => {
    const repo = new AccountsRepo(getDatabase());
    const id = await repo.create({
      ...account,
      hasEmployerMatch: null,
      employerMatchPct: null,
      employerMatchLimitPct: null,
      allowsMegaBackdoorRollover: null,
      hasHighFees: null,
    });
    await get().load();
    return id;
  },

  update: async (id, patch) => {
    const repo = new AccountsRepo(getDatabase());
    await repo.update(id, patch);
    await get().load();
  },

  remove: async (id) => {
    const repo = new AccountsRepo(getDatabase());
    await repo.delete(id);
    await get().load();
  },
}));
