import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// v1.8.0 H3: the pre-update gate's edges (L5, L6/L29). Mocks as in
// tests/db/init-pre-update.test.ts. Every schema number derives from the
// registry (H1's L15 rule), so appending a migration moves nothing here.
const load = vi.fn();
vi.mock('@/db/tauri-adapter', () => ({ TauriAdapter: { load: (...a: unknown[]) => load(...a) } }));
const takePreUpdateCopy = vi.fn();
const findOriginCopy = vi.fn();
vi.mock('@/lib/pre-update-copy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pre-update-copy')>()),
  takePreUpdateCopy: (...a: unknown[]) => takePreUpdateCopy(...a),
  findOriginCopy: (...a: unknown[]) => findOriginCopy(...a),
}));
const isTauri = vi.fn();
vi.mock('@/lib/tauri-runtime', () => ({ isTauriRuntime: () => isTauri() }));
vi.mock('@/market/run-market-data-refresh', () => ({ runMarketDataRefresh: vi.fn() }));

import { SqliteAdapter } from '@/db/sqlite-adapter';
import type { Database } from '@/db/db';
import { initDatabase, maybeTakePreUpdateCopy } from '@/db/init';
import { loadAllMigrations, pendingMigrations, readChainMarker, readUserVersion, runMigrations, type Migration } from '@/db/migrations';
import { PRE_UPDATE_HOLD_KEY, peekPostUpdateNote, setSkipOnce, setUpdateHold, takeSkipOnce } from '@/lib/boot-notices';
import { EXPLORE_FLAG_KEY } from '@/lib/explore-mode';

/** A pre-update copy's path, named from the registry (H1's L15 rule). */
const copyOf = (from: number, to: number) => `/x/backups/cairn-pre-update-${from}-to-${to}-20260925-101500.db`;

/** `db`, except that its first `PRAGMA user_version` read rejects once.
 * `selects` records every select up to and including that failure, so the
 * test can pin that the failing read is the gate's own. */
function failingFirstSchemaRead(db: SqliteAdapter, selects: string[]): Database {
  let failed = false;
  return {
    execute: db.execute.bind(db),
    executeBatch: db.executeBatch.bind(db),
    close: db.close.bind(db),
    select: async <T,>(sql: string, params?: unknown[]): Promise<T[]> => {
      if (!failed) selects.push(sql);
      if (sql === 'PRAGMA user_version' && !failed) {
        failed = true;
        throw new Error('disk I/O error');
      }
      return db.select<T>(sql, params);
    },
  };
}

describe('v1.8.0 H3 (L5) — a failed schema read at the gate keeps the update hold', () => {
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
    takePreUpdateCopy.mockResolvedValue({ path: copyOf(all.length - 2, all.length), reused: true });
  });
  afterEach(async () => { await db.close(); });

  it('hold pending → the PRAGMA user_version read fails once → DatabaseInitError with the hold KEPT → the next boot shows the hold → the one after migrates', async () => {
    const T = all.length;
    await runMigrations(db, all.slice(0, T - 2));               // an update is pending (two migrations)
    setUpdateHold();                                             // the failed-update screen's restore set it
    const selects: string[] = [];
    load.mockImplementationOnce(async () => failingFirstSchemaRead(db, selects));
    await expect(initDatabase()).rejects.toMatchObject({ name: 'DatabaseInitError', message: 'disk I/O error' });
    // The read that failed is the gate's: the one right after pendingMigrations'
    // names query. If a boot ever reads user_version earlier, this line fails
    // first, so the hold pin below cannot pass for the wrong reason.
    expect(selects.slice(-2)).toEqual(['SELECT version FROM schema_migrations', 'PRAGMA user_version']);
    expect(sessionStorage.getItem(PRE_UPDATE_HOLD_KEY)).toBe('1');                  // CR-U-26 / L5: kept
    expect(takePreUpdateCopy).not.toHaveBeenCalled();
    expect(await readUserVersion(db)).toBe(T - 2);                                  // nothing migrated
    await expect(initDatabase()).rejects.toMatchObject({ name: 'UpdateHeldError' }); // CR-U1-4: the next screen lets you choose
    expect(await readUserVersion(db)).toBe(T - 2);
    await initDatabase();                                                           // the hold is one boot
    expect(await readUserVersion(db)).toBe(T);
    expect((await pendingMigrations(db, all)).pending).toHaveLength(0);
  });
});

/** `db`, except that every executeBatch rejects: the one pending migration of
 * a partway resume fails, whatever its SQL (schema-independent). */
function failingMigrations(db: SqliteAdapter): Database {
  return {
    execute: db.execute.bind(db),
    select: db.select.bind(db),
    close: db.close.bind(db),
    executeBatch: async () => { throw new Error('planted failure in the pending migration'); },
  };
}

describe('v1.8.0 H3 (L6/L29) — "Continue without a copy" on a partway resume names the origin copy that exists', () => {
  let db: SqliteAdapter;
  let all: Migration[];
  let T: number;
  let ORIGIN: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.removeItem(EXPLORE_FLAG_KEY);
    db = new SqliteAdapter(':memory:');
    all = await loadAllMigrations();
    T = all.length;
    ORIGIN = `/x/backups/cairn-pre-update-${T - 2}-to-${T}-20260920-090000.db`;
    load.mockImplementation(async () => db);
    isTauri.mockReturnValue(true);
    takePreUpdateCopy.mockResolvedValue({ path: copyOf(T - 1, T), reused: false });
    findOriginCopy.mockResolvedValue(ORIGIN);
  });
  afterEach(async () => { await db.close(); });

  /** A chain T-2 → T that committed T-1 and stopped (the U3 shape: user_version === applied, the marker keeps the origin). */
  async function partway() {
    await runMigrations(db, all.slice(0, T - 1));
    await db.execute(`INSERT INTO schema_migrations (version) VALUES ('chain:${T - 2}->${T}')`);
  }

  it('partway + skip: the failed update names the origin copy, from before the update; the lookup is read-only and the copy step never runs', async () => {
    await partway();
    setSkipOnce();
    load.mockImplementationOnce(async () => failingMigrations(db));
    await expect(initDatabase()).rejects.toMatchObject({
      name: 'MigrationFailedError',
      preUpdateCopyPath: ORIGIN,
      copyIsFromBeforeUpdate: true,
      chainOrigin: T - 2,
      chainTarget: T,
    });
    expect(findOriginCopy).toHaveBeenCalledTimes(1);
    expect(findOriginCopy).toHaveBeenCalledWith(T - 2);
    expect(takePreUpdateCopy).not.toHaveBeenCalled();
    expect(takeSkipOnce()).toBe(false);                                            // D-U1-13: still one boot
  });

  it('CR-H3-4: no valid origin copy found → exactly as before: no copy path, not from before the update (CR-U1-5)', async () => {
    await partway();
    setSkipOnce();
    findOriginCopy.mockResolvedValue(null);
    load.mockImplementationOnce(async () => failingMigrations(db));
    await expect(initDatabase()).rejects.toMatchObject({
      name: 'MigrationFailedError',
      preUpdateCopyPath: null,
      copyIsFromBeforeUpdate: false,
      chainOrigin: T - 2,
      chainTarget: T,
    });
    expect(takePreUpdateCopy).not.toHaveBeenCalled();
  });

  it('D-H3-1: a partway + skip boot that SUCCEEDS stashes the note for the origin copy, from before the update', async () => {
    await partway();
    setSkipOnce();
    await initDatabase();
    expect(await readUserVersion(db)).toBe(T);
    expect(await readChainMarker(db)).toBeNull();
    expect(peekPostUpdateNote()).toEqual({ copyPath: ORIGIN, fromBeforeUpdate: true });
  });

  it('a first attempt (not partway) + skip: no lookup, no copy (U1-m3 unchanged)', async () => {
    await runMigrations(db, all.slice(0, T - 2));
    setSkipOnce();
    await initDatabase();
    expect(findOriginCopy).not.toHaveBeenCalled();
    expect(takePreUpdateCopy).not.toHaveBeenCalled();
    expect(peekPostUpdateNote()).toBeNull();
  });

  it('partway WITHOUT skip: the copy step runs and the lookup does not (the normal path is untouched)', async () => {
    await partway();
    await maybeTakePreUpdateCopy(db, all);
    expect(takePreUpdateCopy).toHaveBeenCalledWith({ from: T - 1, to: T, now: expect.any(Date), originFrom: T - 2 });
    expect(findOriginCopy).not.toHaveBeenCalled();
  });

  it('outside the Tauri runtime (the browser shim): no lookup even when partway with skip', async () => {
    await partway();
    isTauri.mockReturnValue(false);
    expect(await maybeTakePreUpdateCopy(db, all, { skipCopy: true })).toEqual({
      copyPath: null, updating: true, copyIsFromBeforeUpdate: false, chainOrigin: T - 2, chainTarget: T,
    });
    expect(findOriginCopy).not.toHaveBeenCalled();
  });

  it('maybeTakePreUpdateCopy alone, partway + skip: { copyPath: the origin, copyIsFromBeforeUpdate: true }', async () => {
    await partway();
    expect(await maybeTakePreUpdateCopy(db, all, { skipCopy: true })).toEqual({
      copyPath: ORIGIN, updating: true, copyIsFromBeforeUpdate: true, chainOrigin: T - 2, chainTarget: T,
    });
  });
});
