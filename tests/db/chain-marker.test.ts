import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import {
  loadAllMigrations,
  pendingMigrations,
  readChainMarker,
  runMigrations,
  type Migration,
} from '@/db/migrations';

/**
 * v1.7.1 U3 (U1 chip b) — the update-chain marker. Per-migration stamping makes
 * a file an interrupted update left partway read like a clean schema-k file, so
 * the runner records the chain's ORIGIN in a `chain:<origin>-><target>` row of
 * schema_migrations, atomically with the chain's first migration, and removes
 * it atomically with the last.
 */
describe('the update-chain marker (runner side)', () => {
  let db: SqliteAdapter;
  let all: Migration[];
  const failAt = (i: number) =>
    all.map((m, k) => (k === i ? { ...m, sql: 'CREATE TABLE u3_probe (id INTEGER);\nINSERT INTO u3_missing VALUES (1);' } : m));

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    all = await loadAllMigrations();
  });
  afterEach(async () => { await db.close(); });

  const markerRows = async () =>
    (await db.select<{ version: string }>("SELECT version FROM schema_migrations WHERE version LIKE 'chain:%'")).map((r) => r.version);

  it('an update chain that stops after its first migration leaves exactly one marker naming the origin and the target', async () => {
    await runMigrations(db, all.slice(0, 53));
    await expect(runMigrations(db, failAt(54))).rejects.toThrow(/u3_missing/);
    expect(await markerRows()).toEqual(['chain:53->55']);
    expect(await readChainMarker(db)).toEqual({ origin: 53, target: 55 });
  });

  it('the marker commits WITH the first migration: a chain whose first migration fails leaves no marker and nothing applied', async () => {
    await runMigrations(db, all.slice(0, 53));
    await expect(runMigrations(db, failAt(53))).rejects.toThrow(/u3_missing/);
    expect(await markerRows()).toEqual([]);
    expect((await pendingMigrations(db, all)).applied).toBe(53);
  });

  it('a resumed chain keeps the ORIGINAL origin, and the chain that finishes removes the marker', async () => {
    await runMigrations(db, all.slice(0, 50));
    await expect(runMigrations(db, failAt(52))).rejects.toThrow(/u3_missing/); // 0051, 0052 commit; 0053 fails
    expect(await readChainMarker(db)).toEqual({ origin: 50, target: 55 });
    await expect(runMigrations(db, failAt(53))).rejects.toThrow(/u3_missing/); // the resume: 0053 commits; 0054 fails
    expect(await readChainMarker(db)).toEqual({ origin: 50, target: 55 });  // not 52
    await runMigrations(db, all);
    expect(await markerRows()).toEqual([]);
  });

  /**
   * Every chain-marker INSERT the runner sends while `run` executes, batched or
   * not. A finished chain clears its markers, so the table alone cannot show
   * whether one was ever written (code review CR-U3-8a): each "no marker" arm
   * below watches the statements instead.
   */
  async function markerInserts(run: () => Promise<unknown>): Promise<string[]> {
    const seen: string[] = [];
    const note = (sql: string, params: unknown[] = []) => {
      if (!/^\s*INSERT\b/i.test(sql)) return;
      for (const p of params) if (typeof p === 'string' && p.startsWith('chain:')) seen.push(p);
      if (sql.includes("'chain:")) seen.push(sql);
    };
    const realBatch = db.executeBatch.bind(db);
    const realExecute = db.execute.bind(db);
    db.executeBatch = async (statements, options) => {
      for (const st of statements) note(st.sql, st.params);
      return realBatch(statements, options);
    };
    db.execute = async (sql, params) => {
      note(sql, params);
      return realExecute(sql, params);
    };
    try {
      await run();
    } finally {
      db.executeBatch = realBatch;
      db.execute = realExecute;
    }
    return seen;
  }

  it('a fresh file (applied 0) never writes a marker, not even mid-chain', async () => {
    expect(await markerInserts(() => runMigrations(db, all.slice(0, 54)))).toEqual([]);
    expect(await markerRows()).toEqual([]);
  });

  it('a one-migration chain never writes a marker (it commits or it does not — nothing to resume)', async () => {
    await runMigrations(db, all.slice(0, 54));
    expect(await markerInserts(() => runMigrations(db, all))).toEqual([]);
    expect(await markerRows()).toEqual([]);
  });

  it('a boot with nothing pending never writes a marker', async () => {
    await runMigrations(db, all);
    expect(await markerInserts(() => runMigrations(db, all))).toEqual([]);
    expect(await markerRows()).toEqual([]);
  });

  // Plan review R-4: the `origin > 0` rule, observed on a chain that does NOT finish
  // (a finished chain clears its markers, so the fresh-file case above cannot see it).
  it('a first install that stops partway leaves no marker (origin 0: there is no earlier schema to resume from)', async () => {
    await expect(runMigrations(db, failAt(5))).rejects.toThrow(/u3_missing/); // 0001-0005 commit; 0006 fails
    expect(await markerRows()).toEqual([]);
    expect((await pendingMigrations(db, all)).applied).toBe(5);
  });

  // Code review CR-U3-7: a file a pre-U3 runner left partway carries its origin
  // only as 0 < user_version < applied; the marker must keep that origin.
  it('a chain on a PRE-U3 partway file (user_version 52 < applied 53) marks origin 52; a user_version of 0 or ≥ applied is not an origin', async () => {
    await runMigrations(db, all.slice(0, 53));
    await db.execute('PRAGMA user_version = 52');
    await expect(runMigrations(db, failAt(54))).rejects.toThrow(/u3_missing/);
    expect(await readChainMarker(db)).toEqual({ origin: 52, target: 55 });
    for (const uv of [0, 55]) {   // a pre-guard dev file (0), and a pre-U3 runner's constant stamp after a subset (55)
      const other = new SqliteAdapter(':memory:');
      try {
        await runMigrations(other, all.slice(0, 53));
        await other.execute(`PRAGMA user_version = ${uv}`);
        await expect(runMigrations(other, failAt(54))).rejects.toThrow(/u3_missing/);
        expect([uv, await readChainMarker(other)]).toEqual([uv, { origin: 53, target: 55 }]);
      } finally {
        await other.close();
      }
    }
  });

  it('a stale marker for another target is replaced by the next chain and removed when it finishes', async () => {
    await runMigrations(db, all.slice(0, 50));
    await db.execute("INSERT INTO schema_migrations (version) VALUES ('chain:47->53')");
    await expect(runMigrations(db, failAt(52))).rejects.toThrow(/u3_missing/);
    expect(await markerRows()).toEqual(['chain:50->55']);
    await runMigrations(db, all);
    expect(await markerRows()).toEqual([]);
  });

  it('a marker never counts as applied, and the registry names stay exactly the registry', async () => {
    await runMigrations(db, all.slice(0, 53));
    await expect(runMigrations(db, failAt(54))).rejects.toThrow();
    expect((await pendingMigrations(db, all)).applied).toBe(54);
    expect(all.some((m) => m.version.startsWith('chain:'))).toBe(false);
  });
});

describe('readChainMarker (read-only)', () => {
  let db: SqliteAdapter;
  beforeEach(() => { db = new SqliteAdapter(':memory:'); });
  afterEach(async () => { await db.close(); });

  it('is null — and creates nothing — when schema_migrations is absent', async () => {
    expect(await readChainMarker(db)).toBeNull();
    expect(await db.select("SELECT name FROM sqlite_master WHERE name = 'schema_migrations'")).toEqual([]);
  });

  it('is null with no marker row, parses a marker row, and ignores a row that only starts like one', async () => {
    await db.execute('CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
    await db.execute("INSERT INTO schema_migrations (version) VALUES ('0001_initial'), ('chain:oops')");
    expect(await readChainMarker(db)).toBeNull();
    await db.execute("INSERT INTO schema_migrations (version) VALUES ('chain:47->55')");
    expect(await readChainMarker(db)).toEqual({ origin: 47, target: 55 });
  });
});
