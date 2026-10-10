import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock every Tauri surface the whole-db backup/restore path touches BEFORE
// importing the module under test. These packages have no runtime in vitest;
// the real flow is exercised by the user in `npm run tauri dev`.
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/path', () => ({ appConfigDir: vi.fn(), join: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({
  mkdir: vi.fn(),
  readDir: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { appConfigDir, join } from '@tauri-apps/api/path';
import { mkdir, readDir, remove } from '@tauri-apps/plugin-fs';
import { save } from '@tauri-apps/plugin-dialog';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import {
  runBackup,
  backupFilename,
  rotateBackups,
  listBackups,
  validateBackupFile,
  restoreFromBackup,
  takeRestoreFailureNotice,
  MAX_BACKUPS,
} from '@/lib/backup-restore';

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;
const mockAppConfigDir = appConfigDir as unknown as ReturnType<typeof vi.fn>;
const mockJoin = join as unknown as ReturnType<typeof vi.fn>;
const mockMkdir = mkdir as unknown as ReturnType<typeof vi.fn>;
const mockReadDir = readDir as unknown as ReturnType<typeof vi.fn>;
const mockRemove = remove as unknown as ReturnType<typeof vi.fn>;
const mockSave = save as unknown as ReturnType<typeof vi.fn>;
const mockReveal = revealItemInDir as unknown as ReturnType<typeof vi.fn>;

/**
 * Separator-aware fake for `@tauri-apps/api/path`'s async `join()`: trims
 * stray separators at segment boundaries (the real implementation normalizes
 * them) and joins with `sep`. NOTE: a mocked join only proves the module
 * CALLS the platform-aware API with the right segments — it does not prove
 * real OS separator behavior. That proof is the A4 Windows-hardware run.
 */
function fakeJoin(sep: '/' | '\\') {
  return async (...parts: string[]): Promise<string> =>
    parts
      .map((s, i) => (i === 0 ? s.replace(/[\\/]+$/, '') : s.replace(/^[\\/]+|[\\/]+$/g, '')))
      .filter((s) => s.length > 0)
      .join(sep);
}

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) so a `mockRejectedValue`/`mockResolvedValue`
  // implementation set by one test does not leak into the next — clearAllMocks
  // only wipes call history, leaving the implementation in place.
  vi.resetAllMocks();
  // Clear any cross-test restore-failure notice left in sessionStorage.
  window.sessionStorage?.clear();
  mockAppConfigDir.mockResolvedValue('/Users/me/Library/Application Support/com.x.cairn');
  // POSIX-joining fake by default (matches the macOS appConfigDir above); the
  // Windows-separator suite below overrides both mocks together.
  mockJoin.mockImplementation(fakeJoin('/'));
  // db_backup/db_restore/db_validate_backup all resolve by default; individual
  // tests override as needed.
  mockInvoke.mockResolvedValue(undefined);
});

describe('backupFilename', () => {
  it('produces a cairn-YYYYMMDD-HHMMSS.db name from a Date', () => {
    const d = new Date('2026-06-02T09:07:05');
    expect(backupFilename(d)).toBe('cairn-20260602-090705.db');
  });

  it('zero-pads every field', () => {
    const d = new Date('2026-01-03T04:05:06');
    expect(backupFilename(d)).toBe('cairn-20260103-040506.db');
  });
});

describe('runBackup', () => {
  it('mkdir -p the backups dir, then invokes db_backup with an absolute dest', async () => {
    mockReadDir.mockResolvedValue([]);
    const dest = await runBackup(new Date('2026-06-02T10:00:00'));

    expect(mockMkdir).toHaveBeenCalledWith(
      expect.stringContaining('backups'),
      expect.objectContaining({ recursive: true }),
    );
    expect(mockInvoke).toHaveBeenCalledWith(
      'db_backup',
      expect.objectContaining({
        db: 'sqlite:finance.db',
        dest: expect.stringContaining('cairn-20260602-100000.db'),
      }),
    );
    // The dest is returned so the UI can show the path.
    expect(dest).toContain('cairn-20260602-100000.db');
    expect(dest).toContain('backups');
  });

  it('rotates to the newest MAX_BACKUPS after writing', async () => {
    // Pretend MAX_BACKUPS+2 cairn-*.db already exist; rotation should remove
    // the two oldest (lexicographic order == chronological for this naming).
    const names = Array.from({ length: MAX_BACKUPS + 2 }, (_, i) => {
      const n = String(i + 1).padStart(2, '0');
      return { name: `cairn-202601${n}-000000.db`, isFile: true, isDirectory: false };
    });
    mockReadDir.mockResolvedValue(names);

    await runBackup(new Date('2026-06-02T10:00:00'));

    // Two removes: the two lexicographically-smallest names.
    expect(mockRemove).toHaveBeenCalledTimes(2);
    const removed = mockRemove.mock.calls.map((c) => c[0] as string);
    expect(removed[0]).toContain('cairn-20260101-000000.db');
    expect(removed[1]).toContain('cairn-20260102-000000.db');
  });
});

describe('rotateBackups', () => {
  it('keeps only cairn-*.db files and ignores unrelated files', async () => {
    mockReadDir.mockResolvedValue([
      { name: 'cairn-20260101-000000.db', isFile: true, isDirectory: false },
      { name: 'notes.txt', isFile: true, isDirectory: false },
      { name: 'cairn-20260102-000000.db', isFile: true, isDirectory: false },
      { name: 'somedir', isFile: false, isDirectory: true },
    ]);
    await rotateBackups('/base/backups', 1);
    // Only one cairn file should remain (the newest); the older cairn file is
    // removed. notes.txt and somedir are never touched.
    expect(mockRemove).toHaveBeenCalledTimes(1);
    expect(mockRemove.mock.calls[0][0]).toContain('cairn-20260101-000000.db');
  });

  it('removes nothing when at or under the keep count', async () => {
    mockReadDir.mockResolvedValue([
      { name: 'cairn-20260101-000000.db', isFile: true, isDirectory: false },
    ]);
    await rotateBackups('/base/backups', 10);
    expect(mockRemove).not.toHaveBeenCalled();
  });
});

describe('listBackups', () => {
  it('parses cairn-*.db filenames into local-time Dates, newest-first', async () => {
    mockReadDir.mockResolvedValue([
      { name: 'cairn-20260102-030405.db', isFile: true, isDirectory: false },
      { name: 'cairn-20260601-235900.db', isFile: true, isDirectory: false },
      { name: 'cairn-20260102-030406.db', isFile: true, isDirectory: false },
    ]);

    const entries = await listBackups();

    // Newest-first: 2026-06-01 23:59:00, then the two 2026-01-02 entries (the
    // :06 second is one tick newer than :05).
    expect(entries.map((e) => e.name)).toEqual([
      'cairn-20260601-235900.db',
      'cairn-20260102-030406.db',
      'cairn-20260102-030405.db',
    ]);

    // The timestamp is parsed FROM the filename into LOCAL time, matching how
    // backupFilename builds the name (new Date(y, mo-1, d, h, mi, s)).
    const first = entries[0];
    expect(first.takenAt.getFullYear()).toBe(2026);
    expect(first.takenAt.getMonth()).toBe(5); // June (0-based)
    expect(first.takenAt.getDate()).toBe(1);
    expect(first.takenAt.getHours()).toBe(23);
    expect(first.takenAt.getMinutes()).toBe(59);
    expect(first.takenAt.getSeconds()).toBe(0);
    // Round-trips: backupFilename(takenAt) reproduces the original filename.
    expect(backupFilename(first.takenAt)).toBe('cairn-20260601-235900.db');
  });

  it('builds an absolute path under the backups dir', async () => {
    mockReadDir.mockResolvedValue([
      { name: 'cairn-20260102-030405.db', isFile: true, isDirectory: false },
    ]);
    const [entry] = await listBackups();
    expect(entry.path).toBe(
      '/Users/me/Library/Application Support/com.x.cairn/backups/cairn-20260102-030405.db',
    );
    // readDir is called against the backups dir.
    expect(mockReadDir).toHaveBeenCalledWith(expect.stringContaining('backups'));
  });

  it('ignores non-cairn files and directories', async () => {
    mockReadDir.mockResolvedValue([
      { name: 'cairn-20260102-030405.db', isFile: true, isDirectory: false },
      { name: 'notes.txt', isFile: true, isDirectory: false },
      { name: 'cairn-bogus.db', isFile: true, isDirectory: false },
      { name: 'cairn-20260102-030405.db.bak', isFile: true, isDirectory: false },
      // A directory whose NAME matches the cairn pattern must still be skipped.
      { name: 'cairn-20260103-000000.db', isFile: false, isDirectory: true },
    ]);
    const entries = await listBackups();
    expect(entries.map((e) => e.name)).toEqual(['cairn-20260102-030405.db']);
  });

  it('returns [] when the backups dir does not exist yet (readDir throws)', async () => {
    mockReadDir.mockRejectedValue(new Error('No such file or directory (os error 2)'));
    await expect(listBackups()).resolves.toEqual([]);
  });
});

describe('listBackups — only a missing folder means "no backups" (v1.8.0 H3, L26)', () => {
  // The rejections tauri-plugin-fs 2.5.1 sends for readDir are PLAIN STRINGS:
  // `failed to read directory at path: {path} with error: {std io error}`
  // (src/commands.rs:487-492), or `forbidden path: {path}` from its scope
  // check (src/commands.rs:1557-1576).
  const DIR = '/Users/me/Library/Application Support/com.x.cairn/backups';
  const readDirRejection = (ioError: string) => `failed to read directory at path: ${DIR} with error: ${ioError}`;

  it('a folder that does not exist yet is "no backups": the macOS/Linux text (os error 2) and the Windows one (os error 3)', async () => {
    mockReadDir.mockRejectedValueOnce(readDirRejection('No such file or directory (os error 2)'));
    await expect(listBackups()).resolves.toEqual([]);
    mockReadDir.mockRejectedValueOnce(readDirRejection('The system cannot find the path specified. (os error 3)'));
    await expect(listBackups()).resolves.toEqual([]);
  });

  for (const [label, reason] of [
    ['a permission refusal (os error 13)', readDirRejection('Permission denied (os error 13)')],
    ['a macOS privacy refusal (os error 1)', readDirRejection('Operation not permitted (os error 1)')],
    ["a file in the folder's place (os error 20)", readDirRejection('Not a directory (os error 20)')],
    ["the plugin's scope refusal", `forbidden path: ${DIR}`],
  ] as const) {
    it(`any other failure reaches the caller unchanged: ${label}`, async () => {
      mockReadDir.mockRejectedValueOnce(reason);
      await expect(listBackups()).rejects.toBe(reason);
    });
  }

  it('the os error code is read at the END of the text: a path that contains "(os error 2)" is not a missing folder', async () => {
    const odd = 'failed to read directory at path: /Users/me/(os error 2)/backups with error: Permission denied (os error 13)';
    mockReadDir.mockRejectedValueOnce(odd);
    await expect(listBackups()).rejects.toBe(odd);
  });

  it('an Error rejection is read by its message, like the first-run pin above', async () => {
    // A missing-folder code in an Error's message is "no backups", so the
    // message is what decides it, not the rejection's type.
    mockReadDir.mockRejectedValueOnce(new Error('The system cannot find the path specified. (os error 3)'));
    await expect(listBackups()).resolves.toEqual([]);
    mockReadDir.mockRejectedValueOnce(new Error('Permission denied (os error 13)'));
    await expect(listBackups()).rejects.toThrow('Permission denied (os error 13)');
  });
});

describe('Windows separators (mocked join — proves wiring, not OS behavior)', () => {
  // The Windows app-config dir Tauri resolves for our bundle identifier.
  // Trailing backslash on purpose: the join must not double the separator.
  const WIN_BASE = 'C:\\Users\\me\\AppData\\Roaming\\com.raymondgochuico.cairn\\';

  beforeEach(() => {
    mockAppConfigDir.mockResolvedValue(WIN_BASE);
    mockJoin.mockImplementation(fakeJoin('\\'));
  });

  it('listBackups builds backslash paths from a Windows app-config base', async () => {
    mockReadDir.mockResolvedValue([
      { name: 'cairn-20260102-030405.db', isFile: true, isDirectory: false },
    ]);
    const [entry] = await listBackups();
    expect(entry.path).toBe(
      'C:\\Users\\me\\AppData\\Roaming\\com.raymondgochuico.cairn\\backups\\cairn-20260102-030405.db',
    );
    expect(entry.path).not.toContain('/');
  });

  it('runBackup hands db_backup a backslash dest and returns it', async () => {
    mockReadDir.mockResolvedValue([]);
    const dest = await runBackup(new Date('2026-06-02T10:00:00'));
    expect(dest).toBe(
      'C:\\Users\\me\\AppData\\Roaming\\com.raymondgochuico.cairn\\backups\\cairn-20260602-100000.db',
    );
    expect(dest).not.toContain('/');
    expect(mockInvoke).toHaveBeenCalledWith(
      'db_backup',
      expect.objectContaining({ db: 'sqlite:finance.db', dest }),
    );
  });

  it('rotateBackups removes stale backups via backslash paths', async () => {
    mockReadDir.mockResolvedValue([
      { name: 'cairn-20260101-000000.db', isFile: true, isDirectory: false },
      { name: 'cairn-20260102-000000.db', isFile: true, isDirectory: false },
    ]);
    await rotateBackups('C:\\base\\backups', 1);
    expect(mockRemove).toHaveBeenCalledTimes(1);
    expect(mockRemove.mock.calls[0][0]).toBe('C:\\base\\backups\\cairn-20260101-000000.db');
  });
});

describe('validateBackupFile', () => {
  it('invokes db_validate_backup and returns its result', async () => {
    mockInvoke.mockResolvedValue({
      ok: true,
      user_version: 46,
      max_supported_version: 46,
      reason: null,
    });
    const v = await validateBackupFile('/some/backup.db');
    expect(mockInvoke).toHaveBeenCalledWith('db_validate_backup', { path: '/some/backup.db' });
    expect(v.ok).toBe(true);
  });
});

describe('restoreFromBackup', () => {
  it('closes the live pool, invokes db_restore, then reloads — in that order', async () => {
    const order: string[] = [];
    mockInvoke.mockImplementation(async (cmd: string) => {
      order.push(cmd);
      return undefined;
    });
    const reload = vi.fn(() => { order.push('reload'); });

    await restoreFromBackup('/some/backup.db', { reload });

    // The EXISTING live pool is closed via the plugin's close command (not a
    // fresh Database.load) BEFORE db_restore swaps the file, and the reload is
    // last. The close-before-swap ordering is the corruption-safety contract.
    expect(mockInvoke).toHaveBeenCalledWith('plugin:sql|close', { db: 'sqlite:finance.db' });
    expect(mockInvoke).toHaveBeenCalledWith(
      'db_restore',
      { db: 'sqlite:finance.db', source: '/some/backup.db' },
    );
    expect(order).toEqual(['db_restore_check', 'plugin:sql|close', 'db_restore', 'reload']);
  });

  it('STILL reloads when db_restore throws — the pool is already closed (M-4)', async () => {
    // close resolves, db_restore rejects. The session is on a closed pool, so
    // reload MUST happen anyway (H-1 leaves the original DB intact, so boot
    // re-inits cleanly). The thrown error is swallowed in favour of the reload.
    const order: string[] = [];
    mockInvoke.mockImplementation(async (cmd: string) => {
      order.push(cmd);
      if (cmd === 'db_restore') throw new Error('swap failed');
      return undefined;
    });
    const reload = vi.fn(() => { order.push('reload'); });

    await restoreFromBackup('/some/backup.db', { reload });

    expect(reload).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['db_restore_check', 'plugin:sql|close', 'db_restore', 'reload']);
  });

  it('stashes the failure reason for the post-reload app to surface (M-4)', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'db_restore') throw new Error('disk full during restore');
      return undefined;
    });
    await restoreFromBackup('/some/backup.db', { reload: vi.fn() });
    // takeRestoreFailureNotice read-once returns the reason, then clears it.
    expect(takeRestoreFailureNotice()).toBe('disk full during restore');
    expect(takeRestoreFailureNotice()).toBeNull();
  });

  it('does NOT reload when the CLOSE itself fails (pool may still be live)', async () => {
    // Failure BEFORE the point of no return: the pool might still be alive, so
    // we propagate and do NOT reload (the caller surfaces it on the live DB).
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'plugin:sql|close') throw new Error('close failed');
      return undefined;
    });
    const reload = vi.fn();
    await expect(restoreFromBackup('/some/backup.db', { reload })).rejects.toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
    // db_restore must never run if the close failed.
    expect(mockInvoke).not.toHaveBeenCalledWith(
      'db_restore',
      expect.anything(),
    );
  });
});

describe('save-a-copy + reveal helpers (smoke)', () => {
  it('saveBackupCopy invokes a fresh db_backup into the chosen save path', async () => {
    const { saveBackupCopy } = await import('@/lib/backup-restore');
    mockSave.mockResolvedValue('/Users/me/Desktop/my-cairn.db');
    const out = await saveBackupCopy();
    expect(mockSave).toHaveBeenCalled();
    expect(mockInvoke).toHaveBeenCalledWith(
      'db_backup',
      expect.objectContaining({ db: 'sqlite:finance.db', dest: '/Users/me/Desktop/my-cairn.db' }),
    );
    expect(out).toBe('/Users/me/Desktop/my-cairn.db');
  });

  it('saveBackupCopy returns null when the user cancels the save dialog', async () => {
    const { saveBackupCopy } = await import('@/lib/backup-restore');
    mockSave.mockResolvedValue(null);
    const out = await saveBackupCopy();
    expect(out).toBeNull();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('revealBackupsDir reveals the backups directory', async () => {
    const { revealBackupsDir } = await import('@/lib/backup-restore');
    await revealBackupsDir();
    expect(mockReveal).toHaveBeenCalledWith(expect.stringContaining('backups'));
  });
});

describe('listBackups — both families (v1.7.1 U1)', () => {
  it('lists manual AND pre-update copies with kind/schema fields, newest first across both', async () => {
    mockReadDir.mockResolvedValue([
      { name: 'cairn-20260924-090000.db', isFile: true, isDirectory: false },
      { name: 'cairn-pre-update-53-to-55-20260925-101500.db', isFile: true, isDirectory: false },
      { name: 'cairn-20260925-120000.db', isFile: true, isDirectory: false },
      { name: 'cairn-pre-update-53-to-55-20260925-101500.db.bak', isFile: true, isDirectory: false },
      { name: 'cairn-pre-update-52-to-53-20260801-000000.db', isFile: false, isDirectory: true },
    ]);
    const entries = await listBackups();
    expect(entries.map((e) => [e.name, e.kind])).toEqual([
      ['cairn-20260925-120000.db', 'manual'],
      ['cairn-pre-update-53-to-55-20260925-101500.db', 'pre-update'],
      ['cairn-20260924-090000.db', 'manual'],
    ]);
    const pre = entries[1];
    expect(pre.schemaFrom).toBe(53);
    expect(pre.schemaTo).toBe(55);
    expect(pre.takenAt.getTime()).toBe(new Date(2026, 8, 25, 10, 15, 0).getTime());
    expect(pre.path).toBe(
      '/Users/me/Library/Application Support/com.x.cairn/backups/cairn-pre-update-53-to-55-20260925-101500.db',
    );
    expect(entries[0].schemaFrom).toBeUndefined();
  });

  it('rotateBackups still ignores the family (receipt: the :90 regex is untouched)', async () => {
    mockReadDir.mockResolvedValue([
      { name: 'cairn-pre-update-53-to-55-20260925-101500.db', isFile: true, isDirectory: false },
      { name: 'cairn-20260101-000000.db', isFile: true, isDirectory: false },
      { name: 'cairn-20260102-000000.db', isFile: true, isDirectory: false },
    ]);
    await rotateBackups('/base/backups', 1);
    expect(mockRemove).toHaveBeenCalledTimes(1);
    expect(mockRemove.mock.calls[0][0]).toBe('/base/backups/cairn-20260101-000000.db');
  });
});

describe('restoreFromBackup — the refusals that need no closed pool come first (v1.8.0 H2, chip v)', () => {
  // db_restore_check runs db_restore's step-0 refusals (the live file itself,
  // Cairn's own staging file, a set-aside -wal) BEFORE the close, so a
  // refusal leaves the session on its open pool: no reload, and the caller
  // shows the reason against the still-live data.
  const REFUSAL =
    'db_restore: /x/finance.db-wal.restore-old from an earlier restore is next to your data. Move it out of that folder, then restore again (your data is unchanged)';

  it('the check is handed the same db and source as db_restore, first', async () => {
    await restoreFromBackup('/some/backup.db', { reload: vi.fn() });
    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'db_restore_check', { db: 'sqlite:finance.db', source: '/some/backup.db' });
  });

  it('a refusal from the check propagates before the close: no close, no db_restore, no reload, nothing stashed', async () => {
    for (const extra of [{}, { tolerateNotLoaded: true }]) {
      vi.resetAllMocks();
      window.sessionStorage?.clear();
      const order: string[] = [];
      mockInvoke.mockImplementation(async (cmd: string) => {
        order.push(cmd);
        if (cmd === 'db_restore_check') throw REFUSAL; // a Rust Err(String) arrives as a plain string
        return undefined;
      });
      const reload = vi.fn();
      const onRestored = vi.fn();
      await expect(restoreFromBackup('/some/backup.db', { reload, onRestored, ...extra })).rejects.toBe(REFUSAL);
      expect(order).toEqual(['db_restore_check']);
      expect(reload).not.toHaveBeenCalled();
      expect(onRestored).not.toHaveBeenCalled();
      expect(takeRestoreFailureNotice()).toBeNull();
    }
  });
});

describe('restoreFromBackup — tolerateNotLoaded (the boot path, v1.7.1 U2)', () => {
  const NOT_LOADED = 'database sqlite:finance.db not loaded'; // tauri-plugin-sql 2.4.0 error.rs:15, serialized as a plain string

  it('with the option: the exact not-loaded STRING rejection is treated as "nothing to drain" — db_restore runs, reload fires', async () => {
    const order: string[] = [];
    mockInvoke.mockImplementation(async (cmd: string) => {
      order.push(cmd);
      if (cmd === 'plugin:sql|close') throw NOT_LOADED;
      return undefined;
    });
    const reload = vi.fn(() => { order.push('reload'); });
    await restoreFromBackup('/some/backup.db', { reload, tolerateNotLoaded: true });
    expect(order).toEqual(['db_restore_check', 'plugin:sql|close', 'db_restore', 'reload']);
  });

  it('with the option: the same message as an Error is tolerated too', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'plugin:sql|close') throw new Error(NOT_LOADED);
      return undefined;
    });
    const reload = vi.fn();
    await restoreFromBackup('/some/backup.db', { reload, tolerateNotLoaded: true });
    expect(mockInvoke).toHaveBeenCalledWith('db_restore', { db: 'sqlite:finance.db', source: '/some/backup.db' });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('with the option: ANY OTHER close rejection still propagates before db_restore, no reload', async () => {
    for (const other of ['close failed', 'database sqlite:finance.db not loaded (pool busy)', 'sqlite:finance.db not loaded']) {
      vi.resetAllMocks();
      mockAppConfigDir.mockResolvedValue('/x');
      mockJoin.mockImplementation(fakeJoin('/'));
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'plugin:sql|close') throw other;
        return undefined;
      });
      const reload = vi.fn();
      await expect(restoreFromBackup('/some/backup.db', { reload, tolerateNotLoaded: true })).rejects.toBeTruthy();
      expect(reload).not.toHaveBeenCalled();
      expect(mockInvoke).not.toHaveBeenCalledWith('db_restore', expect.anything());
    }
  });

  it('WITHOUT the option (the Settings path): the exact not-loaded rejection still propagates — the default is byte-unchanged', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'plugin:sql|close') throw NOT_LOADED;
      return undefined;
    });
    const reload = vi.fn();
    await expect(restoreFromBackup('/some/backup.db', { reload })).rejects.toBe(NOT_LOADED);
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('restoreFromBackup — onRestored (CR-U-14: the boot screens set the one-boot update hold)', () => {
  it('runs once, after a SUCCESSFUL db_restore and before the reload', async () => {
    const order: string[] = [];
    mInvokeOrder(order);
    const onRestored = vi.fn(() => { order.push('onRestored'); });
    const reload = vi.fn(() => { order.push('reload'); });
    await restoreFromBackup('/some/backup.db', { reload, onRestored });
    expect(order).toEqual(['db_restore_check', 'plugin:sql|close', 'db_restore', 'onRestored', 'reload']);
    expect(onRestored).toHaveBeenCalledTimes(1);
  });

  it('never runs when db_restore rejects (the reload still happens, the reason is stashed)', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'db_restore') throw new Error('disk full during restore');
      return undefined;
    });
    const onRestored = vi.fn();
    const reload = vi.fn();
    await restoreFromBackup('/some/backup.db', { reload, onRestored });
    expect(onRestored).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(takeRestoreFailureNotice()).toBe('disk full during restore');
  });

  it('never runs when the close rejects (before the point of no return)', async () => {
    mockInvoke.mockImplementation(async (cmd: string) => {
      if (cmd === 'plugin:sql|close') throw new Error('close failed');
      return undefined;
    });
    const onRestored = vi.fn();
    await expect(restoreFromBackup('/some/backup.db', { reload: vi.fn(), onRestored })).rejects.toBeTruthy();
    expect(onRestored).not.toHaveBeenCalled();
  });

  it('a throwing onRestored never blocks the reload and is never reported as a failed restore', async () => {
    const reload = vi.fn();
    await restoreFromBackup('/some/backup.db', { reload, onRestored: () => { throw new Error('storage denied'); } });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(takeRestoreFailureNotice()).toBeNull();
  });
});

function mInvokeOrder(order: string[]) {
  mockInvoke.mockImplementation(async (cmd: string) => {
    order.push(cmd);
    return undefined;
  });
}

