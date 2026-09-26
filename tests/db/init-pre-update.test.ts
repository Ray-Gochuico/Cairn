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
import { PRE_UPDATE_NOTICE_KEY, peekPostUpdateNote, peekPostUpdateNotice, setSkipOnce, setUpdateHold, takeSkipOnce, takeUpdateHold } from '@/lib/boot-notices';
import { EXPLORE_FLAG_KEY } from '@/lib/explore-mode';
import { DatabaseInitError } from '@/db/boot-errors';

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
    const p = initDatabase();
    await expect(p).rejects.not.toMatchObject({ name: 'MigrationFailedError' });
    // U1-m31: and it IS the runner's CREATE TABLE refused by query_only, not an earlier step.
    await expect(p).rejects.toThrow(/readonly/i);
  });

  it('U1-m3: "Continue without a copy" and then a failed migration → MigrationFailedError with NO copy path (CR-U1-5); no copy, no note', async () => {
    await atSchema53();
    setSkipOnce();
    await db.execute('ALTER TABLE app_settings ADD COLUMN vehicle_repair_category_ids TEXT'); // 0054 will collide
    await expect(initDatabase()).rejects.toMatchObject({ name: 'MigrationFailedError', preUpdateCopyPath: null });
    expect(takePreUpdateCopy).not.toHaveBeenCalled();
    expect(peekPostUpdateNotice()).toBeNull();
  });

  it('U1-m4: the integrity check runs BEFORE the copy — a corrupt schema-53 file never reaches takePreUpdateCopy', async () => {
    await atSchema53();
    const real = db;
    load.mockImplementationOnce(async () => ({
      execute: real.execute.bind(real),
      executeBatch: real.executeBatch.bind(real),
      close: real.close.bind(real),
      select: async (sql: string, params?: unknown[]) =>
        sql === 'PRAGMA quick_check' ? [{ quick_check: '*** in database main ***\nPage 3: never used' }] : real.select(sql, params),
    }));
    await expect(initDatabase()).rejects.toMatchObject({ name: 'DatabaseCorruptError' });
    expect(takePreUpdateCopy).not.toHaveBeenCalled();
    expect(await readUserVersion(db)).toBe(53);
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

  it('U1F-m10: a partway retry that SUCCEEDS stashes the note as not-from-before-the-update', async () => {
    await atSchema53();
    await db.execute('ALTER TABLE tickers ADD COLUMN regular_market_change REAL'); // 0055 will collide
    await expect(initDatabase()).rejects.toMatchObject({ name: 'MigrationFailedError' });
    await db.execute('ALTER TABLE tickers DROP COLUMN regular_market_change');     // the cause is gone
    const partwayCopy = '/x/backups/cairn-pre-update-54-to-55-20260925-101500.db';
    takePreUpdateCopy.mockResolvedValue({ path: partwayCopy, reused: false });
    await initDatabase();
    expect(peekPostUpdateNote()).toEqual({ copyPath: partwayCopy, fromBeforeUpdate: false });
  });

  it('U1-m9: the copy is "from before the update" only when its `from` is the chain origin; a partway file with no origin copy gets an honest flag', async () => {
    await atSchema53();
    await db.execute('ALTER TABLE tickers ADD COLUMN regular_market_change REAL'); // 0055 will collide
    await expect(initDatabase()).rejects.toMatchObject({ name: 'MigrationFailedError', copyIsFromBeforeUpdate: true });
    // No origin copy this time (the first attempt continued without one): the
    // copy written now is of the half-migrated file, named from = applied (54).
    const partwayCopy = '/x/backups/cairn-pre-update-54-to-55-20260925-101500.db';
    takePreUpdateCopy.mockResolvedValue({ path: partwayCopy, reused: false });
    await expect(initDatabase()).rejects.toMatchObject({
      name: 'MigrationFailedError',
      preUpdateCopyPath: partwayCopy,
      copyIsFromBeforeUpdate: false,
    });
  });

  it('a too-new file: no copy (nothing is pending by name), SchemaTooNewError passes through UNWRAPPED', async () => {
    await runMigrations(db, all);
    await db.execute(`PRAGMA user_version = ${MAX_SCHEMA_VERSION + 7}`);
    await expect(initDatabase()).rejects.toMatchObject({ name: 'SchemaTooNewError' });
    expect(takePreUpdateCopy).not.toHaveBeenCalled();
  });

  it('maybeTakePreUpdateCopy alone: { copyPath, updating }, with the path in Tauri while updating, a null path in the browser, and updating false once migrated', async () => {
    await atSchema53();
    expect(await maybeTakePreUpdateCopy(db, all)).toEqual({ copyPath: COPY, updating: true, copyIsFromBeforeUpdate: true });
    isTauri.mockReturnValue(false);
    expect(await maybeTakePreUpdateCopy(db, all)).toEqual({ copyPath: null, updating: true, copyIsFromBeforeUpdate: false });
    await runMigrations(db, all);
    expect(await maybeTakePreUpdateCopy(db, all)).toEqual({ copyPath: null, updating: false, copyIsFromBeforeUpdate: false });
  });
});

describe('CR-U-12 — every raw failure of the real-profile database boot is tagged DatabaseInitError', () => {
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

  it('a load failure: DatabaseInitError, the message verbatim, the original as `cause`', async () => {
    const cause = new Error('finance.db is locked');
    load.mockRejectedValueOnce(cause);
    const p = initDatabase();
    await expect(p).rejects.toBeInstanceOf(DatabaseInitError);
    await expect(p).rejects.toMatchObject({ name: 'DatabaseInitError', message: 'finance.db is locked', cause });
  });

  it('a runMigrations failure with nothing pending (PR-1) is a DatabaseInitError, not an update failure', async () => {
    await runMigrations(db, all);
    await db.execute('PRAGMA query_only = 1');
    const p = initDatabase();
    await expect(p).rejects.toMatchObject({ name: 'DatabaseInitError' });
    await expect(p).rejects.toThrow(/readonly/i);
  });

  it('a non-Error rejection is tagged too (String(cause) as the message)', async () => {
    load.mockRejectedValueOnce('database sqlite:finance.db not loaded');
    await expect(initDatabase()).rejects.toMatchObject({
      name: 'DatabaseInitError',
      message: 'database sqlite:finance.db not loaded',
    });
  });

  it('the typed boot errors pass through UNTAGGED: DatabaseCorruptError (quick_check), SchemaTooNewError, PreUpdateCopyError, MigrationFailedError', async () => {
    const real = db;
    load.mockImplementationOnce(async () => ({
      ...real,
      execute: real.execute.bind(real),
      executeBatch: real.executeBatch.bind(real),
      close: real.close.bind(real),
      select: async (sql: string, params?: unknown[]) =>
        sql === 'PRAGMA quick_check' ? [{ quick_check: 'page 3 is never used' }] : real.select(sql, params),
    }));
    await expect(initDatabase()).rejects.toMatchObject({ name: 'DatabaseCorruptError' });

    await runMigrations(db, all);
    await db.execute(`PRAGMA user_version = ${MAX_SCHEMA_VERSION + 7}`);
    await expect(initDatabase()).rejects.toMatchObject({ name: 'SchemaTooNewError' });
  });
});

describe('CR-U-14 — the one-boot update hold after a boot-screen restore of a pre-update copy (U1-m8)', () => {
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
    takePreUpdateCopy.mockResolvedValue({ path: COPY, reused: true });
  });
  afterEach(async () => { await db.close(); });

  async function atSchema53() {
    await runMigrations(db, all.slice(0, 53));
    await db.execute('PRAGMA user_version = 53');
  }

  it('hold + pending: no copy, NOTHING migrated (user_version 53, applied 53), UpdateHeldError; the flag is consumed', async () => {
    await atSchema53();
    setUpdateHold();
    await expect(initDatabase()).rejects.toMatchObject({ name: 'UpdateHeldError' });
    expect(takePreUpdateCopy).not.toHaveBeenCalled();
    expect(await readUserVersion(db)).toBe(53);
    expect((await pendingMigrations(db, all)).applied).toBe(53);
    expect(takeUpdateHold()).toBe(false);                     // consumed by that boot
    expect(peekPostUpdateNotice()).toBeNull();
  });

  it('the hold lasts exactly ONE boot: the next boot migrates with the normal copy rules ("Try the update again")', async () => {
    await atSchema53();
    setUpdateHold();
    await expect(initDatabase()).rejects.toMatchObject({ name: 'UpdateHeldError' });
    await initDatabase();
    expect(takePreUpdateCopy).toHaveBeenCalledTimes(1);
    expect(takePreUpdateCopy).toHaveBeenCalledWith({ from: 53, to: all.length, now: expect.any(Date) });
    expect(await readUserVersion(db)).toBe(MAX_SCHEMA_VERSION);
    expect((await pendingMigrations(db, all)).pending).toHaveLength(0);
  });

  it('CR-U-21: the hold is ONE boot — a relaunch after the hold screen, with no button pressed, migrates', async () => {
    await atSchema53();
    setUpdateHold();
    await expect(initDatabase()).rejects.toMatchObject({ name: 'UpdateHeldError' });
    sessionStorage.clear();                                   // the app was quit and reopened: a new window
    await initDatabase();                                     // no 'Try the update again' press
    expect(await readUserVersion(db)).toBe(MAX_SCHEMA_VERSION);
    expect((await pendingMigrations(db, all)).pending).toHaveLength(0);
  });

  it('hold with nothing pending: the boot is ordinary and the flag is consumed', async () => {
    await runMigrations(db, all);
    setUpdateHold();
    await initDatabase();
    expect(takeUpdateHold()).toBe(false);
  });

  it('the hold is consumed by a boot that fails BEFORE the gate too (it never outlives one boot)', async () => {
    setUpdateHold();
    load.mockRejectedValueOnce(new Error('finance.db is locked'));
    await expect(initDatabase()).rejects.toThrow('finance.db is locked');
    expect(takeUpdateHold()).toBe(false);
  });

  it('maybeTakePreUpdateCopy alone: holdUpdate on an updating boot throws UpdateHeldError before any copy', async () => {
    await atSchema53();
    await expect(maybeTakePreUpdateCopy(db, all, { holdUpdate: true })).rejects.toMatchObject({ name: 'UpdateHeldError' });
    expect(takePreUpdateCopy).not.toHaveBeenCalled();
  });
});

