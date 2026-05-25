import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';

interface ColumnInfo { name: string; type: string; notnull: number; dflt_value: string | null }
interface IndexInfo  { name: string; unique: number }

describe('migration 0019_scenarios', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter();
    await runMigrations(db, await loadAllMigrations());
  });

  afterEach(async () => { await db.close(); });

  it('creates the scenarios table with the documented columns', async () => {
    const cols = await db.select<ColumnInfo>(`PRAGMA table_info(scenarios)`);
    const names = cols.map((c) => c.name).sort();
    expect(names).toEqual([
      'color', 'created_at', 'id', 'is_active', 'is_baseline',
      'lever_payload', 'line_style', 'name', 'sort_order',
      'updated_at', 'visible',
    ]);
  });

  it('enforces NOT NULL on name, color, line_style, visible, is_baseline, is_active, sort_order, lever_payload', async () => {
    const cols = await db.select<ColumnInfo>(`PRAGMA table_info(scenarios)`);
    const required = ['name', 'color', 'line_style', 'visible', 'is_baseline', 'is_active', 'sort_order', 'lever_payload'];
    for (const r of required) {
      const c = cols.find((x) => x.name === r);
      expect(c, `column ${r}`).toBeDefined();
      expect(c?.notnull, `column ${r} must be NOT NULL`).toBe(1);
    }
  });

  it('declares partial unique indexes scenarios_one_baseline and scenarios_one_active', async () => {
    const idxs = await db.select<IndexInfo>(`PRAGMA index_list(scenarios)`);
    const names = idxs.map((i) => i.name);
    expect(names).toContain('scenarios_one_baseline');
    expect(names).toContain('scenarios_one_active');
  });

  it('rejects a second baseline row', async () => {
    await db.execute(
      `INSERT INTO scenarios (name, is_baseline, color, is_active, lever_payload) VALUES ('A', 1, '#4f86f7', 1, '{}')`,
    );
    await expect(
      db.execute(
        `INSERT INTO scenarios (name, is_baseline, color, is_active, lever_payload) VALUES ('B', 1, '#4f86f7', 0, '{}')`,
      ),
    ).rejects.toThrow();
  });

  it('rejects a second active row', async () => {
    await db.execute(
      `INSERT INTO scenarios (name, is_baseline, color, is_active, lever_payload) VALUES ('A', 1, '#4f86f7', 1, '{}')`,
    );
    await expect(
      db.execute(
        `INSERT INTO scenarios (name, is_baseline, color, is_active, lever_payload) VALUES ('B', 0, '#a8c0fb', 1, '{}')`,
      ),
    ).rejects.toThrow();
  });
});
