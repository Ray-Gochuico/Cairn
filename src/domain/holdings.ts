import type { BatchStatement, Database } from '@/db/db';
import { HoldingSchema, type Holding } from '@/types/schema';

interface HoldingRow {
  id: number;
  account_id: number;
  ticker: string;
  share_count: number;
  target_allocation_pct: number | null;
  cost_basis: number | null;
}

function rowToHolding(row: HoldingRow): Holding {
  return HoldingSchema.parse({
    id: row.id,
    accountId: row.account_id,
    ticker: row.ticker,
    shareCount: row.share_count,
    targetAllocationPct: row.target_allocation_pct,
    costBasis: row.cost_basis,
  });
}

export class HoldingsRepo {
  constructor(private db: Database) {}

  async listForAccount(accountId: number): Promise<Holding[]> {
    const rows = await this.db.select<HoldingRow>(
      'SELECT * FROM holdings WHERE account_id = ? ORDER BY id ASC',
      [accountId]
    );
    return rows.map(rowToHolding);
  }

  async listAll(): Promise<Holding[]> {
    const rows = await this.db.select<HoldingRow>(
      'SELECT * FROM holdings ORDER BY id ASC'
    );
    return rows.map(rowToHolding);
  }

  async findById(id: number): Promise<Holding | null> {
    const rows = await this.db.select<HoldingRow>(
      'SELECT * FROM holdings WHERE id = ?',
      [id]
    );
    if (rows.length === 0) return null;
    return rowToHolding(rows[0]);
  }

  /**
   * Validate (Zod) and build the INSERT statement for one holding WITHOUT
   * executing. `create` executes it and returns the new id; import-commit
   * collects builders from many rows into one atomic `executeBatch`.
   */
  buildCreateStatement(holding: Omit<Holding, 'id'>): BatchStatement {
    HoldingSchema.omit({ id: true }).parse(holding);
    return {
      sql: `INSERT INTO holdings (
        account_id, ticker, share_count, target_allocation_pct, cost_basis
      ) VALUES (?, ?, ?, ?, ?)`,
      params: [
        holding.accountId,
        holding.ticker,
        holding.shareCount,
        holding.targetAllocationPct ?? null,
        holding.costBasis ?? null,
      ],
    };
  }

  async create(holding: Omit<Holding, 'id'>): Promise<number> {
    const { sql, params } = this.buildCreateStatement(holding);
    const result = await this.db.execute(sql, params);
    if (!result.lastInsertId) {
      throw new Error('Failed to create holding: no lastInsertId returned');
    }
    return result.lastInsertId;
  }

  /**
   * Read the existing row, merge the patch, Zod-validate, and build the
   * UPDATE statement WITHOUT executing. The READ stays here (batched callers
   * keep it outside the atomic write set); only the write statement is
   * batched. Throws if the id does not exist.
   */
  async buildUpdateStatement(
    id: number,
    patch: Partial<Omit<Holding, 'id' | 'accountId'>>
  ): Promise<BatchStatement> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`Holding ${id} not found`);
    const merged = { ...existing, ...patch };
    HoldingSchema.parse(merged);

    return {
      sql: `UPDATE holdings SET
        ticker = ?,
        share_count = ?,
        target_allocation_pct = ?,
        cost_basis = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      params: [
        merged.ticker,
        merged.shareCount,
        merged.targetAllocationPct ?? null,
        merged.costBasis ?? null,
        id,
      ],
    };
  }

  async update(
    id: number,
    patch: Partial<Omit<Holding, 'id' | 'accountId'>>
  ): Promise<void> {
    const { sql, params } = await this.buildUpdateStatement(id, patch);
    await this.db.execute(sql, params);
  }

  async delete(id: number): Promise<void> {
    await this.db.execute('DELETE FROM holdings WHERE id = ?', [id]);
  }
}
