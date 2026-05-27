// Migration-level test for 0034_add_query_indexes.
//
// Companion to tests/db/index-presence.test.ts (which checks
// sqlite_master for the index rows). This file goes further:
//   1. All 6 indexes are present and bound to the right (table, column).
//   2. EXPLAIN QUERY PLAN actually USES the index for the canonical hot-
//      path query the index was created for. The presence-only test
//      can't catch a regression where the column type or collation
//      drifts in a way that the planner refuses to use the index.
//   3. Idempotency — CREATE INDEX IF NOT EXISTS lets the migration
//      re-run safely.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { loadAllMigrations, runMigrations } from '@/db/migrations';

interface IndexInfo {
  name: string;
  tbl_name: string;
}

interface IndexedColumn {
  cid: number;
  name: string;
}

const EXPECTED_INDEXES: Array<{ name: string; table: string; column: string }> = [
  { name: 'idx_transactions_date', table: 'transactions', column: 'date' },
  { name: 'idx_transactions_category_id', table: 'transactions', column: 'category_id' },
  { name: 'idx_transactions_source_account_id', table: 'transactions', column: 'source_account_id' },
  { name: 'idx_holdings_account_id', table: 'holdings', column: 'account_id' },
  { name: 'idx_contributions_account_id', table: 'contributions', column: 'account_id' },
  { name: 'idx_account_snapshots_account_id', table: 'account_snapshots', column: 'account_id' },
];

describe('0034_add_query_indexes', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
  });

  afterEach(async () => {
    await db.close();
  });

  it('is recorded in schema_migrations after loadAllMigrations()', async () => {
    const rows = await db.select<{ version: string }>(
      `SELECT version FROM schema_migrations WHERE version = '0034_add_query_indexes'`,
    );
    expect(rows).toHaveLength(1);
  });

  it('creates all 6 expected indexes with the correct table binding', async () => {
    const rows = await db.select<IndexInfo>(
      `SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'`,
    );
    const byName = new Map(rows.map((r) => [r.name, r]));
    for (const expected of EXPECTED_INDEXES) {
      const row = byName.get(expected.name);
      expect(row, `index ${expected.name} missing`).toBeDefined();
      expect(row?.tbl_name).toBe(expected.table);
    }
  });

  it('each index covers exactly the expected single column', async () => {
    for (const expected of EXPECTED_INDEXES) {
      const cols = await db.select<IndexedColumn>(
        `PRAGMA index_info('${expected.name}')`,
      );
      expect(cols, `index ${expected.name} index_info empty`).toHaveLength(1);
      expect(cols[0].name).toBe(expected.column);
    }
  });

  it('SELECT FROM transactions WHERE date = ? uses idx_transactions_date (EXPLAIN QUERY PLAN)', async () => {
    // EXPLAIN QUERY PLAN returns a row whose `detail` field includes the
    // text "USING INDEX idx_…" when the planner picks the index. Without
    // the index, the detail would say "SCAN transactions".
    interface PlanRow { detail: string }
    const plan = await db.select<PlanRow>(
      `EXPLAIN QUERY PLAN SELECT id FROM transactions WHERE date = '2026-01-01'`,
    );
    const joined = plan.map((p) => p.detail).join(' | ');
    expect(joined).toContain('idx_transactions_date');
  });

  it('SELECT FROM holdings WHERE account_id = ? uses idx_holdings_account_id', async () => {
    interface PlanRow { detail: string }
    const plan = await db.select<PlanRow>(
      `EXPLAIN QUERY PLAN SELECT id FROM holdings WHERE account_id = 1`,
    );
    const joined = plan.map((p) => p.detail).join(' | ');
    expect(joined).toContain('idx_holdings_account_id');
  });

  it('SELECT FROM contributions WHERE account_id = ? uses idx_contributions_account_id', async () => {
    interface PlanRow { detail: string }
    const plan = await db.select<PlanRow>(
      `EXPLAIN QUERY PLAN SELECT id FROM contributions WHERE account_id = 1`,
    );
    const joined = plan.map((p) => p.detail).join(' | ');
    expect(joined).toContain('idx_contributions_account_id');
  });

  it('SELECT FROM account_snapshots WHERE account_id = ? uses idx_account_snapshots_account_id', async () => {
    interface PlanRow { detail: string }
    const plan = await db.select<PlanRow>(
      `EXPLAIN QUERY PLAN SELECT id FROM account_snapshots WHERE account_id = 1`,
    );
    const joined = plan.map((p) => p.detail).join(' | ');
    expect(joined).toContain('idx_account_snapshots_account_id');
  });

  it('is idempotent — re-running the migration body with CREATE INDEX IF NOT EXISTS does not error', async () => {
    // Capture the set of EXPECTED_INDEXES present before the re-run.
    const expectedNames = EXPECTED_INDEXES.map((e) => e.name);
    const beforeRows = await db.select<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (${expectedNames.map(() => '?').join(',')})`,
      expectedNames,
    );
    expect(beforeRows).toHaveLength(EXPECTED_INDEXES.length);

    // Run the migration body a second time directly. The IF NOT EXISTS
    // guards prevent duplicate-creation errors.
    const m0034 = (await import('@/db/migrations/0034_add_query_indexes.sql?raw')).default;
    await runMigrations(db, [{ version: '0034_add_query_indexes__rerun', sql: m0034 }]);

    // The expected 6 indexes are still present (and not duplicated; SQLite
    // would refuse a duplicate name anyway, but IF NOT EXISTS makes the
    // statement a no-op rather than an error).
    const afterRows = await db.select<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (${expectedNames.map(() => '?').join(',')})`,
      expectedNames,
    );
    expect(afterRows).toHaveLength(EXPECTED_INDEXES.length);
  });
});
