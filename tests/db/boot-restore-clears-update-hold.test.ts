import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// v1.7.2 (L4, with L25/L35): CR-U-26 keeps a pending update hold across a
// boot that fails before the gate. A restore from that boot's screen that
// sets no hold must clear it, or the next boot shows the hold screen over
// data Cairn did not put back.
const load = vi.fn();
vi.mock('@/db/tauri-adapter', () => ({ TauriAdapter: { load: (...a: unknown[]) => load(...a) } }));
const takePreUpdateCopy = vi.fn();
vi.mock('@/lib/pre-update-copy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pre-update-copy')>()),
  takePreUpdateCopy: (...a: unknown[]) => takePreUpdateCopy(...a),
}));
vi.mock('@/lib/tauri-runtime', () => ({ isTauriRuntime: () => true }));
vi.mock('@/market/run-market-data-refresh', () => ({ runMarketDataRefresh: vi.fn() }));
vi.mock('@/lib/backup-restore', () => ({
  listBackups: vi.fn(),
  validateBackupFile: vi.fn(),
  restoreFromBackup: vi.fn(),
  revealBackupsDir: vi.fn(),
  backupsDirPath: vi.fn(),
}));

import { SqliteAdapter } from '@/db/sqlite-adapter';
import { initDatabase } from '@/db/init';
import { MAX_SCHEMA_VERSION, loadAllMigrations, readUserVersion, runMigrations, type Migration } from '@/db/migrations';
import { PRE_UPDATE_HOLD_KEY, setUpdateHold } from '@/lib/boot-notices';
import { EXPLORE_FLAG_KEY } from '@/lib/explore-mode';
import { renderBootError } from '@/db/boot-error-screen';
import { listBackups, restoreFromBackup, validateBackupFile } from '@/lib/backup-restore';

const COPY = '/x/backups/cairn-pre-update-53-to-55-20260925-101500.db';
const MANUAL = {
  name: 'cairn-20260901-090000.db',
  path: '/x/backups/cairn-20260901-090000.db',
  takenAt: new Date(2026, 8, 1, 9, 0, 0),
  kind: 'manual' as const,
};

describe('v1.7.2 (L4): a boot-screen restore that sets no hold clears a pending one', () => {
  let db: SqliteAdapter;
  let all: Migration[];
  let root: HTMLElement;

  beforeEach(async () => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.removeItem(EXPLORE_FLAG_KEY);
    db = new SqliteAdapter(':memory:');
    all = await loadAllMigrations();
    takePreUpdateCopy.mockResolvedValue({ path: COPY, reused: true });
    vi.mocked(listBackups).mockResolvedValue([MANUAL]);
    vi.mocked(validateBackupFile).mockResolvedValue({ ok: true, user_version: 53, max_supported_version: 55, reason: null });
    vi.mocked(restoreFromBackup).mockResolvedValue(undefined);
    root = document.createElement('div');
    document.body.append(root);
  });
  afterEach(async () => {
    root.remove();
    await db.close();
  });

  it('hold pending -> a boot fails before the gate -> a manual backup is restored on its screen -> the next boot migrates', async () => {
    setUpdateHold(); // the failed-update screen's restore of its named copy set it
    load.mockRejectedValueOnce(new Error('finance.db is locked'));
    const err = await initDatabase().then(() => null, (e: unknown) => e);
    expect((err as Error).name).toBe('DatabaseInitError');
    expect(sessionStorage.getItem(PRE_UPDATE_HOLD_KEY)).toBe('1'); // CR-U-26: kept across the pre-gate failure

    let t = 0;
    renderBootError(root, err, { reload: () => {}, now: () => t });
    await vi.waitFor(() => expect(root.querySelectorAll('[data-testid="boot-restore-row"]').length).toBe(1));
    const btn = () => root.querySelector('[data-testid="boot-restore-row"] button') as HTMLButtonElement;
    btn().click();
    await vi.waitFor(() => expect(btn().textContent).toBe('Confirm restore — replaces your current data'));
    t = 2000;
    btn().click();
    await vi.waitFor(() => expect(restoreFromBackup).toHaveBeenCalledTimes(1));
    const opts = vi.mocked(restoreFromBackup).mock.calls[0][1] as { onRestored?: () => void };
    opts.onRestored?.(); // restoreFromBackup runs it once the swap succeeded
    expect(sessionStorage.getItem(PRE_UPDATE_HOLD_KEY)).toBeNull();

    // After the reload the file IS the manual backup (schema 53).
    await runMigrations(db, all.slice(0, 53));
    load.mockImplementation(async () => db);
    await initDatabase();
    expect(takePreUpdateCopy).toHaveBeenCalledWith({ from: 53, to: all.length, now: expect.any(Date) });
    expect(await readUserVersion(db)).toBe(MAX_SCHEMA_VERSION);
  });
});
