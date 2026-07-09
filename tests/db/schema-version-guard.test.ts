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
    expect(MAX_SCHEMA_VERSION).toBe(50);
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
