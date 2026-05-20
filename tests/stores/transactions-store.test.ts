import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { setDatabase } from '@/db/db';
import { useTransactionsStore } from '@/stores/transactions-store';
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
  vehicleId: null, sourcePdfFilename: 'mar.pdf', reimbursable: false,
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
});
