import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import {
  runMigrations,
  loadAllMigrations,
  MAX_SCHEMA_VERSION,
  SchemaTooNewError,
  readUserVersion,
} from '@/db/migrations';

describe('MAX_SCHEMA_VERSION', () => {
  it('equals the number of registered migrations', async () => {
    const migrations = await loadAllMigrations();
    expect(MAX_SCHEMA_VERSION).toBe(migrations.length);
  });

  it('agrees with the Rust constant (manual parity check)', () => {
    // The Rust db_backup::MAX_SCHEMA_VERSION must equal this. Asserted here as
    // a literal so a migration addition that bumps one but not the other trips
    // a test. Keep src-tauri/src/db_backup.rs::MAX_SCHEMA_VERSION in sync.
    expect(MAX_SCHEMA_VERSION).toBe(55);
  });
});

describe('downgrade guard (H3)', () => {
  let db: SqliteAdapter;

  beforeEach(() => {
    db = new SqliteAdapter(':memory:');
  });

  afterEach(async () => {
    await db.close();
  });

  it('stamps user_version = MAX_SCHEMA_VERSION after a normal migration run', async () => {
    await runMigrations(db, await loadAllMigrations());
    const version = await readUserVersion(db);
    expect(version).toBe(MAX_SCHEMA_VERSION);
  });

  it('refuses to migrate a DB whose user_version exceeds MAX_SCHEMA_VERSION', async () => {
    // Simulate a database written by a NEWER build of Cairn.
    await db.execute(`PRAGMA user_version = ${MAX_SCHEMA_VERSION + 3}`);
    await expect(runMigrations(db, await loadAllMigrations())).rejects.toBeInstanceOf(
      SchemaTooNewError,
    );
  });

  it('the thrown SchemaTooNewError carries the found + max versions', async () => {
    await db.execute(`PRAGMA user_version = ${MAX_SCHEMA_VERSION + 1}`);
    try {
      await runMigrations(db, await loadAllMigrations());
      throw new Error('expected runMigrations to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(SchemaTooNewError);
      const err = e as SchemaTooNewError;
      expect(err.foundVersion).toBe(MAX_SCHEMA_VERSION + 1);
      expect(err.maxSupportedVersion).toBe(MAX_SCHEMA_VERSION);
      // A user-facing, non-stack message.
      expect(err.message).toMatch(/newer version of Cairn/i);
    }
  });

  it('does NOT refuse when user_version equals MAX_SCHEMA_VERSION (re-open of a current DB)', async () => {
    await runMigrations(db, await loadAllMigrations());
    // Second open: user_version is now stamped; a re-run must be a clean no-op.
    await expect(runMigrations(db, await loadAllMigrations())).resolves.not.toThrow();
    expect(await readUserVersion(db)).toBe(MAX_SCHEMA_VERSION);
  });

  it('still replays the full migration chain on a fresh DB (regression guard)', async () => {
    await runMigrations(db, await loadAllMigrations());
    const rows = await db.select<{ version: string }>(
      'SELECT version FROM schema_migrations',
    );
    expect(rows.length).toBe(MAX_SCHEMA_VERSION);
  });
});

describe('per-migration stamping (v1.7.1 U3): user_version commits WITH each migration', () => {
  let db: SqliteAdapter;
  let all: Awaited<ReturnType<typeof loadAllMigrations>>;
  const failAt = (i: number) =>
    all.map((m, k) => (k === i ? { ...m, sql: 'CREATE TABLE u3_probe (id INTEGER);\nINSERT INTO u3_missing VALUES (1);' } : m));

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    all = await loadAllMigrations();
  });
  afterEach(async () => {
    await db.close();
  });

  it('a prefix run stamps its last migration\'s ordinal, not the constant (all.slice(0, 53) → 53)', async () => {
    await runMigrations(db, all.slice(0, 53));
    expect(await readUserVersion(db)).toBe(53);
  });

  it('a chain that fails mid-way leaves user_version at the last migration that COMMITTED (53 → 0054 ok → 0055 fails → 54)', async () => {
    await runMigrations(db, all.slice(0, 53));
    await expect(runMigrations(db, failAt(54))).rejects.toThrow(/u3_missing/);
    expect(await readUserVersion(db)).toBe(54);
  });

  it('the stamp rolls back with its migration: a failing FIRST pending migration leaves user_version where it was', async () => {
    await runMigrations(db, all.slice(0, 53));
    await expect(runMigrations(db, failAt(53))).rejects.toThrow(/u3_missing/);
    expect(await readUserVersion(db)).toBe(53);
  });

  it('each migration\'s batch ends with its own stamp, inside the same executeBatch (after the audit row)', async () => {
    const batches: { sql: string[]; transaction: boolean | undefined }[] = [];
    const real = db.executeBatch.bind(db);
    db.executeBatch = async (statements, options) => {
      batches.push({ sql: statements.map((s) => s.sql), transaction: options?.transaction });
      return real(statements, options);
    };
    await runMigrations(db, all.slice(0, 53));
    await runMigrations(db, all);
    const AUDIT = 'INSERT OR IGNORE INTO schema_migrations (version) VALUES (?)';
    for (const b of batches.slice(-2)) expect(b.sql.indexOf(AUDIT)).toBeGreaterThan(-1);
    expect(batches.at(-2)!.sql.at(-1)).toBe('PRAGMA user_version = 54');
    expect(batches.at(-1)!.sql.at(-1)).toBe('PRAGMA user_version = 55');
    expect(batches.at(-1)!.transaction).toBe(true);
    const i0033 = batches.findIndex((b) => b.sql.includes('ALTER TABLE disclosure_acceptances__new RENAME TO disclosure_acceptances'));
    expect(batches[i0033].sql.at(-1)).toBe('PRAGMA user_version = 33');
    expect(batches[i0033].transaction).toBe(false);
  });

  it('a stamp never LOWERS user_version: re-running a recorded-gap migration on a newer file keeps its stamp', async () => {
    await runMigrations(db, all);
    await db.execute("DELETE FROM schema_migrations WHERE version IN ('0048_learning_preference_default', '0049_loan_payments_unique_amortization')");
    await expect(runMigrations(db, failAt(48))).rejects.toThrow(/u3_missing/); // 0048 re-runs (an idempotent UPDATE), then the probe in 0049's slot fails
    expect(await readUserVersion(db)).toBe(MAX_SCHEMA_VERSION);
  });

  // Code review CR-U3-8c: the per-migration `it` above fails before the trailing
  // stamp runs, so the trailing stamp's own never-lower rule gets its own pin.
  it('the trailing stamp never LOWERS user_version either: a prefix run on a newer file keeps its stamp', async () => {
    await runMigrations(db, all);
    await runMigrations(db, all.slice(0, 53));                   // nothing pending; the last ordinal passed is 53
    expect(await readUserVersion(db)).toBe(MAX_SCHEMA_VERSION);
  });

  it('the trailing stamp still writes when nothing is pending (the header write PR-1 relies on)', async () => {
    await runMigrations(db, all);
    await db.execute('PRAGMA user_version = 0');                 // a pre-guard dev file
    await runMigrations(db, all);
    expect(await readUserVersion(db)).toBe(MAX_SCHEMA_VERSION);
  });

  it('the stamp is the REGISTRY ordinal, not the position in the list passed ([0001, 0017, a failing 0018] leaves 17)', async () => {
    await expect(runMigrations(db, [all[0], all[16], { ...all[17], sql: 'INSERT INTO u3_missing VALUES (1);' }])).rejects.toThrow(/u3_missing/);
    expect(await readUserVersion(db)).toBe(17);
  });

  it('a list with no registry migration stamps nothing (synthetic test migrations)', async () => {
    await runMigrations(db, [{ version: 'u3_synthetic', sql: 'CREATE TABLE u3_synthetic (id INTEGER);' }]);
    expect(await readUserVersion(db)).toBe(0);
  });
});
