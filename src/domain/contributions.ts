import type { BatchStatement, Database } from '@/db/db';
import { ContributionSchema, type Contribution } from '@/types/schema';
import { ContributionSource } from '@/types/enums';

interface ContributionRow {
  id: number;
  account_id: number;
  person_id: number | null;
  date: string;
  amount: number;
  source: ContributionSource;
}

function rowToContribution(row: ContributionRow): Contribution {
  return ContributionSchema.parse({
    id: row.id,
    accountId: row.account_id,
    personId: row.person_id,
    date: row.date,
    amount: row.amount,
    source: row.source,
  });
}

/**
 * Compute the inclusive last-day ISO date for a YYYY-MM month string.
 * Uses UTC and the "day 0 of next month" trick — Feb correctly returns
 * the 28th or 29th depending on leap year.
 */
function lastDayOfMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

function firstDayOfMonth(yyyymm: string): string {
  return `${yyyymm}-01`;
}

export class ContributionsRepo {
  constructor(private db: Database) {}

  async listAll(): Promise<Contribution[]> {
    const rows = await this.db.select<ContributionRow>(
      'SELECT * FROM contributions ORDER BY date ASC, id ASC'
    );
    return rows.map(rowToContribution);
  }

  async listForAccount(accountId: number): Promise<Contribution[]> {
    const rows = await this.db.select<ContributionRow>(
      'SELECT * FROM contributions WHERE account_id = ? ORDER BY date ASC, id ASC',
      [accountId]
    );
    return rows.map(rowToContribution);
  }

  async listForPersonInMonthRange(
    personId: number,
    fromYyyymm: string,
    toYyyymm: string
  ): Promise<Contribution[]> {
    const fromDate = firstDayOfMonth(fromYyyymm);
    const toDate = lastDayOfMonth(toYyyymm);
    const rows = await this.db.select<ContributionRow>(
      `SELECT * FROM contributions
       WHERE person_id = ? AND date >= ? AND date <= ?
       ORDER BY date ASC, id ASC`,
      [personId, fromDate, toDate]
    );
    return rows.map(rowToContribution);
  }

  async findById(id: number): Promise<Contribution | null> {
    const rows = await this.db.select<ContributionRow>(
      'SELECT * FROM contributions WHERE id = ?',
      [id]
    );
    if (rows.length === 0) return null;
    return rowToContribution(rows[0]);
  }

  /**
   * Validate (Zod) and build the INSERT statement for one contribution
   * WITHOUT executing. `create` executes it and returns the new id;
   * import-commit collects builders from many rows into one atomic
   * `executeBatch`.
   */
  buildCreateStatement(contribution: Omit<Contribution, 'id'>): BatchStatement {
    ContributionSchema.omit({ id: true }).parse(contribution);
    return {
      sql: `INSERT INTO contributions (account_id, person_id, date, amount, source)
       VALUES (?, ?, ?, ?, ?)`,
      params: [
        contribution.accountId,
        contribution.personId ?? null,
        contribution.date,
        contribution.amount,
        contribution.source,
      ],
    };
  }

  async create(contribution: Omit<Contribution, 'id'>): Promise<number> {
    const { sql, params } = this.buildCreateStatement(contribution);
    const result = await this.db.execute(sql, params);
    if (!result.lastInsertId) {
      throw new Error('Failed to create contribution: no lastInsertId returned');
    }
    return result.lastInsertId;
  }

  async update(
    id: number,
    patch: Partial<Omit<Contribution, 'id' | 'accountId'>>
  ): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`Contribution ${id} not found`);
    const merged = { ...existing, ...patch };
    ContributionSchema.parse(merged);

    await this.db.execute(
      `UPDATE contributions SET
        person_id = ?,
        date = ?,
        amount = ?,
        source = ?
       WHERE id = ?`,
      [
        merged.personId ?? null,
        merged.date,
        merged.amount,
        merged.source,
        id,
      ]
    );
  }

  async delete(id: number): Promise<void> {
    await this.db.execute('DELETE FROM contributions WHERE id = ?', [id]);
  }
}
