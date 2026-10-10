import { beforeEach, describe, expect, it, vi } from 'vitest';

// v1.8.0 H3 (L26): the boot screens' restore list over the REAL listBackups,
// with the plugin's real readDir rejections (plain strings; tauri-plugin-fs
// 2.5.1 src/commands.rs:487-492) — not a mocked listBackups rejection.
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/path', () => ({ appConfigDir: vi.fn(), join: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ mkdir: vi.fn(), readDir: vi.fn(), remove: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn(), openUrl: vi.fn() }));

import { appConfigDir, join } from '@tauri-apps/api/path';
import { readDir } from '@tauri-apps/plugin-fs';
import { renderBootError } from '@/db/boot-error-screen';
import { DatabaseInitError } from '@/db/boot-errors';
import { DatabaseCorruptError } from '@/db/integrity';
import { MAX_SCHEMA_VERSION, MigrationFailedError, SchemaTooNewError } from '@/db/migrations';
import { EXPLORE_FLAG_KEY } from '@/lib/explore-mode';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = '/Users/me/Library/Application Support/com.raymondgochuico.cairn';
const DIR = `${BASE}/backups`;
const readDirRejection = (ioError: string) => `failed to read directory at path: ${DIR} with error: ${ioError}`;
const UNREADABLE = readDirRejection('Permission denied (os error 13)');

describe('v1.8.0 H3 (L26) — an unreadable backups folder reaches the read-failure line (CR-U1-22)', () => {
  let root: HTMLElement;
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.removeItem(EXPLORE_FLAG_KEY);
    vi.mocked(appConfigDir).mockResolvedValue(BASE);
    vi.mocked(join).mockImplementation(async (...parts: string[]) => parts.join('/'));
    root = document.createElement('div');
  });

  for (const [label, err] of [
    ['generic database', new DatabaseInitError(new Error('finance.db is locked'))],
    ['corrupt', new DatabaseCorruptError('page 4 is never used')],
    ['too-new', new SchemaTooNewError(MAX_SCHEMA_VERSION + 5, MAX_SCHEMA_VERSION)],
    ['failed-update', new MigrationFailedError(new Error('duplicate column name'), null)],
  ] as const) {
    it(`${label} screen: the reason shows, never "No backups were found"`, async () => {
      vi.mocked(readDir).mockRejectedValue(UNREADABLE);
      renderBootError(root, err);
      await vi.waitFor(() => expect(root.textContent).toContain(`Could not read your backups: ${UNREADABLE}`));
      expect(root.textContent).not.toContain('No backups were found in the backups folder.');
      expect(readDir).toHaveBeenCalledWith(DIR);
    });
  }

  it('a backups folder that does not exist yet still reads as the calm empty line (CR-U1-21)', async () => {
    vi.mocked(readDir).mockRejectedValue(readDirRejection('No such file or directory (os error 2)'));
    renderBootError(root, new DatabaseInitError(new Error('finance.db is locked')));
    await vi.waitFor(() => expect(root.textContent).toContain('No backups were found in the backups folder.'));
    expect(root.textContent).not.toContain('Could not read your backups');
  });

  it('generic: with the read-failure line in place the screen is STILL free of "may be corrupt" / "update cairn" (CR-H3-2)', async () => {
    vi.mocked(readDir).mockRejectedValue(UNREADABLE);
    renderBootError(root, new DatabaseInitError(new Error('finance.db is locked')));
    await vi.waitFor(() => expect(root.textContent).toContain('Could not read your backups: '));
    expect(root.textContent).not.toMatch(/may be corrupt/i);
    expect(root.textContent).not.toMatch(/update cairn/i);
  });

  // D-H3-4: the matcher reads one plugin's text. A dependency bump re-checks
  // it on purpose instead of letting a first-run Settings visit start
  // showing a read-failure note.
  it('the rejection text and the missing-folder path are those of tauri-plugin-fs 2.5.1 on tauri 2.11.1 (a bump re-checks both)', () => {
    const lock = readFileSync(resolve(__dirname, '../../src-tauri/Cargo.lock'), 'utf8');
    const why =
      'listBackups (isMissingFolderRejection, src/lib/backup-restore.ts) reads the read_dir rejection of tauri-plugin-fs 2.5.1 ' +
      '(src/commands.rs:487-492) and relies on tauri 2.11.1 letting a missing in-scope folder reach read_dir (src/scope/fs.rs:346-373, 395-407). ' +
      'After a bump, re-check both, then move this pin.';
    expect(lock, why).toContain('name = "tauri-plugin-fs"\nversion = "2.5.1"\n');
    expect(lock, why).toContain('name = "tauri"\nversion = "2.11.1"\n');
  });
});
