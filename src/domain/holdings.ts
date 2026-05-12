import type { Database } from '@/db/db';
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

  async create(holding: Omit<Holding, 'id'>): Promise<number> {
    HoldingSchema.omit({ id: true }).parse(holding);
    const result = await this.db.execute(
      `INSERT INTO holdings (
        account_id, ticker, share_count, target_allocation_pct, cost_basis
      ) VALUES (?, ?, ?, ?, ?)`,
      [
        holding.accountId,
        holding.ticker,
        holding.shareCount,
        holding.targetAllocationPct ?? null,
        holding.costBasis ?? null,
      ]
    );
    if (!result.lastInsertId) {
      throw new Error('Failed to create holding: no lastInsertId returned');
    }
    return result.lastInsertId;
  }

  async update(
    id: number,
    patch: Partial<Omit<Holding, 'id' | 'accountId'>>
  ): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`Holding ${id} not found`);
    const merged = { ...existing, ...patch };
    HoldingSchema.parse(merged);

    await this.db.execute(
      `UPDATE holdings SET
        ticker = ?,
        share_count = ?,
        target_allocation_pct = ?,
        cost_basis = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        merged.ticker,
        merged.shareCount,
        merged.targetAllocationPct ?? null,
        merged.costBasis ?? null,
        id,
      ]
    );
  }

  async delete(id: number): Promise<void> {
    await this.db.execute('DELETE FROM holdings WHERE id = ?', [id]);
  }
}
