import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock every Tauri surface the whole-db backup/restore path touches BEFORE
// importing the module under test. These packages have no runtime in vitest;
// the real flow is exercised by the user in `npm run tauri dev`.
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/path', () => ({ appConfigDir: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({
  mkdir: vi.fn(),
  readDir: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { appConfigDir } from '@tauri-apps/api/path';
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
const mockMkdir = mkdir as unknown as ReturnType<typeof vi.fn>;
const mockReadDir = readDir as unknown as ReturnType<typeof vi.fn>;
const mockRemove = remove as unknown as ReturnType<typeof vi.fn>;
const mockSave = save as unknown as ReturnType<typeof vi.fn>;
const mockReveal = revealItemInDir as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) so a `mockRejectedValue`/`mockResolvedValue`
  // implementation set by one test does not leak into the next — clearAllMocks
  // only wipes call history, leaving the implementation in place.
  vi.resetAllMocks();
  // Clear any cross-test restore-failure notice left in sessionStorage.
  window.sessionStorage?.clear();
  mockAppConfigDir.mockResolvedValue('/Users/me/Library/Application Support/com.x.cairn');
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
    expect(order).toEqual(['plugin:sql|close', 'db_restore', 'reload']);
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
    expect(order).toEqual(['plugin:sql|close', 'db_restore', 'reload']);
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
