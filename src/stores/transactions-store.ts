import { create } from 'zustand';
import { TransactionsRepo } from '@/domain/transactions';
import { getDatabase } from '@/db/db';
import { detectRecurring } from '@/lib/recurring';
import type { Transaction, Category } from '@/types/schema';

interface TransactionsState {
  transactions: Transaction[];
  isLoading: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (t: Omit<Transaction, 'id'>) => Promise<number>;
  createMany: (rows: Array<Omit<Transaction, 'id'>>) => Promise<number[]>;
  update: (id: number, patch: Partial<Omit<Transaction, 'id' | 'householdId'>>) => Promise<void>;
  remove: (id: number) => Promise<void>;
  setRecurring: (ids: number[], value: boolean) => Promise<void>;
  syncRecurring: (categories: Category[]) => Promise<void>;
}

export const useTransactionsStore = create<TransactionsState>((set, get) => ({
  transactions: [],
  isLoading: false,
  error: null,

  load: async () => {
    set({ isLoading: true, error: null });
    try {
      const repo = new TransactionsRepo(getDatabase());
      const transactions = await repo.list();
      set({ transactions, isLoading: false });
    } catch (e) {
      set({ isLoading: false, error: e instanceof Error ? e.message : 'Failed to load' });
    }
  },

  create: async (t) => {
    const repo = new TransactionsRepo(getDatabase());
    const id = await repo.create(t);
    await get().load();
    return id;
  },

  createMany: async (rows) => {
    const repo = new TransactionsRepo(getDatabase());
    const ids = await repo.createMany(rows);
    await get().load();
    return ids;
  },

  update: async (id, patch) => {
    const repo = new TransactionsRepo(getDatabase());
    await repo.update(id, patch);
    await get().load();
  },

  remove: async (id) => {
    const repo = new TransactionsRepo(getDatabase());
    await repo.delete(id);
    await get().load();
  },

  setRecurring: async (ids, value) => {
    const repo = new TransactionsRepo(getDatabase());
    await repo.setRecurring(ids, value);
    await get().load();
  },

  syncRecurring: async (categories: Category[]) => {
    const repo = new TransactionsRepo(getDatabase());
    const txns = get().transactions;
    const recurringIds = new Set(
      detectRecurring(txns, categories).flatMap((g) => g.transactionIds),
    );
    const toTrue = txns
      .filter((t) => t.id != null && recurringIds.has(t.id) && !t.isRecurring)
      .map((t) => t.id as number);
    const toFalse = txns
      .filter((t) => t.id != null && !recurringIds.has(t.id) && t.isRecurring)
      .map((t) => t.id as number);
    if (toTrue.length) await repo.setRecurring(toTrue, true);
    if (toFalse.length) await repo.setRecurring(toFalse, false);
    if (toTrue.length || toFalse.length) await get().load();
  },
}));
