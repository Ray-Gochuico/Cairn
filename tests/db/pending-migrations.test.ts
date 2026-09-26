import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import {
  MAX_SCHEMA_VERSION,
  MigrationFailedError,
  loadAllMigrations,
  pendingMigrations,
  readUserVersion,
  runMigrations,
  type Migration,
} from '@/db/migrations';

describe('pendingMigrations (the pre-update copy trigger, D-U1-1)', () => {
  let db: SqliteAdapter;
  let all: Migration[];

  beforeEach(async () => {
    db = new SqliteAdapter(':memory:');
    all = await loadAllMigrations();
  });
  afterEach(async () => { await db.close(); });

  it('fresh DB: schema_migrations is ABSENT → applied 0, every migration pending, and the table is NOT created', async () => {
    const r = await pendingMigrations(db, all);
    expect(r.applied).toBe(0);
    expect(r.pending.map((m) => m.version)).toEqual(all.map((m) => m.version));
    const t = await db.select<{ n: number }>(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
    );
    expect(t[0].n).toBe(0); // read-only: the runner creates it, this helper never does
  });

  it('a schema-53 file: applied 53, pending = the two v1.5.0 migrations, in registry order', async () => {
    await runMigrations(db, all.slice(0, 53));
    const r = await pendingMigrations(db, all);
    expect(r.applied).toBe(53);
    expect(r.pending.map((m) => m.version)).toEqual(['0054_vehicle_repair_categories', '0055_ticker_day_change']);
    expect(r.applied + r.pending.length).toBe(all.length);
  });

  it('is keyed on NAMES, not user_version: the runner stamps the constant even for a subset', async () => {
    await runMigrations(db, all.slice(0, 53));
    expect(await readUserVersion(db)).toBe(MAX_SCHEMA_VERSION); // 55 — user_version would say "nothing pending"
    expect((await pendingMigrations(db, all)).pending).toHaveLength(2);
  });

  it('fully migrated: applied 55, nothing pending', async () => {
    await runMigrations(db, all);
    const r = await pendingMigrations(db, all);
    expect(r).toEqual({ applied: all.length, pending: [] });
  });

  it('a foreign row in schema_migrations never inflates `applied` (registry intersection)', async () => {
    await runMigrations(db, all);
    await db.execute("INSERT INTO schema_migrations (version) VALUES ('9999_from_a_future_build')");
    expect((await pendingMigrations(db, all)).applied).toBe(all.length);
  });

  it('never writes: user_version stays 0 on a fresh DB after the call', async () => {
    await pendingMigrations(db, all);
    expect(await readUserVersion(db)).toBe(0);
  });
});

describe('MigrationFailedError', () => {
  it('is name-matched, carries the cause and the copy path, and reads calmly', () => {
    const cause = new Error('duplicate column name: vehicle_repair_category_ids');
    const e = new MigrationFailedError(cause, '/x/backups/cairn-pre-update-53-to-55-20260925-101500.db');
    expect(e.name).toBe('MigrationFailedError');
    expect(e).toBeInstanceOf(MigrationFailedError);
    expect(e).toBeInstanceOf(Error);
    expect(e.cause).toBe(cause);
    expect(e.preUpdateCopyPath).toBe('/x/backups/cairn-pre-update-53-to-55-20260925-101500.db');
    expect(e.message).toBe('Cairn could not finish updating your data: duplicate column name: vehicle_repair_category_ids');
  });

  it('tolerates a non-Error cause and a null path', () => {
    const e = new MigrationFailedError('bare string', null);
    expect(e.message).toBe('Cairn could not finish updating your data: bare string');
    expect(e.preUpdateCopyPath).toBeNull();
  });

  it('U1-m9: carries whether the named copy is from before the update (default true)', () => {
    expect(new MigrationFailedError('x', '/x/a.db').copyIsFromBeforeUpdate).toBe(true);
    expect(new MigrationFailedError('x', '/x/a.db', false).copyIsFromBeforeUpdate).toBe(false);
  });
});
