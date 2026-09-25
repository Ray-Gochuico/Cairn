import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const load = vi.fn();
vi.mock('@/db/tauri-adapter', () => ({ TauriAdapter: { load: (...a: unknown[]) => load(...a) } }));
const takePreUpdateCopy = vi.fn();
vi.mock('@/lib/pre-update-copy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pre-update-copy')>()),
  takePreUpdateCopy: (...a: unknown[]) => takePreUpdateCopy(...a),
}));
const isTauri = vi.fn();
vi.mock('@/lib/tauri-runtime', () => ({ isTauriRuntime: () => isTauri() }));
vi.mock('@/market/run-market-data-refresh', () => ({ runMarketDataRefresh: vi.fn() }));

import { SqliteAdapter } from '@/db/sqlite-adapter';
import { initDatabase, maybeTakePreUpdateCopy } from '@/db/init';
import { MAX_SCHEMA_VERSION, loadAllMigrations, pendingMigrations, readUserVersion, runMigrations, type Migration } from '@/db/migrations';
import { PreUpdateCopyError } from '@/lib/pre-update-copy';
import { PRE_UPDATE_NOTICE_KEY, peekPostUpdateNotice, setSkipOnce, takeSkipOnce } from '@/lib/boot-notices';
import { EXPLORE_FLAG_KEY } from '@/lib/explore-mode';

const COPY = '/x/backups/cairn-pre-update-53-to-55-20260925-101500.db';

describe('initDatabase — the pre-update copy seam (CR-U-1/5)', () => {
  let db: SqliteAdapter;
  let all: Migration[];

  beforeEach(async () => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.removeItem(EXPLORE_FLAG_KEY);
    db = new SqliteAdapter(':memory:');
    all = await loadAllMigrations();
    load.mockImplementation(async () => db);
    isTauri.mockReturnValue(true);
    takePreUpdateCopy.mockResolvedValue({ path: COPY, reused: false });
  });
  afterEach(async () => { await db.close(); });

  async function atSchema53() {
    await runMigrations(db, all.slice(0, 53));
    await db.execute('PRAGMA user_version = 53'); // what the 53-build stamped (the runner stamps the constant)
  }

  it('schema 53 in Tauri: copies ONCE with {from 53, to 55}, BEFORE any migration runs; then migrates; stashes the note', async () => {
    await atSchema53();
    let appliedWhenCopied = -1;
    takePreUpdateCopy.mockImplementation(async () => {
      appliedWhenCopied = (await pendingMigrations(db, all)).applied; // observed at copy time
      return { path: COPY, reused: false };
    });

    await initDatabase();

    expect(takePreUpdateCopy).toHaveBeenCalledTimes(1);
    expect(takePreUpdateCopy).toHaveBeenCalledWith({ from: 53, to: all.length, now: expect.any(Date) });
    expect(appliedWhenCopied).toBe(53);                       // ORDER: the copy saw the pre-migration file
    expect(await readUserVersion(db)).toBe(MAX_SCHEMA_VERSION);
    expect((await pendingMigrations(db, all)).pending).toHaveLength(0);
    expect(peekPostUpdateNotice()).toBe(COPY);
  });

  it('a reused copy also stashes the note', async () => {
    await atSchema53();
    takePreUpdateCopy.mockResolvedValue({ path: COPY, reused: true });
    await initDatabase();
    expect(peekPostUpdateNotice()).toBe(COPY);
  });

  it('fresh DB (applied 0): no copy, migrations run, no note', async () => {
    await initDatabase();
    expect(takePreUpdateCopy).not.toHaveBeenCalled();
    expect(await readUserVersion(db)).toBe(MAX_SCHEMA_VERSION);
    expect(peekPostUpdateNotice()).toBeNull();
  });

  it('nothing pending (schema 55): no copy, no note', async () => {
    await runMigrations(db, all);
    await initDatabase();
    expect(takePreUpdateCopy).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(PRE_UPDATE_NOTICE_KEY)).toBeNull();
  });

  it('outside the Tauri runtime (browser shim): no copy even with 53 pending; migrations still run', async () => {
    await atSchema53();
    isTauri.mockReturnValue(false);
    await initDatabase();
    expect(takePreUpdateCopy).not.toHaveBeenCalled();
    expect(await readUserVersion(db)).toBe(MAX_SCHEMA_VERSION);
  });

  it('"Continue without a copy": skipOnce is consumed, no copy, migrations run, no note', async () => {
    await atSchema53();
    setSkipOnce();
    await initDatabase();
    expect(takePreUpdateCopy).not.toHaveBeenCalled();
    expect(takeSkipOnce()).toBe(false);                       // consumed
    expect(await readUserVersion(db)).toBe(MAX_SCHEMA_VERSION);
    expect(peekPostUpdateNotice()).toBeNull();
  });

  it('skipOnce is consumed by EVERY real-profile boot, even one that fails before the decision point, so a later file is never migrated without a copy (PR-13)', async () => {
    setSkipOnce();
    load.mockRejectedValueOnce(new Error('finance.db is locked'));
    await expect(initDatabase()).rejects.toThrow('finance.db is locked');
    expect(takeSkipOnce()).toBe(false);                       // consumed by the failed boot
    await atSchema53();                                        // e.g. an older file restored from that screen
    await initDatabase();
    expect(takePreUpdateCopy).toHaveBeenCalledTimes(1);       // the copy is taken again
  });

  it('FAIL-CLOSED (CR-U-1): the copy failing stops the boot BEFORE migrating — the file is untouched', async () => {
    await atSchema53();
    takePreUpdateCopy.mockRejectedValue(new PreUpdateCopyError('disk full'));

    await expect(initDatabase()).rejects.toMatchObject({ name: 'PreUpdateCopyError', reason: 'disk full' });

    expect((await pendingMigrations(db, all)).applied).toBe(53);
    expect(await readUserVersion(db)).toBe(53);               // runMigrations never ran (it would stamp 55)
    expect(peekPostUpdateNotice()).toBeNull();
  });

  it('a migration failing after the copy → MigrationFailedError with the copy path and the cause; no note', async () => {
    await atSchema53();
    await db.execute('ALTER TABLE app_settings ADD COLUMN vehicle_repair_category_ids TEXT'); // 0054 will collide

    await expect(initDatabase()).rejects.toMatchObject({
      name: 'MigrationFailedError',
      preUpdateCopyPath: COPY,
    });
    await expect(initDatabase()).rejects.toThrow(/duplicate column name/);
    expect(peekPostUpdateNotice()).toBeNull();
  });

  it('nothing pending: a runMigrations failure (the trailing stamp on a read-only file) is NOT an update failure; the raw error reaches the generic screen (PR-1)', async () => {
    await runMigrations(db, all);
    await db.execute('PRAGMA query_only = 1');                // the stamp at migrations.ts:171 now fails with SQLITE_READONLY
    const p = initDatabase();
    await expect(p).rejects.toThrow(/readonly/i);
    await expect(p).rejects.not.toMatchObject({ name: 'MigrationFailedError' });
    expect(takePreUpdateCopy).not.toHaveBeenCalled();
  });

  it('a FRESH file whose first run fails is not an update failure either (applied 0: nothing existed to update)', async () => {
    await db.execute('PRAGMA query_only = 1');                // CREATE TABLE schema_migrations now fails
    await expect(initDatabase()).rejects.not.toMatchObject({ name: 'MigrationFailedError' });
  });

  it('a too-new file with registry names missing: no copy; SchemaTooNewError, never the fail-closed screen (PR-12)', async () => {
    await atSchema53();
    await db.execute(`PRAGMA user_version = ${MAX_SCHEMA_VERSION + 7}`);
    await expect(initDatabase()).rejects.toMatchObject({ name: 'SchemaTooNewError' });
    expect(takePreUpdateCopy).not.toHaveBeenCalled();
  });

  it('partway chain (D-U1-17): 0054 commits, 0055 fails; the NEXT boot resumes from the origin copy (originFrom = user_version 53)', async () => {
    await atSchema53();
    await db.execute('ALTER TABLE tickers ADD COLUMN regular_market_change REAL'); // 0055's first statement will collide
    await expect(initDatabase()).rejects.toMatchObject({ name: 'MigrationFailedError' });
    expect(takePreUpdateCopy).toHaveBeenLastCalledWith({ from: 53, to: all.length, now: expect.any(Date), originFrom: undefined });
    expect((await pendingMigrations(db, all)).applied).toBe(54);   // 0054 committed on its own (migrations.ts:162)
    expect(await readUserVersion(db)).toBe(53);                     // the stamp (:171) never ran
    await expect(initDatabase()).rejects.toMatchObject({ name: 'MigrationFailedError', preUpdateCopyPath: COPY });
    expect(takePreUpdateCopy).toHaveBeenLastCalledWith({ from: 54, to: all.length, now: expect.any(Date), originFrom: 53 });
  });

  it('a too-new file: no copy (nothing is pending by name), SchemaTooNewError passes through UNWRAPPED', async () => {
    await runMigrations(db, all);
    await db.execute(`PRAGMA user_version = ${MAX_SCHEMA_VERSION + 7}`);
    await expect(initDatabase()).rejects.toMatchObject({ name: 'SchemaTooNewError' });
    expect(takePreUpdateCopy).not.toHaveBeenCalled();
  });

  it('maybeTakePreUpdateCopy alone: { copyPath, updating }, with the path in Tauri while updating, a null path in the browser, and updating false once migrated', async () => {
    await atSchema53();
    expect(await maybeTakePreUpdateCopy(db, all)).toEqual({ copyPath: COPY, updating: true });
    isTauri.mockReturnValue(false);
    expect(await maybeTakePreUpdateCopy(db, all)).toEqual({ copyPath: null, updating: true });
    await runMigrations(db, all);
    expect(await maybeTakePreUpdateCopy(db, all)).toEqual({ copyPath: null, updating: false });
  });
});
