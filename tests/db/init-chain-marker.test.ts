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
import { loadAllMigrations, pendingMigrations, readChainMarker, runMigrations, type Migration } from '@/db/migrations';
import { EXPLORE_FLAG_KEY } from '@/lib/explore-mode';

const COPY = '/x/backups/cairn-pre-update-53-to-55-20260925-101500.db';

/**
 * v1.7.1 U3 × U1 (CR-U3-2): the pre-update gate reads the chain marker. A file a
 * U3 runner left partway has user_version === applied (per-migration stamps),
 * so D-U1-17's resume-from-the-origin-copy rule reads the marker's origin; the
 * pre-U3 signal (0 < user_version < applied) still covers a file a v1.7.0-or-
 * earlier runner left partway.
 */
describe('maybeTakePreUpdateCopy × the chain marker', () => {
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

  async function partwayU3() {        // 53 → 55, 0054 committed, 0055 not yet
    await runMigrations(db, all.slice(0, 54));
    await db.execute('PRAGMA user_version = 54');   // per-migration stamping: user_version === applied
    await db.execute("INSERT INTO schema_migrations (version) VALUES ('chain:53->55')");
  }

  it('a U3-partway file (user_version 54 === applied 54, marker 53→55) resumes from the ORIGIN copy: originFrom 53, chainOrigin 53', async () => {
    await partwayU3();
    const gate = await maybeTakePreUpdateCopy(db, all);
    expect(takePreUpdateCopy).toHaveBeenCalledWith({ from: 54, to: 55, now: expect.any(Date), originFrom: 53 });
    expect(gate).toMatchObject({ updating: true, chainOrigin: 53, chainTarget: 55 });
  });

  it('a marker for ANOTHER target is ignored (a stale row from a different update): the chain starts at applied', async () => {
    await runMigrations(db, all.slice(0, 54));
    await db.execute("INSERT INTO schema_migrations (version) VALUES ('chain:47->53')");
    const gate = await maybeTakePreUpdateCopy(db, all);
    expect(takePreUpdateCopy).toHaveBeenCalledWith({ from: 54, to: 55, now: expect.any(Date) });
    expect(gate.chainOrigin).toBe(54);
  });

  it('a marker whose origin is not below applied is ignored (the origin copy itself was restored)', async () => {
    await runMigrations(db, all.slice(0, 53));
    await db.execute("INSERT INTO schema_migrations (version) VALUES ('chain:53->55')");
    await maybeTakePreUpdateCopy(db, all);
    expect(takePreUpdateCopy).toHaveBeenCalledWith({ from: 53, to: 55, now: expect.any(Date) });
  });

  // Plan review R-4: only an UPDATE CHAIN carries a marker (origin > 0), so the
  // gate never reads origin 0 as "the schema before the update".
  it('a marker with origin 0 is ignored (only an update chain carries one): the chain starts at applied', async () => {
    await runMigrations(db, all.slice(0, 54));
    await db.execute("INSERT INTO schema_migrations (version) VALUES ('chain:0->55')");
    const gate = await maybeTakePreUpdateCopy(db, all);
    expect(takePreUpdateCopy).toHaveBeenCalledWith({ from: 54, to: 55, now: expect.any(Date) });
    expect(gate.chainOrigin).toBe(54);
  });

  it('the pre-U3 signal still works for a file a v1.7.0 runner left partway (user_version 53 < applied 54, no marker)', async () => {
    await runMigrations(db, all.slice(0, 54));
    await db.execute('PRAGMA user_version = 53');
    await maybeTakePreUpdateCopy(db, all);
    expect(takePreUpdateCopy).toHaveBeenCalledWith({ from: 54, to: 55, now: expect.any(Date), originFrom: 53 });
  });

  // Code review CR-U3-7: the gate → runner → gate hand-off on a file a PRE-U3
  // runner left partway. Its only origin signal is 0 < user_version < applied,
  // and the first U3 commit stamps it away, so the runner's marker must carry
  // that origin, not its own applied count. The copy store below follows
  // takePreUpdateCopy's reuse order (the originFrom copy, then today's from→to
  // copy, else a new one), so copyIsFromBeforeUpdate is observed, not assumed.
  it('a v1.7.0-partway file that fails AGAIN after a U3 commit keeps its TRUE origin: both boots report chainOrigin 52, and neither calls a partway copy "from before the update"', async () => {
    await runMigrations(db, all.slice(0, 53));
    await db.execute('PRAGMA user_version = 52');   // a v1.7.0 chain from 52 committed 0053, then stopped
    await db.execute('ALTER TABLE tickers ADD COLUMN regular_market_change REAL'); // 0055's first statement will collide
    const copies: { from: number; to: number; name: string }[] = [];
    takePreUpdateCopy.mockImplementation(async ({ from, to, originFrom }: { from: number; to: number; originFrom?: number }) => {
      const hit = copies.find((c) => c.from === originFrom) ?? copies.find((c) => c.from === from && c.to === to);
      if (hit) return { path: `/x/backups/${hit.name}`, reused: true };
      const name = `cairn-pre-update-${from}-to-${to}-20260925-10150${copies.length}.db`;
      copies.push({ from, to, name });
      return { path: `/x/backups/${name}`, reused: false };
    });

    await expect(initDatabase()).rejects.toMatchObject({ name: 'MigrationFailedError', chainOrigin: 52, copyIsFromBeforeUpdate: false });
    expect(takePreUpdateCopy).toHaveBeenLastCalledWith({ from: 53, to: 55, now: expect.any(Date), originFrom: 52 });
    expect(await readChainMarker(db)).toEqual({ origin: 52, target: 55 }); // 0054 committed WITH the marker; user_version is now 54

    await expect(initDatabase()).rejects.toMatchObject({ name: 'MigrationFailedError', chainOrigin: 52, copyIsFromBeforeUpdate: false });
    expect(takePreUpdateCopy).toHaveBeenLastCalledWith({ from: 54, to: 55, now: expect.any(Date), originFrom: 52 });
    expect(copies.map((c) => c.from)).toEqual([53, 54]); // the 53→55 copy (already partway) is never reused as the origin
  });

  // Plan review R-2: driven through initDatabase(), so a boot that ran the
  // runner before the gate would be seen (the gate alone can never write a marker).
  it('ORDER (through initDatabase): the copy sees the file before THIS attempt touches it — applied 53, no marker', async () => {
    await runMigrations(db, all.slice(0, 53));
    let atCopy: unknown = 'not called';
    takePreUpdateCopy.mockImplementation(async () => {
      atCopy = { applied: (await pendingMigrations(db, all)).applied, marker: await readChainMarker(db) };
      return { path: COPY, reused: false };
    });
    await initDatabase();
    expect(atCopy).toEqual({ applied: 53, marker: null });
    expect(await readChainMarker(db)).toBeNull(); // the finished chain removed its marker
  });
});
