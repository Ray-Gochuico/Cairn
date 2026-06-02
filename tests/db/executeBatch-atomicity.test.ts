// Parity + atomicity guard for the `executeBatch` single-connection batch
// primitive (v1.0 ship-blocker: the prod↔test SQL parity gap).
//
// THE BUG THIS DOCUMENTS
// ----------------------
// Tests run against ONE synchronous better-sqlite3 connection. Prod runs
// `@tauri-apps/plugin-sql` → a sqlx connection POOL that hands out a
// DIFFERENT physical connection per `db.execute()` call. The app expressed
// transactions as THREE separate execute() calls (`BEGIN`, body, `COMMIT`),
// which the pool routes to three different connections — so in prod the
// "transaction" wrapped NOTHING: BEGIN opened a tx on connection A, the body
// autocommitted on connection B, COMMIT errored on connection C. A single-
// connection test adapter is structurally BLIND to this, which is why no
// existing test caught it.
//
// `describe('the pool-bug class …')` reproduces that blindness by opening TWO
// real better-sqlite3 handles to the SAME temp file and showing that a
// BEGIN-on-A / write-on-B / COMMIT-on-A sequence does NOT roll back B's write
// on failure. The rest proves the fix: `executeBatch(..., {transaction:true})`
// runs every statement on ONE connection and is atomic all-or-nothing.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations } from '@/db/migrations';

describe('the pool-bug class: multi-connection BEGIN/body/COMMIT wraps nothing', () => {
  // This block does NOT use executeBatch — it demonstrates WHY prod was broken
  // and WHY a single-connection test harness could never see it. It opens two
  // handles to the same file (standing in for two pooled connections) and runs
  // the OLD three-call transaction pattern across them.
  let dir: string;
  let file: string;
  let connA: BetterSqlite3.Database;
  let connB: BetterSqlite3.Database;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'finance-poolbug-'));
    file = join(dir, 'poolbug.db');
    connA = new BetterSqlite3(file);
    connB = new BetterSqlite3(file);
    for (const c of [connA, connB]) {
      c.pragma('journal_mode = WAL');
      c.pragma('busy_timeout = 5000');
    }
    connA.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
  });

  afterEach(() => {
    connA.close();
    connB.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('BEGIN on connection A does NOT wrap a write that lands on connection B', () => {
    // Mirror the prod sequence: BEGIN routes to A, the body routes to B,
    // and then the "transaction" fails before any COMMIT. Because BEGIN
    // only opened a transaction on A — and B autocommitted its own write
    // immediately — B's row survives. There is no rollback, because there
    // was never a transaction around B's write. This is the silent
    // data-integrity hole the single-connection test adapter masked.
    connA.exec('BEGIN');
    connB.prepare('INSERT INTO t (v) VALUES (?)').run('written-on-B');

    // Simulate the body throwing here, before COMMIT. Roll back A's (empty)
    // transaction — the only thing BEGIN actually opened.
    connA.exec('ROLLBACK');

    // B's write is still there: it was never inside A's transaction.
    const rows = connB.prepare('SELECT v FROM t').all() as { v: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].v).toBe('written-on-B');
  });
});

describe('executeBatch atomicity (single-connection primitive)', () => {
  let db: SqliteAdapter;

  beforeEach(() => {
    db = new SqliteAdapter(':memory:');
  });

  afterEach(async () => {
    await db.close();
  });

  it('rolls back every statement when one fails (transaction defaults to true)', async () => {
    await db.execute('CREATE TABLE batch_demo (id INTEGER PRIMARY KEY, v TEXT)');

    // A batch whose 2nd statement writes a good row, 3rd writes another,
    // and 4th fails with a SQL error. Atomic semantics: NONE of the writes
    // survive. (transaction defaults to true, so no option passed here.)
    await expect(
      db.executeBatch([
        { sql: 'INSERT INTO batch_demo (v) VALUES (?)', params: ['first'] },
        { sql: 'INSERT INTO batch_demo (v) VALUES (?)', params: ['second'] },
        { sql: 'INSERT INTO this_table_does_not_exist VALUES (1)' },
      ]),
    ).rejects.toThrow();

    const rows = await db.select<{ v: string }>('SELECT v FROM batch_demo');
    expect(rows).toHaveLength(0);
  });

  it('commits every statement when the batch is clean', async () => {
    await db.execute('CREATE TABLE batch_ok (id INTEGER PRIMARY KEY, v TEXT)');

    await db.executeBatch([
      { sql: 'INSERT INTO batch_ok (v) VALUES (?)', params: ['a'] },
      { sql: 'INSERT INTO batch_ok (v) VALUES (?)', params: ['b'] },
      { sql: 'INSERT INTO batch_ok (v) VALUES (?)', params: ['c'] },
    ]);

    const rows = await db.select<{ v: string }>('SELECT v FROM batch_ok ORDER BY id');
    expect(rows.map((r) => r.v)).toEqual(['a', 'b', 'c']);
  });

  it('with transaction:false runs statements in order with no outer wrap', async () => {
    // transaction:false is for self-managed migrations (0033) that carry
    // their OWN BEGIN/COMMIT/PRAGMA. The primitive must run each statement
    // in order on one connection without adding a wrapping transaction.
    // Here we let a self-contained BEGIN/COMMIT pass through cleanly.
    await db.executeBatch(
      [
        { sql: 'CREATE TABLE self_managed (id INTEGER PRIMARY KEY, v TEXT)' },
        { sql: 'BEGIN' },
        { sql: 'INSERT INTO self_managed (v) VALUES (?)', params: ['x'] },
        { sql: 'COMMIT' },
      ],
      { transaction: false },
    );

    const rows = await db.select<{ v: string }>('SELECT v FROM self_managed');
    expect(rows.map((r) => r.v)).toEqual(['x']);
  });

  it('with transaction:false does NOT add a wrap that would break a PRAGMA foreign_keys toggle', async () => {
    // The core reason 0033 must use transaction:false: SQLite silently
    // ignores `PRAGMA foreign_keys` inside an open transaction. If the
    // primitive wrapped these in BEGIN/COMMIT, the toggle would no-op.
    // Run the toggle outside any wrap and confirm it actually takes effect.
    await db.executeBatch([{ sql: 'PRAGMA foreign_keys = OFF' }], { transaction: false });
    const off = await db.select<{ foreign_keys: number }>('PRAGMA foreign_keys');
    expect(off[0].foreign_keys).toBe(0);

    await db.executeBatch([{ sql: 'PRAGMA foreign_keys = ON' }], { transaction: false });
    const on = await db.select<{ foreign_keys: number }>('PRAGMA foreign_keys');
    expect(on[0].foreign_keys).toBe(1);
  });
});

describe('runMigrations atomicity via executeBatch', () => {
  let db: SqliteAdapter;

  beforeEach(() => {
    db = new SqliteAdapter(':memory:');
  });

  afterEach(async () => {
    await db.close();
  });

  it('a migration whose body throws mid-way leaves no partial schema AND no schema_migrations row', async () => {
    // The migration runner now wraps each normal migration in a single
    // executeBatch({transaction:true}) so a body failure rolls back BOTH the
    // partial schema AND the audit row. This is the invariant the pool bug
    // silently broke in prod: the BEGIN/COMMIT wrapped nothing, so a killed
    // app-update mid-migration could half-apply schema with no audit row,
    // then re-run and fail on the now-existing CREATE TABLE next boot.
    const failing = {
      version: 'test_batch_partial',
      sql: `CREATE TABLE batch_partial_demo (id INTEGER PRIMARY KEY);
            CREATE INDEX idx_batch_partial ON batch_partial_demo (id);
            INSERT INTO a_table_that_does_not_exist VALUES (1);`,
    };

    await expect(runMigrations(db, [failing])).rejects.toThrow();

    const tables = await db.select<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='batch_partial_demo'",
    );
    expect(tables).toHaveLength(0);

    const indexes = await db.select<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_batch_partial'",
    );
    expect(indexes).toHaveLength(0);

    const recorded = await db.select<{ version: string }>(
      "SELECT version FROM schema_migrations WHERE version = 'test_batch_partial'",
    );
    expect(recorded).toHaveLength(0);
  });
});
