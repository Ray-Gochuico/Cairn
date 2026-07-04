import { create } from 'zustand';
import { AccountsRepo } from '@/domain/accounts';
import { getDatabase } from '@/db/db';
import { createDedupedLoad } from '@/stores/create-entity-store';
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

export const useAccountsStore = create<AccountsState>((set, get) => ({
  accounts: [],
  isLoading: false,
  error: null,

  // Shared de-duped load (see create-entity-store.ts for semantics + the
  // accepted initial-mount TOCTOU). De-dupe matters here because the
  // always-mounted sidebar pending-dot hook load()s this store alongside
  // every page that reads accounts.
  load: createDedupedLoad<AccountsState, 'accounts'>(set, 'accounts', async () =>
    new AccountsRepo(getDatabase()).list(),
  ),

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
