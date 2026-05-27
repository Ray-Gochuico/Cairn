// Regression guard for migration 0034 — adds 6 covering indexes for the hot
// query paths the Data Architecture review (2026-05-26) flagged as performing
// full table scans on ~100k-row tables.
//
// Expected speedups (per the 2026-05-26 review):
//   - transactions(date)              ~9 ms → ~1 ms for time-bucketed scans
//   - transactions(category_id)       budget breakdowns
//   - transactions(source_account_id) per-account ledgers
//   - holdings(account_id)            net-worth aggregation
//   - contributions(account_id)       per-account contribution sums
//   - account_snapshots(account_id)   snapshot history
//
// This test simply asserts the named indexes are present in sqlite_master
// after the migration has run. The exact query-plan / EXPLAIN-shape coverage
// belongs in a perf benchmark; this is a presence guard so the indexes
// don't quietly disappear in a future schema rewrite.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';

const EXPECTED_INDEXES = [
  { name: 'idx_transactions_date',              table: 'transactions',       column: 'date' },
  { name: 'idx_transactions_category_id',       table: 'transactions',       column: 'category_id' },
  { name: 'idx_transactions_source_account_id', table: 'transactions',       column: 'source_account_id' },
  { name: 'idx_holdings_account_id',            table: 'holdings',           column: 'account_id' },
  { name: 'idx_contributions_account_id',       table: 'contributions',      column: 'account_id' },
  { name: 'idx_account_snapshots_account_id',   table: 'account_snapshots',  column: 'account_id' },
];

describe('migration 0034 — query indexes', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    await runMigrations(db, await loadAllMigrations());
  });

  afterEach(async () => {
    await db.close();
  });

  it.each(EXPECTED_INDEXES)(
    'creates $name on $table($column)',
    async ({ name, table }) => {
      const rows = await db.select<{ name: string; tbl_name: string; sql: string }>(
        `SELECT name, tbl_name, sql
           FROM sqlite_master
          WHERE type = 'index' AND name = ?`,
        [name],
      );
      expect(rows, `index ${name} should exist`).toHaveLength(1);
      expect(rows[0].tbl_name).toBe(table);
    },
  );

  it('all six indexes are listed in sqlite_master as a single set', async () => {
    const rows = await db.select<{ name: string }>(
      `SELECT name FROM sqlite_master
        WHERE type = 'index' AND name LIKE 'idx_%'
        ORDER BY name`,
    );
    const names = rows.map((r) => r.name);
    for (const expected of EXPECTED_INDEXES) {
      expect(names, `${expected.name} present in sqlite_master`).toContain(expected.name);
    }
  });
});
