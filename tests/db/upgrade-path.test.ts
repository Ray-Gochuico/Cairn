import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import {
  MAX_SCHEMA_VERSION,
  loadAllMigrations,
  pendingMigrations,
  readChainMarker,
  readUserVersion,
  runMigrations,
  type Migration,
} from '@/db/migrations';
import { seedSchemaFile } from '../helpers/seed-schema-file';
import { DISTINCT_RELEASED_SCHEMAS } from './released-schemas';
import { seedAtSchema, seedBefore0030 } from './upgrade-path-seed';

/**
 * v1.7.1 U3 — the released-schema upgrade harness. For every schema a released
 * build ever left a file at (tests/db/released-schemas.ts), a temp FILE (WAL,
 * like prod) is replayed to that schema with rows that reach 0030/0031/0033's
 * data branches, given a row in every user table, closed and reopened like a
 * relaunch, and run through the FULL chain. It asserts on rows and schema,
 * never on "file untouched": even a zero-migration boot writes
 * `CREATE TABLE IF NOT EXISTS schema_migrations` and the header stamp.
 */

let dir: string;
let all: Migration[];
let FRESH: string[];

async function schemaOf(db: SqliteAdapter): Promise<string[]> {
  const rows = await db.select<{ type: string; name: string; tbl_name: string; sql: string | null }>(
    "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name",
  );
  return rows.map((r) => `${r.type}|${r.name}|${r.tbl_name}|${(r.sql ?? '').replace(/\s+/g, ' ').trim()}`);
}

async function userTables(db: SqliteAdapter): Promise<string[]> {
  const rows = await db.select<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations' ORDER BY name",
  );
  return rows.map((r) => r.name);
}

async function countsOf(db: SqliteAdapter): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of await userTables(db)) {
    out[t] = (await db.select<{ n: number }>(`SELECT COUNT(*) AS n FROM "${t}"`))[0].n;
  }
  return out;
}

async function one<T>(db: SqliteAdapter, sql: string): Promise<T> {
  return (await db.select<T>(sql))[0];
}

/** Tables with no row: D-U3-10's coverage rule wants none before the chain runs (planted below, plan review R-3b). */
function emptyTables(counts: Record<string, number>): string[] {
  return Object.entries(counts).filter(([, c]) => c === 0).map(([t]) => t);
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'cairn-upgrade-'));
  all = await loadAllMigrations();
  const fresh = new SqliteAdapter(path.join(dir, 'fresh.db'));
  await runMigrations(fresh, all);
  FRESH = await schemaOf(fresh);
  await fresh.close();
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Replay to schema n the way a user's file got there: 1..29, the pre-0030 rows, then 30..n. */
async function replayTo(file: string, n: number, at29?: Record<string, number>): Promise<SqliteAdapter> {
  const db = new SqliteAdapter(file);
  await runMigrations(db, all.slice(0, 29));
  await seedBefore0030(db);
  if (at29) Object.assign(at29, await countsOf(db));
  await runMigrations(db, all.slice(0, n));
  return db;
}

describe('the every-table-holds-a-row rule (D-U3-10) is real', () => {
  it('reports a planted empty table, and only it (planted)', async () => {
    const probe = new SqliteAdapter(':memory:');
    try {
      await probe.execute('CREATE TABLE u3_full (id INTEGER)');
      await probe.execute('INSERT INTO u3_full VALUES (1)');
      await probe.execute('CREATE TABLE u3_planted_empty (id INTEGER)');
      expect(emptyTables(await countsOf(probe))).toEqual(['u3_planted_empty']);
    } finally {
      await probe.close();
    }
  });
});

describe.each(DISTINCT_RELEASED_SCHEMAS)('upgrade from released schema %i', (n) => {
  const at: Record<string, unknown> = {};
  const at29: Record<string, number> = {};
  let before: Record<string, number>;
  let after: Record<string, number>;
  let db: SqliteAdapter;

  beforeAll(async () => {
    const file = path.join(dir, `schema-${n}.db`);
    const built = await replayTo(file, n, at29);
    at.stagedSchema = await schemaOf(built); // the staged replay at n, before any row is added (code review CR-U3-8b)
    at.userVersion = await readUserVersion(built);
    at.marker = await readChainMarker(built);
    at.applied = (await pendingMigrations(built, all)).applied;
    at.persons = await built.select<{ id: number }>('SELECT id FROM persons ORDER BY id');
    at.holdings = await built.select<{ ticker: string }>('SELECT ticker FROM holdings ORDER BY ticker');
    at.orphanSnapshots = (await one<{ n: number }>(built, 'SELECT COUNT(*) AS n FROM account_snapshots')).n;
    at.checkingOwner = (await one<{ o: number | null }>(built, 'SELECT owner_person_id AS o FROM accounts WHERE id = 2')).o;
    at.federal = await built.select<{ filing_status: string; standard_deduction: number }>(
      "SELECT filing_status, standard_deduction FROM tax_rules WHERE year = 2026 AND jurisdiction_type = 'FEDERAL' AND jurisdiction_code = 'US' ORDER BY filing_status",
    );
    at.rebuiltRows = [
      (await one<{ n: number }>(built, 'SELECT COUNT(*) AS n FROM disclosure_acceptances')).n,
      (await one<{ n: number }>(built, 'SELECT COUNT(*) AS n FROM roadmap_node_overrides')).n,
    ];
    at.disclosureOnDelete = (await one<{ on_delete: string }>(built, "SELECT on_delete FROM pragma_foreign_key_list('disclosure_acceptances')")).on_delete;
    await seedAtSchema(built, n);
    before = await countsOf(built);
    await built.close(); // checkpoints the WAL: the file on disk is what a relaunch opens
    db = new SqliteAdapter(file);
    await runMigrations(db, all);
    after = await countsOf(db);
  });
  afterAll(async () => { await db.close(); });

  it(`replays to ${n}: user_version ${n} is the runner's own stamp, the chain left no marker, and ${n} registry names are recorded`, () => {
    expect(at.userVersion).toBe(n);
    expect(at.marker).toBeNull();
    expect(at.applied).toBe(n);
  });

  it('0030 swept the orphans it was written for, 0031 updated the four 2026 federal rows, and 0033 rebuilt disclosure_acceptances with its rows and ON DELETE CASCADE', () => {
    expect([at29.persons, at29.holdings, at29.account_snapshots]).toEqual([2, 2, 1]); // the orphans were really there at 29
    expect(at.persons).toEqual([{ id: 1 }]);                      // person 99 (household 2) removed
    expect(at.holdings).toEqual([{ ticker: 'VTI' }]);              // the account-999 holding removed
    expect(at.orphanSnapshots).toBe(0);                             // the account-999 snapshot removed
    expect(at.checkingOwner).toBeNull();                            // a dangling owner is set NULL, the account kept
    expect(at.federal).toEqual([
      { filing_status: 'HOH', standard_deduction: 24150 },
      { filing_status: 'MFJ', standard_deduction: 32200 },
      { filing_status: 'MFS', standard_deduction: 16100 },
      { filing_status: 'SINGLE', standard_deduction: 16100 },
    ]);
    expect(at.rebuiltRows).toEqual([1, 1]);                        // 0033's rebuild copied its rows
    expect(at.disclosureOnDelete).toBe('CASCADE');
  });

  it('every user table holds a row before the chain runs (so an ADD COLUMN NOT NULL without a default would fail here, not on a user)', () => {
    expect(emptyTables(before)).toEqual([]);
  });

  it(`→ ${MAX_SCHEMA_VERSION}: quick_check ok, no foreign-key violations, exactly the registry's names recorded, user_version ${MAX_SCHEMA_VERSION}, no chain marker`, async () => {
    expect((await one<{ quick_check: string }>(db, 'PRAGMA quick_check')).quick_check).toBe('ok');
    expect(await db.select('PRAGMA foreign_key_check')).toEqual([]);
    const recorded = (await db.select<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version')).map((r) => r.version);
    expect(recorded).toEqual(all.map((m) => m.version));
    expect(await readUserVersion(db)).toBe(MAX_SCHEMA_VERSION);
    expect(await readChainMarker(db)).toBeNull();
  });

  it('every row is preserved: each table that existed at the released schema holds exactly as many rows after the chain', () => {
    for (const [t, c] of Object.entries(before)) expect([t, after[t]]).toEqual([t, c]);
  });

  it('the upgraded schema is identical to a fresh build (normalized sqlite_master)', async () => {
    expect(await schemaOf(db)).toEqual(FRESH);
  });

  it(`U1's smoke seed (seedSchemaFile, its re-stamp line gone) writes the same schema-${n} file: user_version ${n}, ${n} names, the staged replay's sqlite_master`, async () => {
    const out = path.join(dir, `seed-${n}.db`);
    await seedSchemaFile(out, n);
    const seeded = new SqliteAdapter(out);
    try {
      expect(await readUserVersion(seeded)).toBe(n);
      expect((await pendingMigrations(seeded, all)).applied).toBe(n);
      expect(await schemaOf(seeded)).toEqual(at.stagedSchema); // the staged replay (1..29, the pre-0030 rows, 30..n), not a second prefix run
    } finally {
      await seeded.close();
    }
  });
});

describe.each(DISTINCT_RELEASED_SCHEMAS.filter((n) => n + 2 <= MAX_SCHEMA_VERSION))(
  'crash-resume from released schema %i: the (n+2)th migration fails mid-chain',
  (n) => {
    it('user_version is n+1 (the committed migration stamped itself), the marker keeps origin n, and the real chain then finishes with the marker gone and a fresh-build schema', async () => {
      const file = path.join(dir, `crash-${n}.db`);
      const db = await replayTo(file, n);
      await seedAtSchema(db, n);
      const failing = all.map((m, i) =>
        i === n + 1 ? { ...m, sql: 'CREATE TABLE u3_crash_probe (id INTEGER PRIMARY KEY);\nINSERT INTO u3_no_such_table VALUES (1);' } : m,
      );
      await expect(runMigrations(db, failing)).rejects.toThrow(/u3_no_such_table/);
      expect(await readUserVersion(db)).toBe(n + 1);
      expect((await pendingMigrations(db, all)).applied).toBe(n + 1);
      expect(await readChainMarker(db)).toEqual({ origin: n, target: MAX_SCHEMA_VERSION });
      expect(await db.select("SELECT name FROM sqlite_master WHERE name = 'u3_crash_probe'")).toEqual([]);
      await db.close();
      const again = new SqliteAdapter(file);
      await runMigrations(again, all);
      expect(await readUserVersion(again)).toBe(MAX_SCHEMA_VERSION);
      expect(await readChainMarker(again)).toBeNull();
      expect(await schemaOf(again)).toEqual(FRESH);
      await again.close();
    });
  },
);

describe('0033 — shipped, self-managed, NOT edited: how "recorded" and "applied" disagree', () => {
  it('applied but NOT recorded (the crash window between its COMMIT and its audit row): the next run re-runs it cleanly — rows kept, schema identical to a fresh build', async () => {
    const db = new SqliteAdapter(path.join(dir, 'u3-0033-applied.db'));
    await runMigrations(db, all.slice(0, 33));
    await db.execute("INSERT INTO disclosure_acceptances (household_id, document_id, version, accepted_at) VALUES (1, 'app_wide', '1.0', '2026-01-01T00:00:00Z')");
    await db.execute("DELETE FROM schema_migrations WHERE version = '0033_fix_disclosure_acceptance_fk_actions'");
    await db.execute('PRAGMA user_version = 32');
    await runMigrations(db, all);
    expect((await one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM disclosure_acceptances')).n).toBe(1);
    expect(await db.select('PRAGMA foreign_keys')).toEqual([{ foreign_keys: 1 }]); // 0033 turned them back on
    expect(await readUserVersion(db)).toBe(MAX_SCHEMA_VERSION);
    expect(await schemaOf(db)).toEqual(FRESH);
    await db.close();
  });

  it('recorded but NOT applied: the runner never re-runs it — "applied" is keyed by NAME (why the registry key strings are frozen)', async () => {
    const db = new SqliteAdapter(path.join(dir, 'u3-0033-recorded.db'));
    await runMigrations(db, all.slice(0, 32));
    await db.execute("INSERT INTO schema_migrations (version) VALUES ('0033_fix_disclosure_acceptance_fk_actions')");
    await runMigrations(db, all);
    expect((await one<{ on_delete: string }>(db, "SELECT on_delete FROM pragma_foreign_key_list('disclosure_acceptances')")).on_delete).toBe('NO ACTION');
    const diff = (await schemaOf(db)).filter((row) => !FRESH.includes(row));
    expect(diff.map((row) => row.split('|')[1])).toEqual(['disclosure_acceptances', 'roadmap_node_overrides']);
    await db.close();
  });
});
