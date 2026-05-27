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

// Counter for temporary IDs used while an optimistic create is in flight.
// Negative IDs are safe because SQLite AUTOINCREMENT only ever returns
// positive integers — a temp row is unambiguously "not yet persisted".
// Decremented per allocation so concurrent creates don't collide.
let nextTempId = -1;
const allocTempId = () => nextTempId--;

/**
 * Sort by date desc, then id desc — mirrors `TransactionsRepo.list()`'s
 * `ORDER BY date DESC, id DESC`. We resort after each optimistic mutation
 * so the UI sees the same ordering it would after a reload, without
 * paying the SQL round-trip.
 */
function sortTransactions(rows: Transaction[]): Transaction[] {
  return [...rows].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    const aid = a.id ?? 0;
    const bid = b.id ?? 0;
    return bid - aid;
  });
}

/**
 * Optimistic CUD pattern: apply the change to local state synchronously,
 * THEN await the DB write. On success, swap the temp row for the real one
 * (create) or no-op (update/remove). On failure, restore the pre-write
 * snapshot and rethrow so the caller can show row-level error UI.
 *
 * This replaces the previous `await repo.x(); await get().load();` shape,
 * which did a full SELECT + every-row re-render after each single-row
 * write — at 10k+ rows that's 60-120ms keystroke lag.
 */
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
    // Optimistic insert: append a temp-id row immediately so the UI sees
    // the change without waiting for the DB. importedAt is also set by
    // the DB but TransactionSchema requires it, so we approximate with
    // now() — the value will be overwritten with the real DB row below.
    const tempId = allocTempId();
    const optimistic: Transaction = {
      ...t,
      id: tempId,
      importedAt: t.importedAt ?? new Date().toISOString(),
    } as Transaction;
    set({
      transactions: sortTransactions([...get().transactions, optimistic]),
    });
    try {
      const realId = await repo.create(t);
      // Swap the temp row for the real persisted row (read-back gives us
      // the canonical importedAt and any DB-side defaults).
      const persisted = await repo.findById(realId);
      set({
        transactions: sortTransactions(
          get().transactions.map((row) =>
            row.id === tempId ? (persisted ?? { ...optimistic, id: realId }) : row,
          ),
        ),
      });
      return realId;
    } catch (e) {
      // Rollback: remove the temp row, rethrow for caller UI.
      set({
        transactions: get().transactions.filter((row) => row.id !== tempId),
      });
      throw e;
    }
  },

  createMany: async (rows) => {
    if (rows.length === 0) return [];
    const repo = new TransactionsRepo(getDatabase());
    // Optimistic batch insert: append all rows with temp IDs first.
    const tempIds = rows.map(() => allocTempId());
    const optimisticRows: Transaction[] = rows.map((t, i) => ({
      ...t,
      id: tempIds[i],
      importedAt: t.importedAt ?? new Date().toISOString(),
    } as Transaction));
    set({
      transactions: sortTransactions([
        ...get().transactions,
        ...optimisticRows,
      ]),
    });
    try {
      const realIds = await repo.createMany(rows);
      // Replace temp rows with their persisted counterparts. We re-fetch
      // each so any DB-side defaults / triggers are reflected. For very
      // large batches the per-row findById is acceptable because
      // createMany is a one-shot import operation, not a hot edit path.
      const realRows = await Promise.all(realIds.map((id) => repo.findById(id)));
      const tempIdSet = new Set(tempIds);
      const remaining = get().transactions.filter(
        (row) => !(row.id != null && tempIdSet.has(row.id)),
      );
      const merged = sortTransactions([
        ...remaining,
        ...realRows.filter((r): r is Transaction => r !== null),
      ]);
      set({ transactions: merged });
      return realIds;
    } catch (e) {
      const tempIdSet = new Set(tempIds);
      set({
        transactions: get().transactions.filter(
          (row) => !(row.id != null && tempIdSet.has(row.id)),
        ),
      });
      throw e;
    }
  },

  update: async (id, patch) => {
    const repo = new TransactionsRepo(getDatabase());
    const prev = get().transactions.find((t) => t.id === id);
    if (!prev) {
      // Row not in memory — fall back to a normal repo update + full
      // reload (the consumer may have an out-of-date cache).
      await repo.update(id, patch);
      await get().load();
      return;
    }
    // Optimistic update: mutate the local row first, then persist.
    const optimistic: Transaction = { ...prev, ...patch };
    set({
      transactions: sortTransactions(
        get().transactions.map((row) => (row.id === id ? optimistic : row)),
      ),
    });
    try {
      await repo.update(id, patch);
    } catch (e) {
      // Rollback to the pre-write row.
      set({
        transactions: sortTransactions(
          get().transactions.map((row) => (row.id === id ? prev : row)),
        ),
      });
      throw e;
    }
  },

  remove: async (id) => {
    const repo = new TransactionsRepo(getDatabase());
    const prev = get().transactions.find((t) => t.id === id);
    if (!prev) {
      await repo.delete(id);
      return;
    }
    // Optimistic delete: filter out first, restore on failure.
    set({
      transactions: get().transactions.filter((t) => t.id !== id),
    });
    try {
      await repo.delete(id);
    } catch (e) {
      set({ transactions: sortTransactions([...get().transactions, prev]) });
      throw e;
    }
  },

  setRecurring: async (ids, value) => {
    const repo = new TransactionsRepo(getDatabase());
    const idSet = new Set(ids);
    const prev = get().transactions;
    // Optimistic batch flag update.
    set({
      transactions: prev.map((t) =>
        t.id != null && idSet.has(t.id) ? { ...t, isRecurring: value } : t,
      ),
    });
    try {
      await repo.setRecurring(ids, value);
    } catch (e) {
      set({ transactions: prev });
      throw e;
    }
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
    if (toTrue.length === 0 && toFalse.length === 0) return;
    // Optimistic: apply the dual flag flip in memory, persist in the
    // background. Rollback to `txns` if either DB call throws.
    const trueSet = new Set(toTrue);
    const falseSet = new Set(toFalse);
    set({
      transactions: txns.map((t) => {
        if (t.id == null) return t;
        if (trueSet.has(t.id)) return { ...t, isRecurring: true };
        if (falseSet.has(t.id)) return { ...t, isRecurring: false };
        return t;
      }),
    });
    try {
      if (toTrue.length) await repo.setRecurring(toTrue, true);
      if (toFalse.length) await repo.setRecurring(toFalse, false);
    } catch (e) {
      set({ transactions: txns });
      throw e;
    }
  },
}));
