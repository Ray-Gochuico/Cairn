import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// v1.8.0 H3: the pre-update gate's edges (L5). Mocks as in
// tests/db/init-pre-update.test.ts. Every schema number derives from the
// registry (H1's L15 rule), so appending a migration moves nothing here.
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
import type { Database } from '@/db/db';
import { initDatabase } from '@/db/init';
import { loadAllMigrations, pendingMigrations, readUserVersion, runMigrations, type Migration } from '@/db/migrations';
import { PRE_UPDATE_HOLD_KEY, setUpdateHold } from '@/lib/boot-notices';
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
