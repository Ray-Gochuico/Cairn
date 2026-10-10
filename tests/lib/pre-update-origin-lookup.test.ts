import { beforeEach, describe, expect, it, vi } from 'vitest';

// v1.8.0 H3 (L6/L29): findOriginCopy — the origin copy of a partway chain,
// found READ-ONLY for "Continue without a copy" (CR-H3-4). Mocks as in
// tests/lib/pre-update-copy.test.ts.
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/path', () => ({ appConfigDir: vi.fn(), join: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ mkdir: vi.fn(), readDir: vi.fn(), remove: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { appConfigDir, join } from '@tauri-apps/api/path';
import { mkdir, readDir, remove } from '@tauri-apps/plugin-fs';
import { MAX_SCHEMA_VERSION } from '@/db/migrations';
import { findOriginCopy, takePreUpdateCopy } from '@/lib/pre-update-copy';

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;
const mockReadDir = readDir as unknown as ReturnType<typeof vi.fn>;

const BASE = '/Users/me/Library/Application Support/com.x.cairn';
const DIR = `${BASE}/backups`;
const NOW = new Date(2026, 8, 25, 10, 15, 0);
const file = (name: string) => ({ name, isFile: true, isDirectory: false, isSymlink: false });
const folder = (name: string) => ({ name, isFile: false, isDirectory: true, isSymlink: false });
const OK = { ok: true, user_version: 53, max_supported_version: MAX_SCHEMA_VERSION, reason: null };
const BAD = {
  ok: false, user_version: 0, max_supported_version: MAX_SCHEMA_VERSION,
  reason: 'The backup failed an integrity check (quick_check returned "*** in database main ***\nPage 3: never used"). It may be corrupt.',
};
/** Rejections that say nothing about the file (CR-U-11): the real Rust formats
 * (src-tauri/src/db_backup.rs validate_backup_file), as tests/lib/pre-update-copy.test.ts pins them. */
const UNOPENED = {
  ok: false, user_version: 0, max_supported_version: MAX_SCHEMA_VERSION,
  reason: 'This file could not be opened as a database: error returned from database: (code: 14) unable to open database file',
};
const UNCHECKED = {
  ok: false, user_version: 0, max_supported_version: MAX_SCHEMA_VERSION,
  reason: 'Integrity check could not run: error returned from database: (code: 5) database is locked',
};
const T = MAX_SCHEMA_VERSION;
const O = T - 2;                                                   // the chain's origin
const ORIGIN_OLD = `cairn-pre-update-${O}-to-${T}-20260801-090000.db`;
const ORIGIN_NEW = `cairn-pre-update-${O}-to-${T}-20260920-090000.db`;
const PARTWAY = `cairn-pre-update-${O + 1}-to-${T}-20260924-090000.db`;
const MANUAL = 'cairn-20260924-120000.db';

/** db_validate_backup answers per path from `verdicts` (default OK); anything else is unexpected. */
function wireInvoke(verdicts: Record<string, unknown> = {}, throwsFor: string[] = []) {
  mockInvoke.mockImplementation(async (cmd: string, args: { path?: string }) => {
    if (cmd === 'db_validate_backup') {
      if (throwsFor.includes(args.path ?? '')) throw 'IPC failure';
      return verdicts[args.path ?? ''] ?? OK;
    }
    if (cmd === 'db_backup') return undefined;
    throw new Error(`unexpected ${cmd}`);
  });
}
const validated = () => mockInvoke.mock.calls.filter((c) => c[0] === 'db_validate_backup').map((c) => (c[1] as { path: string }).path);
const writes = () => mockInvoke.mock.calls.filter((c) => c[0] !== 'db_validate_backup');

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(appConfigDir).mockResolvedValue(BASE);
  vi.mocked(join).mockImplementation(async (...parts: string[]) => parts.join('/'));
  mockReadDir.mockResolvedValue([file(ORIGIN_OLD), file(ORIGIN_NEW), file(PARTWAY), file(MANUAL)]);
  wireInvoke();
});

describe('findOriginCopy (v1.8.0 H3, L6)', () => {
  it('names the NEWEST valid copy whose `from` is the origin, any day or `to`', async () => {
    await expect(findOriginCopy(O)).resolves.toBe(`${DIR}/${ORIGIN_NEW}`);
  });

  it('read-only (CR-H3-4): no mkdir, no remove, no db_backup — it validates origin candidates only, newest first, and stops at the first valid one', async () => {
    wireInvoke({ [`${DIR}/${ORIGIN_NEW}`]: BAD });
    await expect(findOriginCopy(O)).resolves.toBe(`${DIR}/${ORIGIN_OLD}`);
    expect(validated()).toEqual([`${DIR}/${ORIGIN_NEW}`, `${DIR}/${ORIGIN_OLD}`]);
    expect(mkdir).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();                        // no sweep, even of a definitive rejection
    expect(writes()).toEqual([]);
  });

  it('null when no copy has that `from`, or none of them validates', async () => {
    await expect(findOriginCopy(O - 1)).resolves.toBeNull();
    wireInvoke({ [`${DIR}/${ORIGIN_NEW}`]: BAD, [`${DIR}/${ORIGIN_OLD}`]: BAD });
    await expect(findOriginCopy(O)).resolves.toBeNull();
  });

  it('null (never a throw) when the folder cannot be read or a check cannot run — and it never names an OLDER copy past one it could not check', async () => {
    mockReadDir.mockRejectedValueOnce('failed to read directory at path: x with error: Permission denied (os error 13)');
    await expect(findOriginCopy(O)).resolves.toBeNull();
    wireInvoke({}, [`${DIR}/${ORIGIN_NEW}`]);
    await expect(findOriginCopy(O)).resolves.toBeNull();
    vi.mocked(appConfigDir).mockRejectedValueOnce(new Error('no path API'));
    await expect(findOriginCopy(O)).resolves.toBeNull();
  });

  it('a newer origin copy the validator could not open or check ends the lookup with null: it never names an OLDER copy past it (L33, CR-U-11)', async () => {
    wireInvoke({ [`${DIR}/${ORIGIN_NEW}`]: UNOPENED });
    await expect(findOriginCopy(O)).resolves.toBeNull();
    expect(validated()).toEqual([`${DIR}/${ORIGIN_NEW}`]);   // ORIGIN_OLD is never offered in its place
    wireInvoke({ [`${DIR}/${ORIGIN_NEW}`]: UNCHECKED });
    await expect(findOriginCopy(O)).resolves.toBeNull();
    expect(remove).not.toHaveBeenCalled();
  });

  it('lockstep with the copy step: it names exactly the copy takePreUpdateCopy would reuse for the same chain (incl. a same-second tie, and a folder with a copy\'s name)', async () => {
    const TIE = `cairn-pre-update-${O}-to-${T + 1}-20260920-090000.db`; // same stamp as ORIGIN_NEW, a name that sorts after it
    const FOLDER = `cairn-pre-update-${O}-to-${T}-20260930-090000.db`;  // the newest family name, but a directory
    for (const listing of [
      [file(ORIGIN_OLD), file(ORIGIN_NEW), file(PARTWAY), file(MANUAL)],
      [file(ORIGIN_NEW), file(ORIGIN_OLD)],
      [file(ORIGIN_NEW), file(TIE), file(ORIGIN_OLD)],
      [file(ORIGIN_OLD), folder(FOLDER), file(ORIGIN_NEW)],
    ]) {
      mockReadDir.mockResolvedValue(listing);
      const reused = await takePreUpdateCopy({ from: O + 1, to: T, now: NOW, originFrom: O });
      expect(reused.reused).toBe(true);
      await expect(findOriginCopy(O)).resolves.toBe(reused.path);
    }
    expect(validated()).not.toContain(`${DIR}/${FOLDER}`);    // only files are family copies, as in takeInner
  });
});
