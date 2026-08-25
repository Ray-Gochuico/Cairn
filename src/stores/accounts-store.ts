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

/** What the canonical AccountForm actually collects: everything except
 *  hasHighFees (roadmap-node-owned, no form field). */
type AccountCreateWithAnswersInput = Omit<Account, 'id' | 'hasHighFees'>;

interface AccountsState {
  accounts: Account[];
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (account: AccountCreateInput) => Promise<number>;
  /** Create AND persist the four chart answers the form collects
   *  (create → update, self-cleaning — the accounts-gate m3 sequence,
   *  now shared by every UI entry path; Wave A item 2 / D-WA2/D-WA3).
   *  Plain create() keeps its chart-answer-free contract for imports. */
  createWithAnswers: (values: AccountCreateWithAnswersInput) => Promise<number>;
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

  createWithAnswers: async (values) => {
    const id = await get().create(values);
    try {
      await get().update(id, {
        hasEmployerMatch: values.hasEmployerMatch,
        employerMatchPct: values.employerMatchPct,
        employerMatchLimitPct: values.employerMatchLimitPct,
        allowsMegaBackdoorRollover: values.allowsMegaBackdoorRollover,
      });
    } catch (err) {
      // Self-cleaning (accounts-gate review m3): a stranded match-less row
      // would duplicate on retry. Best-effort remove, original error wins.
      try {
        await get().remove(id);
      } catch {
        // The original failure is the one worth surfacing.
      }
      throw err;
    }
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
