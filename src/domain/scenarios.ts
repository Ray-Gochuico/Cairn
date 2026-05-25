import type { Database } from '@/db/db';
import { ScenarioSchema, type Scenario } from '@/types/scenario';

interface ScenarioRow {
  id: number;
  name: string;
  is_baseline: number;
  color: string;
  line_style: string;
  visible: number;
  is_active: number;
  sort_order: number;
  lever_payload: string;
  created_at: string;
  updated_at: string;
}

function rowToScenario(row: ScenarioRow): Scenario {
  const parsedPayload = JSON.parse(row.lever_payload);
  return ScenarioSchema.parse({
    id: row.id,
    name: row.name,
    isBaseline: row.is_baseline === 1,
    color: row.color,
    lineStyle: row.line_style,
    visible: row.visible === 1,
    isActive: row.is_active === 1,
    sortOrder: row.sort_order,
    leverPayload: parsedPayload,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export class ScenariosRepo {
  constructor(private db: Database) {}

  async list(): Promise<Scenario[]> {
    const rows = await this.db.select<ScenarioRow>(
      'SELECT * FROM scenarios ORDER BY sort_order ASC, id ASC',
    );
    return rows.map(rowToScenario);
  }

  async findById(id: number): Promise<Scenario | null> {
    const rows = await this.db.select<ScenarioRow>(
      'SELECT * FROM scenarios WHERE id = ?',
      [id],
    );
    return rows.length === 0 ? null : rowToScenario(rows[0]);
  }

  async create(scenario: Omit<Scenario, 'id' | 'createdAt' | 'updatedAt'>): Promise<number> {
    ScenarioSchema.omit({ id: true }).parse({
      ...scenario,
      createdAt: '1970-01-01T00:00:00Z',
      updatedAt: '1970-01-01T00:00:00Z',
    });
    const result = await this.db.execute(
      `INSERT INTO scenarios (
        name, is_baseline, color, line_style, visible, is_active,
        sort_order, lever_payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        scenario.name,
        scenario.isBaseline ? 1 : 0,
        scenario.color,
        scenario.lineStyle,
        scenario.visible ? 1 : 0,
        scenario.isActive ? 1 : 0,
        scenario.sortOrder,
        JSON.stringify(scenario.leverPayload),
      ],
    );
    if (!result.lastInsertId) {
      throw new Error('Failed to create scenario: no lastInsertId returned');
    }
    return result.lastInsertId;
  }

  async update(
    id: number,
    patch: Partial<Omit<Scenario, 'id' | 'createdAt' | 'updatedAt'>>,
  ): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`Scenario ${id} not found`);
    const merged: Scenario = { ...existing, ...patch };
    ScenarioSchema.parse(merged);

    await this.db.execute(
      `UPDATE scenarios SET
        name          = ?,
        is_baseline   = ?,
        color         = ?,
        line_style    = ?,
        visible       = ?,
        is_active     = ?,
        sort_order    = ?,
        lever_payload = ?,
        updated_at    = datetime('now')
       WHERE id = ?`,
      [
        merged.name,
        merged.isBaseline ? 1 : 0,
        merged.color,
        merged.lineStyle,
        merged.visible ? 1 : 0,
        merged.isActive ? 1 : 0,
        merged.sortOrder,
        JSON.stringify(merged.leverPayload),
        id,
      ],
    );
  }

  async delete(id: number): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) throw new Error(`Scenario ${id} not found`);
    if (existing.isBaseline) {
      throw new Error('Cannot delete baseline scenario');
    }
    await this.db.execute('DELETE FROM scenarios WHERE id = ?', [id]);
  }

  async setActive(id: number): Promise<void> {
    const target = await this.findById(id);
    if (!target) throw new Error(`Scenario ${id} not found`);

    await this.db.execute('BEGIN');
    try {
      await this.db.execute('UPDATE scenarios SET is_active = 0 WHERE is_active = 1');
      await this.db.execute(
        "UPDATE scenarios SET is_active = 1, updated_at = datetime('now') WHERE id = ?",
        [id],
      );
      await this.db.execute('COMMIT');
    } catch (e) {
      try { await this.db.execute('ROLLBACK'); } catch { /* swallow */ }
      throw e;
    }
  }
}
