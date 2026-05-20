import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';
import { TransactionsRepo } from '@/domain/transactions';
import type { Transaction } from '@/types/schema';

const mig = (file: string) => ({
  version: file,
  sql: readFileSync(resolve(__dirname, `../../src/db/migrations/${file}.sql`), 'utf-8'),
});

const row = (over: Partial<Transaction> = {}): Omit<Transaction, 'id'> => ({
  householdId: 1, date: '2026-03-05', merchant: 'AMAZON', merchantRaw: 'AMAZON.COM',
  amount: 54.23, categoryId: null, sourceAccountId: null, propertyId: null,
  vehicleId: null, sourcePdfFilename: 'mar.pdf', reimbursable: false,
  reimbursedAt: null, reimbursedAmount: null, isRecurring: false, notes: null,
  ...over,
});

describe('TransactionsRepo', () => {
  let db: SqliteAdapter;
  let repo: TransactionsRepo;
  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, [mig('0001_initial'), mig('0008_add_transaction_property_links')]);
    repo = new TransactionsRepo(db);
  });
  afterEach(async () => { await db.close(); });

  it('createMany inserts every row and returns their ids', async () => {
    const ids = await repo.createMany([row(), row({ merchant: 'SPOTIFY', amount: 9.99 })]);
    expect(ids).toHaveLength(2);
    expect((await repo.list()).length).toBe(2);
  });

  it('round-trips property_id, reimbursable, and a negative amount', async () => {
    const id = await repo.create(row({ amount: -200, reimbursable: true, propertyId: null }));
    const got = await repo.findById(id);
    expect(got?.amount).toBe(-200);
    expect(got?.reimbursable).toBe(true);
  });

  it('setRecurring flips is_recurring for the given ids', async () => {
    const id = await repo.create(row());
    await repo.setRecurring([id], true);
    expect((await repo.findById(id))?.isRecurring).toBe(true);
  });
});
