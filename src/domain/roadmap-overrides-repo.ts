import type { Database } from '@/db/db';
import type {
  NodeId,
  OverrideStatus,
  RoadmapNodeOverride,
} from '@/types/roadmap';

interface RoadmapNodeOverrideRow {
  id: number;
  household_id: number;
  node_id: string;
  override_status: string;
  note: string | null;
  set_at: string;
}

function rowToOverride(row: RoadmapNodeOverrideRow): RoadmapNodeOverride {
  return {
    id: row.id,
    householdId: row.household_id,
    nodeId: row.node_id,
    overrideStatus: row.override_status as OverrideStatus,
    note: row.note,
    setAt: row.set_at,
  };
}

/**
 * roadmap_node_overrides is a thin per-node user-override table.
 * UNIQUE(household_id, node_id) means at most one live override per
 * node — re-setting replaces in-place rather than appending. Clearing
 * deletes the row outright; the auto-evaluation takes over again.
 */
export class RoadmapOverridesRepo {
  constructor(private db: Database) {}

  async list(): Promise<RoadmapNodeOverride[]> {
    const rows = await this.db.select<RoadmapNodeOverrideRow>(
      `SELECT * FROM roadmap_node_overrides ORDER BY set_at DESC`,
    );
    return rows.map(rowToOverride);
  }

  /**
   * Insert or replace the override for (householdId, nodeId). SQLite's
   * INSERT … ON CONFLICT DO UPDATE keeps this single round-trip.
   */
  async upsert(input: {
    householdId: number;
    nodeId: NodeId;
    overrideStatus: OverrideStatus;
    note?: string | null;
  }): Promise<void> {
    const setAt = new Date().toISOString();
    await this.db.execute(
      `INSERT INTO roadmap_node_overrides (household_id, node_id, override_status, note, set_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(household_id, node_id) DO UPDATE SET
         override_status = excluded.override_status,
         note            = excluded.note,
         set_at          = excluded.set_at`,
      [input.householdId, input.nodeId, input.overrideStatus, input.note ?? null, setAt],
    );
  }

  async delete(householdId: number, nodeId: NodeId): Promise<void> {
    await this.db.execute(
      `DELETE FROM roadmap_node_overrides WHERE household_id = ? AND node_id = ?`,
      [householdId, nodeId],
    );
  }
}
