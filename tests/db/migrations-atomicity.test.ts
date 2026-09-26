// Regression guard for the per-migration BEGIN/COMMIT/ROLLBACK wrap added
// to `runMigrations` in the 2026-05-27 backend-lastmile sweep.
//
// Before this wrap, a migration that failed halfway left the DB in a
// half-applied state with no `schema_migrations` row, and the next boot
// would re-run the migration from the start and immediately fail on the
// now-existing CREATE TABLE / column / index. Wave-3 backend review
// flagged this and pointed at migration 0033 (table rebuild) as the most
// expensive demonstration.
//
// The wrap has to skip migrations that self-manage their tx state (0033
// toggles PRAGMA foreign_keys outside any transaction). Detection is a
// statement-initial BEGIN in the runner's own split, comment-stripped
// statements (v1.7.1 U3).

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { runMigrations, loadAllMigrations } from '@/db/migrations';

describe('runMigrations atomicity', () => {
  let db: SqliteAdapter;

  beforeEach(() => {
    db = new SqliteAdapter(':memory:');
  });

  afterEach(async () => {
    await db.close();
  });

  it('rolls back a failing migration and leaves no schema_migrations row', async () => {
    // Mid-migration failure: CREATE TABLE succeeds, second statement fails
    // with a SQL syntax error. Without the wrap, the first table is left in
    // place AND no schema_migrations row records the failed attempt, so the
    // next boot re-runs from the top and fails on the now-existing CREATE.
    // With the wrap, the CREATE rolls back and the migration is retryable.
    const failing = {
      version: 'test_failing',
      sql: `CREATE TABLE atomicity_demo (id INTEGER PRIMARY KEY);
            INSERT INTO this_table_does_not_exist VALUES (1);`,
    };

    await expect(runMigrations(db, [failing])).rejects.toThrow();

    // The CREATE TABLE from the failing migration must NOT survive: the
    // outer wrap rolled the partial work back.
    const tables = await db.select<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='atomicity_demo'",
    );
    expect(tables).toHaveLength(0);

    // schema_migrations must NOT carry a row for the failed migration.
    const recorded = await db.select<{ version: string }>(
      "SELECT version FROM schema_migrations WHERE version = 'test_failing'",
    );
    expect(recorded).toHaveLength(0);
  });

  it('allows retrying a previously-failed migration without "table already exists" errors', async () => {
    const v1Bad = {
      version: 'test_retry',
      sql: `CREATE TABLE retry_demo (id INTEGER PRIMARY KEY);
            INSERT INTO does_not_exist VALUES (1);`,
    };
    await expect(runMigrations(db, [v1Bad])).rejects.toThrow();

    // Now ship a fixed v1 with the same version string. Pre-wrap, this would
    // fail with "table retry_demo already exists" because the half-applied
    // CREATE survived. Post-wrap, the CREATE was rolled back so the retry
    // proceeds cleanly.
    const v1Fixed = {
      version: 'test_retry',
      sql: `CREATE TABLE retry_demo (id INTEGER PRIMARY KEY, fixed INTEGER);`,
    };
    await expect(runMigrations(db, [v1Fixed])).resolves.toBeUndefined();

    const cols = await db.select<{ name: string }>("PRAGMA table_info(retry_demo)");
    expect(cols.map((c) => c.name)).toEqual(['id', 'fixed']);
  });

  it('still runs migration 0033 (which self-manages tx state) successfully via loadAllMigrations', async () => {
    // 0033 has its own BEGIN/COMMIT around a PRAGMA foreign_keys toggle.
    // SQLite would either silently ignore the PRAGMA inside an outer tx
    // OR throw on a nested BEGIN — both bad. The runner detects the
    // self-managed BEGIN and skips the outer wrap for this migration.
    await expect(runMigrations(db, await loadAllMigrations())).resolves.toBeUndefined();

    // Spot-check that 0033 ran (cascade-deletes the disclosure rebuild).
    const recorded = await db.select<{ version: string }>(
      "SELECT version FROM schema_migrations WHERE version = '0033_fix_disclosure_acceptance_fk_actions'",
    );
    expect(recorded).toHaveLength(1);
  });

  it('records schema_migrations only after the body of a wrapped migration succeeds', async () => {
    // Atomicity invariant: the schema_migrations INSERT lives INSIDE the
    // BEGIN/COMMIT, so a body failure rolls it back too.
    const partial = {
      version: 'test_atomic_audit',
      sql: `CREATE TABLE audit_test (id INTEGER PRIMARY KEY);
            INSERT INTO nonexistent VALUES (1);`,
    };
    await expect(runMigrations(db, [partial])).rejects.toThrow();

    const recorded = await db.select<{ version: string }>(
      "SELECT version FROM schema_migrations WHERE version = 'test_atomic_audit'",
    );
    expect(recorded).toHaveLength(0);
  });

  it('does not regress the existing comment-stripping behavior (-- BEGIN ... ignored as comment)', async () => {
    // A migration whose only "BEGIN" appearance is inside a SQL comment
    // must still go through the outer-wrap path, not the self-managed
    // path. (Otherwise we'd silently fail to wrap a migration that needs
    // wrapping.)
    const m = {
      version: 'test_comment_begin',
      sql: `-- BEGIN TRANSACTION below is a comment only
            CREATE TABLE comment_begin_demo (id INTEGER PRIMARY KEY);`,
    };
    await runMigrations(db, [m]);

    const recorded = await db.select<{ version: string }>(
      "SELECT version FROM schema_migrations WHERE version = 'test_comment_begin'",
    );
    expect(recorded).toHaveLength(1);
  });
});

describe('the self-managed detector is statement-initial (v1.7.1 U3)', () => {
  let db: SqliteAdapter;

  beforeEach(() => {
    db = new SqliteAdapter(':memory:');
  });

  afterEach(async () => {
    await db.close();
  });

  it('a CREATE TRIGGER … BEGIN … END body stays on the WRAPPED path: a later failure rolls the table and the trigger back', async () => {
    const m = {
      version: 'u3_trigger_body',
      sql: `CREATE TABLE u3_t (id INTEGER PRIMARY KEY, v INTEGER);
            CREATE TRIGGER u3_trg AFTER INSERT ON u3_t BEGIN UPDATE u3_t SET v = 1 WHERE id = NEW.id; END;
            INSERT INTO u3_missing VALUES (1);`,
    };
    await expect(runMigrations(db, [m])).rejects.toThrow(/u3_missing/);
    expect(await db.select("SELECT name FROM sqlite_master WHERE name IN ('u3_t', 'u3_trg')")).toEqual([]);
  });

  it('a bare `BEGIN;` statement IS self-managed (runs unwrapped, so its own BEGIN does not nest)', async () => {
    const m = {
      version: 'u3_bare_begin',
      sql: `BEGIN;
            CREATE TABLE u3_bare (id INTEGER PRIMARY KEY);
            COMMIT;`,
    };
    await expect(runMigrations(db, [m])).resolves.toBeUndefined();
    expect(await db.select("SELECT name FROM sqlite_master WHERE name = 'u3_bare'")).toEqual([{ name: 'u3_bare' }]);
  });

  it('every other form is self-managed too: BEGIN DEFERRED / IMMEDIATE / EXCLUSIVE [TRANSACTION], any case', async () => {
    for (const [i, begin] of ['begin deferred', 'BEGIN IMMEDIATE TRANSACTION', 'Begin Exclusive', 'BEGIN TRANSACTION'].entries()) {
      const m = { version: `u3_begin_${i}`, sql: `${begin};\nCREATE TABLE u3_b${i} (id INTEGER);\nCOMMIT;` };
      await expect(runMigrations(db, [m])).resolves.toBeUndefined();
    }
  });

  // Code review CR-U3-9: what the detector comment says about a MULTI-line
  // trigger body — unsupported by the splitter, but it fails inside the wrap
  // and leaves nothing behind (the pre-U3 word match ran it unwrapped).
  it('a trigger body spread over several lines fails, inside the wrap: the table before it rolls back too', async () => {
    const m = {
      version: 'u3_multiline_trigger',
      sql: `CREATE TABLE u3_ml (id INTEGER PRIMARY KEY, v INTEGER);
            CREATE TRIGGER u3_ml_trg AFTER INSERT ON u3_ml BEGIN
              UPDATE u3_ml SET v = 1 WHERE id = NEW.id;
            END;`,
    };
    await expect(runMigrations(db, [m])).rejects.toThrow();
    expect(await db.select("SELECT name FROM sqlite_master WHERE name IN ('u3_ml', 'u3_ml_trg')")).toEqual([]);
  });

  // Code review CR-U3-9: SQLite also accepts a transaction NAME after TRANSACTION
  // (`BEGIN [DEFERRED|IMMEDIATE|EXCLUSIVE] TRANSACTION name`).
  it('the named form is self-managed too: BEGIN TRANSACTION name, with or without a type (planted)', async () => {
    for (const [i, begin] of ['BEGIN TRANSACTION u3_named', 'begin immediate transaction u3_named'].entries()) {
      const m = { version: `u3_named_${i}`, sql: `${begin};\nCREATE TABLE u3_n${i} (id INTEGER);\nCOMMIT;` };
      await expect(runMigrations(db, [m])).resolves.toBeUndefined();
    }
  });
});
