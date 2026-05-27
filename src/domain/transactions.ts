import type { Database } from '@/db/db';
import { TransactionSchema, type Transaction } from '@/types/schema';

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

  async create(t: Omit<Transaction, 'id'>): Promise<number> {
    TransactionSchema.omit({ id: true }).parse(t);
    const result = await this.db.execute(
      `INSERT INTO transactions
        (household_id, date, merchant, merchant_raw, amount, category_id,
         source_account_id, property_id, vehicle_id, person_id, source_pdf_filename,
         reimbursable, reimbursed_at, reimbursed_amount, is_recurring, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
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
    );
    if (!result.lastInsertId) {
      throw new Error('Failed to create transaction: no lastInsertId returned');
    }
    return result.lastInsertId;
  }

  async createMany(rows: Array<Omit<Transaction, 'id'>>): Promise<number[]> {
    // P2-A4: wrap the N inserts in a single SQLite transaction. Without
    // this, each row pays the full WAL fsync / statement-prep cost,
    // running ~10-30x slower at 1k rows. Mirror the pattern already used
    // in `src/lib/import/commit.ts` (BEGIN / COMMIT / ROLLBACK on throw).
    if (rows.length === 0) return [];
    const ids: number[] = [];
    await this.db.execute('BEGIN');
    try {
      for (const r of rows) ids.push(await this.create(r));
      await this.db.execute('COMMIT');
    } catch (err) {
      await this.db.execute('ROLLBACK');
      throw err;
    }
    return ids;
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
