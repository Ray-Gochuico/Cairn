import type { Database } from '@/db/db';
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

  async create(snap: Omit<AssetValueSnapshot, 'id'>): Promise<number> {
    const validated = AssetValueSnapshotSchema.omit({ id: true }).parse(snap);
    const result = await this.db.execute(
      `INSERT INTO asset_value_snapshots (owner_type, owner_id, snapshot_date, value)
       VALUES (?, ?, ?, ?)`,
      [
        validated.ownerType,
        validated.ownerId,
        validated.snapshotDate,
        validated.value,
      ],
    );
    if (!result.lastInsertId) {
      throw new Error('Failed to create AssetValueSnapshot: no lastInsertId returned');
    }
    return result.lastInsertId;
  }

  async update(
    id: number,
    patch: Partial<Omit<AssetValueSnapshot, 'id'>>,
  ): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`AssetValueSnapshot ${id} not found`);
    const merged = AssetValueSnapshotSchema.parse({
      ...existing,
      ...patch,
      id,
    });
    await this.db.execute(
      `UPDATE asset_value_snapshots SET
         owner_type = ?,
         owner_id = ?,
         snapshot_date = ?,
         value = ?
       WHERE id = ?`,
      [merged.ownerType, merged.ownerId, merged.snapshotDate, merged.value, id],
    );
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
