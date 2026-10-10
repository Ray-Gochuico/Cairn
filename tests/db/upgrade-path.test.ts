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
/** Rows a fresh build's migrations seed, per table (reference data: tax_rules, categories, tickers, household, …). */
let FRESH_ROWS: Record<string, number>;
/** A fresh build's columns, per user table (v1.8.0 H1: the rows the content check reads after a chain are an upgraded file's). */
let FRESH_COLUMNS: Record<string, string[]>;

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

/**
 * Columns with an ON DELETE action (SET NULL, SET DEFAULT, CASCADE) that are
 * NULL in every row: a cascade into them would change nothing the content
 * check can see (v1.8.0 H1; planted below). [] = every such column holds a value.
 */
async function unseededActionColumns(db: SqliteAdapter): Promise<string[]> {
  const out: string[] = [];
  for (const t of await userTables(db)) {
    const fks = await db.select<{ from: string; on_delete: string }>(`SELECT "from", on_delete FROM pragma_foreign_key_list('${t}')`);
    for (const fk of fks) {
      if (!['SET NULL', 'SET DEFAULT', 'CASCADE'].includes(fk.on_delete)) continue;
      const held = (await db.select<{ n: number }>(`SELECT COUNT("${fk.from}") AS n FROM "${t}"`))[0].n;
      if (held === 0) out.push(`${t}.${fk.from}`);
    }
  }
  return out.sort();
}

/** One user table's rows with every column, and the columns that key them (v1.8.0 H1, post-release review L14). */
interface TableRows {
  pk: string[];
  columns: string[];
  rows: Record<string, unknown>[];
}

/** Every row of every user table. A table without a primary key fails here: the content check matches rows by it. */
async function rowsOf(db: SqliteAdapter): Promise<Map<string, TableRows>> {
  const out = new Map<string, TableRows>();
  for (const t of await userTables(db)) {
    const info = await db.select<{ name: string; pk: number }>(`SELECT name, pk FROM pragma_table_info('${t}') ORDER BY cid`);
    const pk = info.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
    if (pk.length === 0) throw new Error(`${t} has no primary key, and the upgrade harness matches rows by primary key`);
    out.set(t, { pk, columns: info.map((c) => c.name), rows: await db.select<Record<string, unknown>>(`SELECT * FROM "${t}"`) });
  }
  return out;
}

/** A rewrite a migration means to make to rows that existed before it ran: these columns, in these rows of this table, may change or go. */
interface IntendedRewrite {
  table: string;
  /** The rows it rewrites, as a test of a pre-chain row (e.g. `(r) => r.id === 1`); the same columns of every other row must still read the same. */
  rows: (row: Readonly<Record<string, unknown>>) => boolean;
  /** The columns it rewrites in those rows; the hygiene check requires each to change when the migration is replayed alone. */
  columns: readonly string[];
  /** Columns it may also stamp whose value can stay the same (CURRENT_TIMESTAMP within the same second): exempt like `columns`, but not required to change. */
  volatile?: readonly string[];
}

/**
 * v1.8.0 H1 (post-release review L14): the INTENDED rewrites, per migration.
 * The content check accepts a change to a listed column, in a row the entry's
 * `rows` test selects, of a listed table, only on a chain that runs that
 * migration (its ordinal is above the released schema the chain starts from);
 * any other change to a row that existed before the chain fails the harness.
 * There is no entry form for a row that goes. The user-row count check
 * (CR-U3-8d) refuses a dropped user row or a dropped table, but it is neutral
 * to the migrations' own seeds, so a migration that deletes a seeded row
 * passes it; this check refuses that row ("the row is gone"). A migration that
 * must delete pre-existing rows extends this harness on purpose (a row-drop
 * form, its planted self-test and its mutant) in the same change; the house
 * precedent for a data refresh is UPDATE in place (0031). Extend this list in
 * the same change as the migration, with the reason.
 */
const INTENDED_REWRITES: Readonly<Record<string, readonly IntendedRewrite[]>> = {
  // 0048 flips the Learn difficulty default on the singleton row (Wave 8) and stamps updated_at.
  '0048_learning_preference_default': [{ table: 'learning_state', rows: (r) => r.id === 1, columns: ['difficulty_preference'], volatile: ['updated_at'] }],
};

/** The rewrites a chain from released schema `n` may make: the entries of the migrations it runs (ordinal > n). */
function rewritesFrom(n: number, migrations: readonly Migration[], rewrites = INTENDED_REWRITES): IntendedRewrite[] {
  return migrations.flatMap((m, i) => (i + 1 > n ? (rewrites[m.version] ?? []) : []));
}

/**
 * Every change a chain made to the rows that existed before it, matched by
 * primary key: a table, a column or a row that is gone, or a value that
 * differs, apart from the `allowed` columns in the rows each entry selects (a
 * column may go only if an entry lists it and selects every row). [] = every
 * pre-chain row reads the same after the chain in every column that survives it.
 */
function contentChanges(before: Map<string, TableRows>, after: Map<string, TableRows>, allowed: readonly IntendedRewrite[] = []): string[] {
  const covers = (a: IntendedRewrite, t: string, c: string) => a.table === t && (a.columns.includes(c) || (a.volatile ?? []).includes(c));
  const isAllowed = (t: string, c: string, r: Record<string, unknown>) => allowed.some((a) => covers(a, t, c) && a.rows(r));
  const cell = (v: unknown) => JSON.stringify(v);
  const out: string[] = [];
  for (const [t, was] of before) {
    const now = after.get(t);
    if (!now) {
      out.push(`${t}: the table is gone`);
      continue;
    }
    const keyOf = (r: Record<string, unknown>) => cell(was.pk.map((c) => r[c]));
    const byKey = new Map(now.rows.map((r) => [keyOf(r), r]));
    const mayGo = (c: string) => allowed.some((a) => covers(a, t, c)) && was.rows.every((r) => isAllowed(t, c, r));
    for (const c of was.columns) if (!now.columns.includes(c) && !mayGo(c)) out.push(`${t}.${c}: the column is gone`);
    const kept = was.columns.filter((c) => now.columns.includes(c));
    for (const r of was.rows) {
      const key = keyOf(r);
      const r2 = byKey.get(key);
      if (!r2) {
        out.push(`${t} ${key}: the row is gone`);
        continue;
      }
      for (const c of kept) if (!isAllowed(t, c, r) && cell(r[c]) !== cell(r2[c])) out.push(`${t} ${key} ${c}: ${cell(r[c])} → ${cell(r2[c])}`);
    }
  }
  return out;
}

/** The failure text for contentChanges: the chain, each change, then what to do about an intended one. */
function contentMessage(n: number, changes: readonly string[]): string {
  return [
    '',
    `The chain from released schema ${n} changed rows that existed before it ran:`,
    ...changes.map((c) => `  ${c}`),
    '',
    'An upgrade keeps the rows a user already has. If a migration means to rewrite one of these',
    'columns, add its registry key, the table, the rows it rewrites and the columns to',
    'INTENDED_REWRITES in tests/db/upgrade-path.test.ts in the same change, with the reason. A table rebuild that runs',
    'with foreign keys on nulls or deletes child rows, and shows up here too (post-release review L13).',
    '',
  ].join('\n');
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'cairn-upgrade-'));
  all = await loadAllMigrations();
  const fresh = new SqliteAdapter(path.join(dir, 'fresh.db'));
  await runMigrations(fresh, all);
  FRESH = await schemaOf(fresh);
  FRESH_ROWS = await countsOf(fresh);
  FRESH_COLUMNS = Object.fromEntries([...(await rowsOf(fresh))].map(([t, r]) => [t, r.columns])); // and every table has a primary key
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

  it('…and so is its v1.8.0 H1 extension: an ON DELETE column that no row fills is reported, and only it (planted)', async () => {
    const probe = new SqliteAdapter(':memory:');
    try {
      await probe.execute('CREATE TABLE h1_parent (id INTEGER PRIMARY KEY)');
      await probe.execute('INSERT INTO h1_parent VALUES (1)');
      await probe.execute('CREATE TABLE h1_child (id INTEGER PRIMARY KEY, filled INTEGER REFERENCES h1_parent(id) ON DELETE SET NULL, empty INTEGER REFERENCES h1_parent(id) ON DELETE SET NULL, plain INTEGER REFERENCES h1_parent(id))');
      await probe.execute('INSERT INTO h1_child (id, filled) VALUES (1, 1)');
      expect(await unseededActionColumns(probe)).toEqual(['h1_child.empty']); // `plain` has no ON DELETE action
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
  let seededAtN: Record<string, number>; // what the migrations alone seed by schema n (no user rows)
  let rowsBefore: Map<string, TableRows>; // every row before the chain, every column (L14)
  let unseeded: string[]; // ON DELETE columns no row fills before the chain
  let rowsAfter: Map<string, TableRows>;
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
    rowsBefore = await rowsOf(built);
    unseeded = await unseededActionColumns(built);
    const plain = new SqliteAdapter(':memory:');
    try {
      await runMigrations(plain, all.slice(0, n));
      seededAtN = await countsOf(plain);
    } finally {
      await plain.close();
    }
    await built.close(); // checkpoints the WAL: the file on disk is what a relaunch opens
    db = new SqliteAdapter(file);
    await runMigrations(db, all);
    after = await countsOf(db);
    rowsAfter = await rowsOf(db);
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

  // v1.8.0 H1: a cascade sets NULL or deletes only where a row points at a
  // parent, so the content check below sees one only if the rows fill every
  // column that carries an ON DELETE action.
  it('every column with an ON DELETE action holds a value in some row before the chain runs (so a cascade into it shows in the content check)', () => {
    expect(unseeded).toEqual([]);
  });

  it(`→ ${MAX_SCHEMA_VERSION}: quick_check ok, no foreign-key violations, exactly the registry's names recorded, user_version ${MAX_SCHEMA_VERSION}, no chain marker`, async () => {
    expect((await one<{ quick_check: string }>(db, 'PRAGMA quick_check')).quick_check).toBe('ok');
    expect(await db.select('PRAGMA foreign_key_check')).toEqual([]);
    const recorded = (await db.select<{ version: string }>('SELECT version FROM schema_migrations ORDER BY version')).map((r) => r.version);
    expect(recorded).toEqual(all.map((m) => m.version));
    expect(await readUserVersion(db)).toBe(MAX_SCHEMA_VERSION);
    expect(await readChainMarker(db)).toBeNull();
  });

  // Code review CR-U3-8d: exact for the USER's rows, neutral to the chain's own
  // seeds. A table's user rows are its rows beyond what the migrations seed (at
  // schema n before the chain, in a fresh build after it), so a later
  // reference-data migration (a new tax_rules row, a new category) changes
  // both sides alike, while a migration that drops or duplicates a user row
  // still fails here.
  it('every user row is preserved: each table that existed at the released schema holds exactly its user rows after the chain', () => {
    const userRows = (counts: Record<string, number>, seeded: Record<string, number>) =>
      Object.keys(before).map((t) => [t, counts[t] - (seeded[t] ?? 0)]);
    expect(userRows(after, FRESH_ROWS)).toEqual(userRows(before, seededAtN));
    // The comparison is not vacuous: every table the migrations leave empty holds user rows here.
    expect(userRows(before, seededAtN).filter(([t, c]) => !seededAtN[t] && c === 0)).toEqual([]);
  });

  // v1.8.0 H1 (post-release review L14): the count above cannot see a value
  // that changed. Every row that existed before the chain reads the same after
  // it, matched by primary key, in every column, apart from the rewrites the
  // chain's own migrations declare in INTENDED_REWRITES.
  it('every pre-chain row is unchanged after the chain, by primary key, in every column (apart from the declared rewrites of the migrations the chain runs)', () => {
    // Not vacuous: every table compared holds a row, and the rows read after the chain are the upgraded file's (a fresh build's columns).
    expect([...rowsBefore].filter(([, r]) => r.rows.length === 0).map(([t]) => t)).toEqual([]);
    expect(Object.fromEntries([...rowsAfter].map(([t, r]) => [t, r.columns]))).toEqual(FRESH_COLUMNS);
    const changes = contentChanges(rowsBefore, rowsAfter, rewritesFrom(n, all));
    if (changes.length > 0) throw new Error(contentMessage(n, changes));
    expect(changes).toEqual([]);
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

describe('the content check is real (v1.8.0 H1, post-release review L14)', () => {
  /** A file at the newest schema with the harness's rows; its rows are read, `planted` runs, and the changes are compared. */
  async function plantedChanges(planted: Migration[], allowed: readonly IntendedRewrite[] = []): Promise<string[]> {
    const db = new SqliteAdapter(':memory:');
    try {
      await runMigrations(db, all.slice(0, 29));
      await seedBefore0030(db);
      await runMigrations(db, all);
      await seedAtSchema(db, MAX_SCHEMA_VERSION);
      const was = await rowsOf(db);
      await runMigrations(db, planted);
      return contentChanges(was, await rowsOf(db), allowed);
    } finally {
      await db.close();
    }
  }

  const ZERO_A_GOAL: Migration = { version: 'h1_plant_zero', sql: 'UPDATE goals SET target_amount = 0;' };

  it('reports, by primary key, a value a migration zeroes, the rows a cascade nulls and deletes, and a column a migration drops (planted)', async () => {
    const changes = await plantedChanges([
      ZERO_A_GOAL,
      // What a wrapped `DROP TABLE persons` does first (L13): its implicit DELETE, with foreign keys on.
      { version: 'h1_plant_cascade', sql: 'DELETE FROM persons WHERE id = 1;' },
      { version: 'h1_plant_drop_column', sql: 'ALTER TABLE housing_payments DROP COLUMN name;' },
    ]);
    expect(changes).toEqual(
      expect.arrayContaining([
        'goals [1] target_amount: 5000 → 0',
        'persons [1]: the row is gone',
        'equity_grants [1]: the row is gone', // ON DELETE CASCADE
        'accounts [1] owner_person_id: 1 → null', // ON DELETE SET NULL
        'transactions [1] person_id: 1 → null',
        'housing_payments.name: the column is gone',
      ]),
    );
  });

  it('an intended rewrite is accepted only for its own table, rows and columns (a volatile stamp included), and only on a chain that runs its migration (planted)', async () => {
    const everyRow = () => true;
    expect(await plantedChanges([ZERO_A_GOAL], [{ table: 'goals', rows: everyRow, columns: ['target_amount'] }])).toEqual([]);
    expect(await plantedChanges([ZERO_A_GOAL], [{ table: 'goals', rows: (r) => r.id === 1, columns: ['target_amount'] }])).toEqual([]);
    expect(await plantedChanges([ZERO_A_GOAL], [{ table: 'goals', rows: (r) => r.id !== 1, columns: ['target_amount'] }])).toEqual(['goals [1] target_amount: 5000 → 0']);
    expect(await plantedChanges([ZERO_A_GOAL], [{ table: 'goals', rows: everyRow, columns: [], volatile: ['target_amount'] }])).toEqual([]);
    expect(await plantedChanges([ZERO_A_GOAL], [{ table: 'learning_state', rows: everyRow, columns: ['target_amount'] }])).toEqual(['goals [1] target_amount: 5000 → 0']);
    expect(await plantedChanges([ZERO_A_GOAL], [{ table: 'goals', rows: everyRow, columns: ['name'] }])).toEqual(['goals [1] target_amount: 5000 → 0']);
    const DROP_A_COLUMN: Migration = { version: 'h1_plant_drop_name', sql: 'ALTER TABLE housing_payments DROP COLUMN name;' };
    expect(await plantedChanges([DROP_A_COLUMN], [{ table: 'housing_payments', rows: everyRow, columns: ['name'] }])).toEqual([]);
    expect(await plantedChanges([DROP_A_COLUMN], [{ table: 'housing_payments', rows: (r) => r.id !== 1, columns: ['name'] }])).toEqual(['housing_payments.name: the column is gone']);
    const planted = { h1_plant_zero: [{ table: 'goals', rows: everyRow, columns: ['target_amount'] }] };
    const chain = [...all, ZERO_A_GOAL];
    expect(rewritesFrom(all.length, chain, planted)).toEqual(planted.h1_plant_zero); // the chain runs it
    expect(rewritesFrom(all.length + 1, chain, planted)).toEqual([]); // the file already had it
  });

  it('INTENDED_REWRITES hygiene: each entry names a migration a released chain runs and columns its table has before it runs; replayed alone, that migration rewrites or drops every listed column (volatile ones aside)', async () => {
    for (const [version, rewrites] of Object.entries(INTENDED_REWRITES)) {
      const ordinal = all.findIndex((m) => m.version === version) + 1;
      expect(ordinal, `${version} is not a registry migration`).toBeGreaterThan(0);
      expect(ordinal, `no released chain runs ${version}`).toBeGreaterThan(DISTINCT_RELEASED_SCHEMAS[0]);
      // Replay to the schema just before it, with the harness's rows, and run it alone.
      const db = await replayTo(path.join(dir, `rewrite-${version}.db`), ordinal - 1);
      try {
        await seedAtSchema(db, ordinal - 1);
        const was = await rowsOf(db);
        for (const { table, columns, volatile = [] } of rewrites) {
          expect(was.get(table)?.columns, `${version}: ${table} before it runs`).toEqual(expect.arrayContaining([...columns, ...volatile]));
        }
        await runMigrations(db, all.slice(0, ordinal));
        const changed = contentChanges(was, await rowsOf(db));
        for (const { table, columns } of rewrites) {
          for (const c of columns) {
            const touches = (line: string) => (line.startsWith(`${table} `) && line.includes(` ${c}: `)) || line === `${table}.${c}: the column is gone`;
            expect(changed.some(touches), `${version} does not rewrite ${table}.${c} (a stamp that may stay the same goes under volatile): ${changed.join('; ') || 'no change'}`).toBe(true);
          }
        }
      } finally {
        await db.close();
      }
    }
  });
});

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
