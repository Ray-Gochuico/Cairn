import type { BatchStatement, Database } from '@/db/db';
import {
  AssetValueSnapshotSchema,
  type AssetValueSnapshot,
} from '@/types/schema';
import type { AssetSnapshotOwnerType } from '@/types/enums';

interface AssetValueSnapshotRow {
  id: number;
  owner_type: string;
  owner_id: number;
  snapshot_date: string;
  value: number;
}

function rowToSnapshot(row: AssetValueSnapshotRow): AssetValueSnapshot {
  return AssetValueSnapshotSchema.parse({
    id: row.id,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    snapshotDate: row.snapshot_date,
    value: row.value,
  });
}

/**
 * Manually entered dated value snapshots for properties and vehicles.
 * Drives the Net Worth chart's per-bucket lookup (latest snapshot with
 * snapshot_date <= bucket_end) and the AssetsDonut's per-entity slice value.
 *
 * No SQL foreign key on (owner_type, owner_id) because owner_type is a
 * discriminated union — cascading deletes are wired explicitly through
 * PropertiesRepo.delete and VehiclesRepo.delete via deleteForOwner().
 */
export class AssetValueSnapshotsRepo {
  constructor(private db: Database) {}

  async list(): Promise<AssetValueSnapshot[]> {
    const rows = await this.db.select<AssetValueSnapshotRow>(
      `SELECT id, owner_type, owner_id, snapshot_date, value
       FROM asset_value_snapshots
       ORDER BY snapshot_date DESC, id DESC`,
    );
    return rows.map(rowToSnapshot);
  }

  async listForOwner(
    ownerType: AssetSnapshotOwnerType,
    ownerId: number,
  ): Promise<AssetValueSnapshot[]> {
    const rows = await this.db.select<AssetValueSnapshotRow>(
      `SELECT id, owner_type, owner_id, snapshot_date, value
       FROM asset_value_snapshots
       WHERE owner_type = ? AND owner_id = ?
       ORDER BY snapshot_date DESC, id DESC`,
      [ownerType, ownerId],
    );
    return rows.map(rowToSnapshot);
  }

  async findById(id: number): Promise<AssetValueSnapshot | null> {
    const rows = await this.db.select<AssetValueSnapshotRow>(
      `SELECT id, owner_type, owner_id, snapshot_date, value
       FROM asset_value_snapshots
       WHERE id = ?`,
      [id],
    );
    if (rows.length === 0) return null;
    return rowToSnapshot(rows[0]);
  }

  /**
   * Validate (Zod) and build the INSERT statement WITHOUT executing.
   * `create` executes it and returns the new id; import-commit collects
   * builders from many rows into one atomic `executeBatch`.
   */
  buildCreateStatement(snap: Omit<AssetValueSnapshot, 'id'>): BatchStatement {
    const validated = AssetValueSnapshotSchema.omit({ id: true }).parse(snap);
    return {
      sql: `INSERT INTO asset_value_snapshots (owner_type, owner_id, snapshot_date, value)
       VALUES (?, ?, ?, ?)`,
      params: [
        validated.ownerType,
        validated.ownerId,
        validated.snapshotDate,
        validated.value,
      ],
    };
  }

  async create(snap: Omit<AssetValueSnapshot, 'id'>): Promise<number> {
    const { sql, params } = this.buildCreateStatement(snap);
    const result = await this.db.execute(sql, params);
    if (!result.lastInsertId) {
      throw new Error('Failed to create AssetValueSnapshot: no lastInsertId returned');
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
    patch: Partial<Omit<AssetValueSnapshot, 'id'>>,
  ): Promise<BatchStatement> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`AssetValueSnapshot ${id} not found`);
    const merged = AssetValueSnapshotSchema.parse({
      ...existing,
      ...patch,
      id,
    });
    return {
      sql: `UPDATE asset_value_snapshots SET
         owner_type = ?,
         owner_id = ?,
         snapshot_date = ?,
         value = ?
       WHERE id = ?`,
      params: [merged.ownerType, merged.ownerId, merged.snapshotDate, merged.value, id],
    };
  }

  async update(
    id: number,
    patch: Partial<Omit<AssetValueSnapshot, 'id'>>,
  ): Promise<void> {
    const { sql, params } = await this.buildUpdateStatement(id, patch);
    await this.db.execute(sql, params);
  }

  /**
   * Insert-or-update the single row for (ownerType, ownerId, snapshotDate).
   * The table has NO unique constraint on that triple — one-row-per-date is
   * a caller convention (see migration 0026's header) — so this SELECTs
   * authoritatively before writing rather than trusting any in-memory cache.
   * If legacy duplicates exist, the newest (highest id) row is the one
   * updated, matching the ORDER BY … id DESC convention of
   * list()/listForOwner(). Returns the row id.
   */
  async upsertForDate(
    ownerType: AssetSnapshotOwnerType,
    ownerId: number,
    snapshotDate: string,
    value: number,
  ): Promise<number> {
    const rows = await this.db.select<{ id: number }>(
      `SELECT id FROM asset_value_snapshots
       WHERE owner_type = ? AND owner_id = ? AND snapshot_date = ?
       ORDER BY id DESC LIMIT 1`,
      [ownerType, ownerId, snapshotDate],
    );
    if (rows.length > 0) {
      await this.update(rows[0].id, { value });
      return rows[0].id;
    }
    return this.create({ ownerType, ownerId, snapshotDate, value });
  }

  async delete(id: number): Promise<void> {
    await this.db.execute('DELETE FROM asset_value_snapshots WHERE id = ?', [id]);
  }

  async deleteForOwner(
    ownerType: AssetSnapshotOwnerType,
    ownerId: number,
  ): Promise<void> {
    await this.db.execute(
      'DELETE FROM asset_value_snapshots WHERE owner_type = ? AND owner_id = ?',
      [ownerType, ownerId],
    );
  }
}
