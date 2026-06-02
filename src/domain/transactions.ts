import type { BatchStatement, Database } from '@/db/db';
import { TransactionSchema, type Transaction } from '@/types/schema';

const INSERT_SQL =
  `INSERT INTO transactions
    (household_id, date, merchant, merchant_raw, amount, category_id,
     source_account_id, property_id, vehicle_id, person_id, source_pdf_filename,
     reimbursable, reimbursed_at, reimbursed_amount, is_recurring, notes)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * Validate (Zod) and build the INSERT statement + bound params for one
 * transaction, WITHOUT executing. Used by `create` (execute + return id) and
 * by `createMany` (collect into one atomic `executeBatch`). Centralising the
 * SQL+params here keeps the two paths byte-identical.
 */
function buildInsertStatement(t: Omit<Transaction, 'id'>): BatchStatement {
  TransactionSchema.omit({ id: true }).parse(t);
  return {
    sql: INSERT_SQL,
    params: [
      t.householdId,
      t.date,
      t.merchant,
      t.merchantRaw ?? null,
      t.amount,
      t.categoryId ?? null,
      t.sourceAccountId ?? null,
      t.propertyId ?? null,
      t.vehicleId ?? null,
      t.personId ?? null,
      t.sourcePdfFilename ?? null,
      t.reimbursable ? 1 : 0,
      t.reimbursedAt ?? null,
      t.reimbursedAmount ?? null,
      t.isRecurring ? 1 : 0,
      t.notes ?? null,
    ],
  };
}

interface TransactionRow {
  id: number;
  household_id: number;
  date: string;
  merchant: string;
  merchant_raw: string | null;
  amount: number;
  category_id: number | null;
  source_account_id: number | null;
  property_id: number | null;
  vehicle_id: number | null;
  person_id: number | null;
  source_pdf_filename: string | null;
  imported_at: string;
  reimbursable: number;
  reimbursed_at: string | null;
  reimbursed_amount: number | null;
  is_recurring: number;
  notes: string | null;
}

function rowToTransaction(row: TransactionRow): Transaction {
  return TransactionSchema.parse({
    id: row.id,
    householdId: row.household_id,
    date: row.date,
    merchant: row.merchant,
    merchantRaw: row.merchant_raw,
    amount: row.amount,
    categoryId: row.category_id,
    sourceAccountId: row.source_account_id,
    propertyId: row.property_id,
    vehicleId: row.vehicle_id,
    personId: row.person_id,
    sourcePdfFilename: row.source_pdf_filename,
    importedAt: row.imported_at,
    reimbursable: row.reimbursable === 1,
    reimbursedAt: row.reimbursed_at,
    reimbursedAmount: row.reimbursed_amount,
    isRecurring: row.is_recurring === 1,
    notes: row.notes,
  });
}

export class TransactionsRepo {
  constructor(private db: Database) {}

  async list(): Promise<Transaction[]> {
    const rows = await this.db.select<TransactionRow>(
      'SELECT * FROM transactions ORDER BY date DESC, id DESC',
    );
    return rows.map(rowToTransaction);
  }

  async findById(id: number): Promise<Transaction | null> {
    const rows = await this.db.select<TransactionRow>(
      'SELECT * FROM transactions WHERE id = ?',
      [id],
    );
    if (rows.length === 0) return null;
    return rowToTransaction(rows[0]);
  }

  /**
   * Validate (Zod) and build the INSERT statement for one transaction WITHOUT
   * executing — exposed so import-commit can collect statements from many
   * rows into one atomic `executeBatch`. `create`/`createMany` use the same
   * module-level builder so all three paths stay byte-identical.
   */
  buildCreateStatement(t: Omit<Transaction, 'id'>): BatchStatement {
    return buildInsertStatement(t);
  }

  async create(t: Omit<Transaction, 'id'>): Promise<number> {
    const { sql, params } = buildInsertStatement(t);
    const result = await this.db.execute(sql, params);
    if (!result.lastInsertId) {
      throw new Error('Failed to create transaction: no lastInsertId returned');
    }
    return result.lastInsertId;
  }

  async createMany(rows: Array<Omit<Transaction, 'id'>>): Promise<number[]> {
    // P2-A4 + prod↔test parity: insert all N rows in ONE atomic batch on a
    // single connection. The previous BEGIN/body/COMMIT expressed as three
    // separate `db.execute` calls wrapped NOTHING in prod (the plugin-sql
    // connection POOL scatters each call across connections), so a mid-batch
    // failure left partial rows committed. `executeBatch({transaction:true})`
    // pins the whole batch to one connection and is genuinely all-or-nothing.
    if (rows.length === 0) return [];

    // Zod-validate + build every statement BEFORE writing. A bad row throws
    // here, before the batch runs, so nothing is written (same contract as
    // before: validation failure ⇒ no partial writes, error surfaced).
    const statements = rows.map(buildInsertStatement);
    await this.db.executeBatch(statements, { transaction: true });

    // Recover the inserted ids. `transactions.id` is INTEGER PRIMARY KEY
    // AUTOINCREMENT, so every freshly-inserted row carries an id strictly
    // greater than any id previously used in the table — the N rows we just
    // wrote are therefore the N highest ids, in insertion order. We read them
    // back with a `select` (not `last_insert_rowid()`, which is connection-
    // local and unreliable across the prod pool). This is a single-writer
    // local DB, so no concurrent insert can interleave between COMMIT and read.
    const rowsBack = await this.db.select<{ id: number }>(
      'SELECT id FROM transactions ORDER BY id DESC LIMIT ?',
      [rows.length],
    );
    // rowsBack is highest-first; reverse to insertion (ascending) order.
    return rowsBack.map((r) => r.id).reverse();
  }

  async update(id: number, patch: Partial<Omit<Transaction, 'id' | 'householdId'>>): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`Transaction ${id} not found`);
    const merged = { ...existing, ...patch };
    TransactionSchema.parse(merged);

    await this.db.execute(
      `UPDATE transactions SET
        date = ?, merchant = ?, merchant_raw = ?, amount = ?, category_id = ?,
        source_account_id = ?, property_id = ?, vehicle_id = ?, person_id = ?,
        source_pdf_filename = ?, reimbursable = ?, reimbursed_at = ?,
        reimbursed_amount = ?, is_recurring = ?, notes = ?
       WHERE id = ?`,
      [
        merged.date,
        merged.merchant,
        merged.merchantRaw ?? null,
        merged.amount,
        merged.categoryId ?? null,
        merged.sourceAccountId ?? null,
        merged.propertyId ?? null,
        merged.vehicleId ?? null,
        merged.personId ?? null,
        merged.sourcePdfFilename ?? null,
        merged.reimbursable ? 1 : 0,
        merged.reimbursedAt ?? null,
        merged.reimbursedAmount ?? null,
        merged.isRecurring ? 1 : 0,
        merged.notes ?? null,
        id,
      ],
    );
  }

  async delete(id: number): Promise<void> {
    await this.db.execute('DELETE FROM transactions WHERE id = ?', [id]);
  }

  async setRecurring(ids: number[], value: boolean): Promise<void> {
    for (const id of ids) {
      await this.db.execute('UPDATE transactions SET is_recurring = ? WHERE id = ?', [
        value ? 1 : 0, id,
      ]);
    }
  }
}
