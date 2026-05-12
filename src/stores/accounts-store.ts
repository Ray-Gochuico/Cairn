import { create } from 'zustand';
import { AccountsRepo } from '@/domain/accounts';
import { getDatabase } from '@/db/db';
import type { Account } from '@/types/schema';

interface AccountsState {
  accounts: Account[];
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (account: Omit<Account, 'id'>) => Promise<number>;
  update: (id: number, patch: Partial<Omit<Account, 'id' | 'householdId'>>) => Promise<void>;
  remove: (id: number) => Promise<void>;
}

export const useAccountsStore = create<AccountsState>((set, get) => ({
  accounts: [],
  isLoading: false,
  error: null,

  load: async () => {
    set({ isLoading: true, error: null });
    try {
      const repo = new AccountsRepo(getDatabase());
      const accounts = await repo.list();
      set({ accounts, isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: e instanceof Error ? e.message : 'Failed to load' });
    }
  },

  create: async (account) => {
    const repo = new AccountsRepo(getDatabase());
    const id = await repo.create(account);
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
