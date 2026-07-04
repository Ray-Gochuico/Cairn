import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useTransactionsStore } from '@/stores/transactions-store';
import { TransactionsRepo } from '@/domain/transactions';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Transaction } from '@/types/schema';

const mig = (file: string) => ({
  version: file,
  sql: readFileSync(resolve(__dirname, `../../src/db/migrations/${file}.sql`), 'utf-8'),
});

const row = (over: Partial<Omit<Transaction, 'id'>> = {}): Omit<Transaction, 'id'> => ({
  householdId: 1, date: '2026-03-05', merchant: 'AMAZON', merchantRaw: 'AMAZON.COM',
  amount: 54.23, categoryId: null, sourceAccountId: null, propertyId: null,
  vehicleId: null, personId: null, sourcePdfFilename: 'mar.pdf', reimbursable: false,
  reimbursedAt: null, reimbursedAmount: null, isRecurring: false, notes: null,
  ...over,
});

describe('useTransactionsStore', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [
      mig('0001_initial'),
      mig('0008_add_transaction_property_links'),
      mig('0012_add_transaction_person'),
    ]);
    setDatabase(db);
    useTransactionsStore.setState({ transactions: [], isLoading: false, error: null });
  });

  afterEach(async () => {
    await db.close();
  });

  it('createMany of 2 rows then load() yields 2 transactions', async () => {
    await useTransactionsStore.getState().createMany([
      row(),
      row({ merchant: 'SPOTIFY', amount: 9.99 }),
    ]);
    await useTransactionsStore.getState().load();
    const { transactions, isLoading, error } = useTransactionsStore.getState();
    expect(transactions).toHaveLength(2);
    expect(isLoading).toBe(false);
    expect(error).toBeNull();
  });

  it('syncRecurring marks three monthly same-amount transactions as recurring', async () => {
    // Seed three NETFLIX charges ~30 days apart with identical amounts
    await useTransactionsStore.getState().createMany([
      row({ merchant: 'NETFLIX', amount: 15.49, date: '2026-01-09' }),
      row({ merchant: 'NETFLIX', amount: 15.49, date: '2026-02-09' }),
      row({ merchant: 'NETFLIX', amount: 15.49, date: '2026-03-09' }),
    ]);
    await useTransactionsStore.getState().load();

    // Before sync, none should be recurring
    const before = useTransactionsStore.getState().transactions;
    expect(before.every((t) => !t.isRecurring)).toBe(true);

    await useTransactionsStore.getState().syncRecurring([]);

    const after = useTransactionsStore.getState().transactions;
    expect(after.every((t) => t.isRecurring)).toBe(true);
  });

  describe('optimistic paths', () => {
    // Harness (db/beforeEach/afterEach) is shared with the parent describe's
    // hooks (nested so the :memory: DB setup applies). All spies are
    // restored per-test.

    it('create(): temp negative id appears synchronously, then swaps to the real id', async () => {
      const p = useTransactionsStore.getState().create(row());
      // Optimistic insert happened before the first await settled:
      const during = useTransactionsStore.getState().transactions;
      expect(during).toHaveLength(1);
      expect(during[0].id).toBeLessThan(0);
      const realId = await p;
      const after = useTransactionsStore.getState().transactions;
      expect(after).toHaveLength(1);
      expect(after[0].id).toBe(realId);
      expect(realId).toBeGreaterThan(0);
    });

    it('create(): repo failure rolls the temp row back out and rethrows', async () => {
      const spy = vi
        .spyOn(TransactionsRepo.prototype, 'create')
        .mockRejectedValueOnce(new Error('insert failed'));
      await expect(useTransactionsStore.getState().create(row())).rejects.toThrow('insert failed');
      expect(useTransactionsStore.getState().transactions).toEqual([]);
      spy.mockRestore();
    });

    it('createMany(): repo failure removes ALL temp rows and rethrows', async () => {
      const spy = vi
        .spyOn(TransactionsRepo.prototype, 'createMany')
        .mockRejectedValueOnce(new Error('batch failed'));
      await expect(
        useTransactionsStore.getState().createMany([row(), row({ merchant: 'SPOTIFY' })]),
      ).rejects.toThrow('batch failed');
      expect(useTransactionsStore.getState().transactions).toEqual([]);
      spy.mockRestore();
    });

    it('update(): repo failure restores the pre-write row and rethrows', async () => {
      const id = await useTransactionsStore.getState().create(row({ merchant: 'BEFORE' }));
      const spy = vi
        .spyOn(TransactionsRepo.prototype, 'update')
        .mockRejectedValueOnce(new Error('update failed'));
      await expect(
        useTransactionsStore.getState().update(id, { merchant: 'AFTER' }),
      ).rejects.toThrow('update failed');
      const t = useTransactionsStore.getState().transactions.find((r) => r.id === id);
      expect(t?.merchant).toBe('BEFORE');
      spy.mockRestore();
    });

    it('update() on a row not in memory falls back to repo update + full reload', async () => {
      const id = await useTransactionsStore.getState().create(row({ merchant: 'ORPHAN' }));
      // Simulate a stale in-memory cache: the row exists in the DB only.
      useTransactionsStore.setState({ transactions: [] });
      await useTransactionsStore.getState().update(id, { merchant: 'RESYNCED' });
      const t = useTransactionsStore.getState().transactions.find((r) => r.id === id);
      expect(t?.merchant).toBe('RESYNCED'); // reload path repopulated the cache
    });

    it('remove(): repo failure restores the deleted row (re-sorted) and rethrows', async () => {
      const id = await useTransactionsStore.getState().create(row());
      const spy = vi
        .spyOn(TransactionsRepo.prototype, 'delete')
        .mockRejectedValueOnce(new Error('delete failed'));
      await expect(useTransactionsStore.getState().remove(id)).rejects.toThrow('delete failed');
      expect(useTransactionsStore.getState().transactions.map((t) => t.id)).toEqual([id]);
      spy.mockRestore();
    });

    it('setRecurring(): repo failure rolls the flag flips back and rethrows', async () => {
      const id = await useTransactionsStore.getState().create(row());
      const spy = vi
        .spyOn(TransactionsRepo.prototype, 'setRecurring')
        .mockRejectedValueOnce(new Error('flag failed'));
      await expect(useTransactionsStore.getState().setRecurring([id], true)).rejects.toThrow(
        'flag failed',
      );
      const t = useTransactionsStore.getState().transactions.find((r) => r.id === id);
      expect(t?.isRecurring).toBe(false);
      spy.mockRestore();
    });

    it('syncRecurring(): no-op branch — nothing to flip means zero repo calls', async () => {
      // One lone transaction can never be detected as recurring.
      await useTransactionsStore.getState().create(row());
      const spy = vi.spyOn(TransactionsRepo.prototype, 'setRecurring');
      await useTransactionsStore.getState().syncRecurring([]);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('syncRecurring(): toFalse branch — a manually-flagged loner gets un-flagged', async () => {
      const id = await useTransactionsStore.getState().create(row({ isRecurring: true }));
      await useTransactionsStore.getState().syncRecurring([]);
      const t = useTransactionsStore.getState().transactions.find((r) => r.id === id);
      expect(t?.isRecurring).toBe(false); // detector sees no cadence → clears the flag
    });

    it('syncRecurring(): repo failure rolls BOTH flip sets back and rethrows', async () => {
      // Three NETFLIX rows → detector wants them recurring (toTrue set), and a
      // pre-flagged loner → detector wants it cleared (toFalse set).
      await useTransactionsStore.getState().createMany([
        row({ merchant: 'NETFLIX', amount: 15.49, date: '2026-01-09' }),
        row({ merchant: 'NETFLIX', amount: 15.49, date: '2026-02-09' }),
        row({ merchant: 'NETFLIX', amount: 15.49, date: '2026-03-09' }),
        row({ merchant: 'LONER', amount: 99, date: '2026-03-01', isRecurring: true }),
      ]);
      const before = useTransactionsStore.getState().transactions.map((t) => ({
        id: t.id,
        isRecurring: t.isRecurring,
      }));
      const spy = vi
        .spyOn(TransactionsRepo.prototype, 'setRecurring')
        .mockRejectedValue(new Error('sync failed')); // rejects whichever leg runs first
      await expect(useTransactionsStore.getState().syncRecurring([])).rejects.toThrow('sync failed');
      const after = useTransactionsStore.getState().transactions.map((t) => ({
        id: t.id,
        isRecurring: t.isRecurring,
      }));
      expect(after).toEqual(before); // full rollback to the pre-sync snapshot
      spy.mockRestore();
    });
  });
});
