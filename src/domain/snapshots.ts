import type { Database } from '@/db/db';
import { AccountSnapshotSchema, type AccountSnapshot } from '@/types/schema';
import { SnapshotSource } from '@/types/enums';

interface SnapshotRow {
  id: number;
  account_id: number;
  snapshot_date: string;
  total_value: number;
  source: SnapshotSource;
}

function rowToSnapshot(row: SnapshotRow): AccountSnapshot {
  return AccountSnapshotSchema.parse({
    id: row.id,
    accountId: row.account_id,
    snapshotDate: row.snapshot_date,
    totalValue: row.total_value,
    source: row.source,
  });
}

function lastDayOfMonth(yyyymm: string): string {
  const [y, m] = yyyymm.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

export class AccountSnapshotsRepo {
  constructor(private db: Database) {}

  async listForAccount(accountId: number): Promise<AccountSnapshot[]> {
    const rows = await this.db.select<SnapshotRow>(
      'SELECT * FROM account_snapshots WHERE account_id = ? ORDER BY snapshot_date ASC, id ASC',
      [accountId]
    );
    return rows.map(rowToSnapshot);
  }

  async listForMonth(yyyymm: string): Promise<AccountSnapshot[]> {
    const fromDate = `${yyyymm}-01`;
    const toDate = lastDayOfMonth(yyyymm);
    const rows = await this.db.select<SnapshotRow>(
      `SELECT * FROM account_snapshots
       WHERE snapshot_date >= ? AND snapshot_date <= ?
       ORDER BY snapshot_date ASC, id ASC`,
      [fromDate, toDate]
    );
    return rows.map(rowToSnapshot);
  }

  /**
   * Returns the most recent snapshot per account, using the unique
   * (account_id, snapshot_date) index. Drives the Dashboard's "current
   * net worth" tile without scanning the whole history per account.
   */
  async listLatestPerAccount(): Promise<AccountSnapshot[]> {
    const rows = await this.db.select<SnapshotRow>(
      `SELECT * FROM account_snapshots
       WHERE (account_id, snapshot_date) IN (
         SELECT account_id, MAX(snapshot_date)
         FROM account_snapshots
         GROUP BY account_id
       )
       ORDER BY account_id ASC`
    );
    return rows.map(rowToSnapshot);
  }

  async findById(id: number): Promise<AccountSnapshot | null> {
    const rows = await this.db.select<SnapshotRow>(
      'SELECT * FROM account_snapshots WHERE id = ?',
      [id]
    );
    if (rows.length === 0) return null;
    return rowToSnapshot(rows[0]);
  }

  /**
   * Insert-or-update by (account_id, snapshot_date) unique key. DO UPDATE
   * preserves the row's id and created_at, unlike INSERT OR REPLACE which
   * deletes-then-inserts and cycles the rowid (breaking dependent FKs and
   * shifting the autoincrement counter).
   */
  async upsert(snapshot: Omit<AccountSnapshot, 'id'>): Promise<number> {
    AccountSnapshotSchema.omit({ id: true }).parse(snapshot);
    // Source-aware conflict resolution. The app records daily AUTO_DERIVED
    // snapshots, but users also hand-enter historical net worth
    // (MANUAL / USER_CONFIRMED / CSV_IMPORT). Precedence: user-entered data
    // always wins. The DO UPDATE only fires when the existing row is
    // AUTO_DERIVED (auto may refresh auto) OR the incoming write is itself
    // user-entered (the user may overwrite anything). This means a daily
    // AUTO_DERIVED write can never clobber hand-entered history sharing the
    // same (account_id, snapshot_date) — when the WHERE is false the row is
    // left untouched, NOT deleted, so the id-lookup below still resolves.
    await this.db.execute(
      `INSERT INTO account_snapshots (account_id, snapshot_date, total_value, source)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(account_id, snapshot_date) DO UPDATE SET
         total_value = excluded.total_value,
         source = excluded.source
       WHERE account_snapshots.source = 'AUTO_DERIVED' OR excluded.source != 'AUTO_DERIVED'`,
      [snapshot.accountId, snapshot.snapshotDate, snapshot.totalValue, snapshot.source]
    );
    // On both insert and update paths, look up the row by the unique key
    // — better-sqlite3's lastInsertRowid is unreliable for ON CONFLICT
    // updates across SQLite versions, so we resolve the id explicitly.
    const rows = await this.db.select<{ id: number }>(
      'SELECT id FROM account_snapshots WHERE account_id = ? AND snapshot_date = ?',
      [snapshot.accountId, snapshot.snapshotDate]
    );
    if (rows.length === 0) {
      throw new Error('Failed to upsert snapshot: row not found after write');
    }
    return rows[0].id;
  }

  async delete(id: number): Promise<void> {
    await this.db.execute('DELETE FROM account_snapshots WHERE id = ?', [id]);
  }
}
