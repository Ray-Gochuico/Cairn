import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/path', () => ({ appConfigDir: vi.fn(), join: vi.fn() }));
vi.mock('@tauri-apps/plugin-fs', () => ({ mkdir: vi.fn(), readDir: vi.fn(), remove: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: vi.fn() }));

import { invoke } from '@tauri-apps/api/core';
import { appConfigDir, join } from '@tauri-apps/api/path';
import { mkdir, readDir, remove } from '@tauri-apps/plugin-fs';
import { MAX_SCHEMA_VERSION } from '@/db/migrations';
import { rotateBackups } from '@/lib/backup-restore';
import { PreUpdateCopyError, takePreUpdateCopy } from '@/lib/pre-update-copy';

const mockInvoke = invoke as unknown as ReturnType<typeof vi.fn>;
const mockAppConfigDir = appConfigDir as unknown as ReturnType<typeof vi.fn>;
const mockJoin = join as unknown as ReturnType<typeof vi.fn>;
const mockMkdir = mkdir as unknown as ReturnType<typeof vi.fn>;
const mockReadDir = readDir as unknown as ReturnType<typeof vi.fn>;
const mockRemove = remove as unknown as ReturnType<typeof vi.fn>;

const BASE = '/Users/me/Library/Application Support/com.x.cairn';
const DIR = `${BASE}/backups`;
const NOW = new Date(2026, 8, 25, 10, 15, 0); // local 2026-09-25 10:15:00
const file = (name: string) => ({ name, isFile: true, isDirectory: false, isSymlink: false });
const OK = { ok: true, user_version: 53, max_supported_version: MAX_SCHEMA_VERSION, reason: null };
// A REAL Rust validator reason (db_backup.rs, the quick_check arm): definitive (CR-U-11).
const BAD_REASON = 'The backup failed an integrity check (quick_check returned "*** in database main ***\nPage 3: never used"). It may be corrupt.';
const BAD = { ok: false, user_version: 0, max_supported_version: MAX_SCHEMA_VERSION, reason: BAD_REASON };
/** A validator rejection that says nothing about the file itself (CR-U-11). */
const UNREADABLE = (reason: string) => ({ ok: false, user_version: 0, max_supported_version: MAX_SCHEMA_VERSION, reason });
const MANUAL_POOL = Array.from({ length: 10 }, (_, i) => file(`cairn-202609${String(i + 10).padStart(2, '0')}-000000.db`));

/** invoke fake: db_backup resolves; db_validate_backup answers per path from `verdicts` (default OK). */
function wireInvoke(verdicts: Record<string, unknown> = {}, opts: { backupRejects?: string } = {}) {
  mockInvoke.mockImplementation(async (cmd: string, args: { path?: string; dest?: string }) => {
    if (cmd === 'db_backup') {
      if (opts.backupRejects) throw opts.backupRejects; // Rust rejects with a plain string
      return undefined;
    }
    if (cmd === 'db_validate_backup') return verdicts[args.path ?? ''] ?? OK;
    throw new Error(`unexpected ${cmd}`);
  });
}
const calls = (cmd: string) => mockInvoke.mock.calls.filter((c) => c[0] === cmd);
const removed = () => mockRemove.mock.calls.map((c) => c[0] as string);

beforeEach(() => {
  vi.resetAllMocks();
  mockAppConfigDir.mockResolvedValue(BASE);
  mockJoin.mockImplementation(async (...parts: string[]) => parts.join('/'));
  mockReadDir.mockResolvedValue([]);
  wireInvoke();
});

describe('takePreUpdateCopy — the write', () => {
  it('mkdir -p → readDir → db_backup(dest in the family) → db_validate_backup(dest); returns the path, not reused', async () => {
    const order: string[] = [];
    mockMkdir.mockImplementation(async () => void order.push('mkdir'));
    mockReadDir.mockImplementation(async () => { order.push('readDir'); return []; });
    mockInvoke.mockImplementation(async (cmd: string) => { order.push(cmd); return cmd === 'db_validate_backup' ? OK : undefined; });

    const r = await takePreUpdateCopy({ from: 53, to: 55, now: NOW });

    expect(r).toEqual({ path: `${DIR}/cairn-pre-update-53-to-55-20260925-101500.db`, reused: false });
    expect(order).toEqual(['mkdir', 'readDir', 'db_backup', 'db_validate_backup']);
    expect(mockMkdir).toHaveBeenCalledWith(DIR, expect.objectContaining({ recursive: true }));
    expect(mockInvoke).toHaveBeenCalledWith('db_backup', { db: 'sqlite:finance.db', dest: r.path });
    expect(mockInvoke).toHaveBeenCalledWith('db_validate_backup', { path: r.path });
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('a copy that does not validate is removed and the boot fails closed (PreUpdateCopyError with the reason)', async () => {
    const dest = `${DIR}/cairn-pre-update-53-to-55-20260925-101500.db`;
    wireInvoke({ [dest]: BAD });
    await expect(takePreUpdateCopy({ from: 53, to: 55, now: NOW })).rejects.toMatchObject({
      name: 'PreUpdateCopyError',
      reason: BAD_REASON,
    });
    expect(removed()).toEqual([dest]);
  });

  it('db_backup rejecting (disk full) → PreUpdateCopyError carrying the Rust text; validate never runs; the partial target is removed (PR-4)', async () => {
    wireInvoke({}, { backupRejects: 'db_backup: VACUUM INTO failed: database or disk is full' });
    const p = takePreUpdateCopy({ from: 53, to: 55, now: NOW });
    await expect(p).rejects.toBeInstanceOf(PreUpdateCopyError);
    await expect(p).rejects.toMatchObject({ reason: 'db_backup: VACUUM INTO failed: database or disk is full' });
    expect(calls('db_validate_backup')).toHaveLength(0);
    // SQLite never unlinks a failed VACUUM INTO target: on a full disk the partial
    // file would keep the last free bytes and defeat "Continue without a copy".
    expect(removed()).toEqual([`${DIR}/cairn-pre-update-53-to-55-20260925-101500.db`]);
  });

  it('never removes a pre-existing NON-file entry that carries the target name', async () => {
    mockReadDir.mockResolvedValue([
      { name: 'cairn-pre-update-53-to-55-20260925-101500.db', isFile: false, isDirectory: true, isSymlink: false },
    ]);
    wireInvoke({}, { backupRejects: 'db_backup: VACUUM INTO failed: output file already exists' });
    await expect(takePreUpdateCopy({ from: 53, to: 55, now: NOW })).rejects.toBeInstanceOf(PreUpdateCopyError);
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('mkdir failing (read-only folder) fails closed too, before any write', async () => {
    mockMkdir.mockRejectedValue(new Error('Permission denied (os error 13)'));
    await expect(takePreUpdateCopy({ from: 53, to: 55, now: NOW })).rejects.toMatchObject({
      name: 'PreUpdateCopyError',
      reason: 'Permission denied (os error 13)',
    });
    expect(calls('db_backup')).toHaveLength(0);
  });
});

describe('takePreUpdateCopy — sweep, reuse, rotation', () => {
  it('sweep: an invalid family file is removed, a valid one kept; manual files are never validated nor removed', async () => {
    mockReadDir.mockResolvedValue([
      file('cairn-pre-update-53-to-55-20260924-090000.db'),
      file('cairn-pre-update-52-to-53-20260801-090000.db'),
      ...MANUAL_POOL,
      { name: 'cairn-pre-update-53-to-55-20260924-080000.db', isFile: false, isDirectory: true, isSymlink: false },
    ]);
    wireInvoke({ [`${DIR}/cairn-pre-update-52-to-53-20260801-090000.db`]: BAD });

    await takePreUpdateCopy({ from: 53, to: 55, now: NOW });

    expect(removed()).toEqual([`${DIR}/cairn-pre-update-52-to-53-20260801-090000.db`]);
    const validated = calls('db_validate_backup').map((c) => (c[1] as { path: string }).path);
    expect(validated.some((p) => /\/cairn-\d{8}-\d{6}\.db$/.test(p))).toBe(false); // manual never validated
    expect(validated).not.toContain(`${DIR}/cairn-pre-update-53-to-55-20260924-080000.db`); // a directory is skipped
  });

  it('sweep: a family file too new for THIS build (from > MAX) is kept — never validated, removed or reused (D-U1-6)', async () => {
    const tooNew = `cairn-pre-update-${MAX_SCHEMA_VERSION + 3}-to-${MAX_SCHEMA_VERSION + 5}-20260925-090000.db`;
    mockReadDir.mockResolvedValue([file(tooNew)]);
    const r = await takePreUpdateCopy({ from: 53, to: 55, now: NOW });
    expect(r.reused).toBe(false);
    expect(mockRemove).not.toHaveBeenCalled();
    expect(calls('db_validate_backup').map((c) => (c[1] as { path: string }).path)).not.toContain(`${DIR}/${tooNew}`);
  });

  it('reuse: a valid same-from/to copy from TODAY is returned; nothing is written or removed', async () => {
    mockReadDir.mockResolvedValue([file('cairn-pre-update-53-to-55-20260925-090000.db'), ...MANUAL_POOL]);
    const r = await takePreUpdateCopy({ from: 53, to: 55, now: NOW });
    expect(r).toEqual({ path: `${DIR}/cairn-pre-update-53-to-55-20260925-090000.db`, reused: true });
    expect(calls('db_backup')).toHaveLength(0);
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('reuse: the NEWEST same-day match wins', async () => {
    mockReadDir.mockResolvedValue([
      file('cairn-pre-update-53-to-55-20260925-070000.db'),
      file('cairn-pre-update-53-to-55-20260925-090000.db'),
    ]);
    const r = await takePreUpdateCopy({ from: 53, to: 55, now: NOW });
    expect(r.path).toBe(`${DIR}/cairn-pre-update-53-to-55-20260925-090000.db`);
  });

  it('no reuse across a day boundary (yesterday) or across a different from/to — a new copy is written', async () => {
    mockReadDir.mockResolvedValue([
      file('cairn-pre-update-53-to-55-20260924-235959.db'),
      file('cairn-pre-update-52-to-55-20260925-090000.db'),
    ]);
    const r = await takePreUpdateCopy({ from: 53, to: 55, now: NOW });
    expect(r.reused).toBe(false);
    expect(calls('db_backup')).toHaveLength(1);
  });

  it('an INVALID same-day match is swept, not reused (a partial file from a crashed VACUUM INTO)', async () => {
    const stale = `${DIR}/cairn-pre-update-53-to-55-20260925-090000.db`;
    mockReadDir.mockResolvedValue([file('cairn-pre-update-53-to-55-20260925-090000.db')]);
    wireInvoke({ [stale]: BAD });
    const r = await takePreUpdateCopy({ from: 53, to: 55, now: NOW });
    expect(r.reused).toBe(false);
    expect(removed()).toEqual([stale]);
  });

  it('rotation: after the write the family keeps the newest 3 by PARSED timestamp (never lexical); manual files untouched', async () => {
    mockReadDir.mockResolvedValue([
      file('cairn-pre-update-9-to-10-20250101-000000.db'),   // oldest by time, lexically LAST
      file('cairn-pre-update-50-to-51-20260301-000000.db'),
      file('cairn-pre-update-51-to-52-20260601-000000.db'),
      ...MANUAL_POOL,
    ]);
    await takePreUpdateCopy({ from: 53, to: 55, now: NOW });   // 4th family file written
    expect(removed()).toEqual([`${DIR}/cairn-pre-update-9-to-10-20250101-000000.db`]);
  });

  it('no rotation on failure: db_backup rejecting with 3 family files present removes no family file (only its own partial target, PR-4)', async () => {
    mockReadDir.mockResolvedValue([
      file('cairn-pre-update-50-to-51-20260301-000000.db'),
      file('cairn-pre-update-51-to-52-20260601-000000.db'),
      file('cairn-pre-update-52-to-53-20260801-000000.db'),
    ]);
    wireInvoke({}, { backupRejects: 'db_backup: VACUUM INTO failed: disk full' });
    await expect(takePreUpdateCopy({ from: 53, to: 55, now: NOW })).rejects.toBeInstanceOf(PreUpdateCopyError);
    expect(removed()).toEqual([`${DIR}/cairn-pre-update-53-to-55-20260925-101500.db`]); // never a family file
  });

  it('reuse needs the same `to` too: a same-from, same-day copy toward a different target is not reused (PR-14)', async () => {
    mockReadDir.mockResolvedValue([file('cairn-pre-update-53-to-54-20260925-090000.db')]);
    const r = await takePreUpdateCopy({ from: 53, to: 55, now: NOW });
    expect(r.reused).toBe(false);
    expect(calls('db_backup')).toHaveLength(1);
  });

  it('rotation never removes a too-new family file (D-U1-6): it is outside the keep-3 pool (PR-14)', async () => {
    const tooNew = `cairn-pre-update-${MAX_SCHEMA_VERSION + 3}-to-${MAX_SCHEMA_VERSION + 5}-20250101-000000.db`; // the OLDEST by time
    mockReadDir.mockResolvedValue([
      file(tooNew),
      file('cairn-pre-update-50-to-51-20260301-000000.db'),
      file('cairn-pre-update-51-to-52-20260601-000000.db'),
      file('cairn-pre-update-52-to-53-20260801-000000.db'),
    ]);
    await takePreUpdateCopy({ from: 53, to: 55, now: NOW });
    expect(removed()).toEqual([`${DIR}/cairn-pre-update-50-to-51-20260301-000000.db`]);
  });

  it('rotation counts only files that survived the sweep: one swept + three valid → exactly one valid rotated out (PR-14)', async () => {
    mockReadDir.mockResolvedValue([
      file('cairn-pre-update-49-to-50-20260101-000000.db'),
      file('cairn-pre-update-50-to-51-20260301-000000.db'),
      file('cairn-pre-update-51-to-52-20260601-000000.db'),
      file('cairn-pre-update-52-to-53-20260801-000000.db'),
    ]);
    wireInvoke({ [`${DIR}/cairn-pre-update-52-to-53-20260801-000000.db`]: BAD });
    await takePreUpdateCopy({ from: 53, to: 55, now: NOW });
    expect(removed()).toEqual([
      `${DIR}/cairn-pre-update-52-to-53-20260801-000000.db`, // the sweep
      `${DIR}/cairn-pre-update-49-to-50-20260101-000000.db`, // rotation: 3 valid + the new one → drop the oldest valid
    ]);
  });

  it('partway chain (originFrom, D-U1-17): the newest valid copy with schemaFrom === originFrom is reused whatever its day or `to`; nothing is written or removed', async () => {
    mockReadDir.mockResolvedValue([
      file('cairn-pre-update-53-to-55-20260920-090000.db'), // the chain's origin, five days ago
      file('cairn-pre-update-54-to-55-20260924-090000.db'), // a partway copy an earlier build wrote
      ...MANUAL_POOL,
    ]);
    const r = await takePreUpdateCopy({ from: 54, to: 56, now: NOW, originFrom: 53 });
    expect(r).toEqual({ path: `${DIR}/cairn-pre-update-53-to-55-20260920-090000.db`, reused: true });
    expect(calls('db_backup')).toHaveLength(0);
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('partway with no origin copy: the normal rule applies, and the copy is named honestly from `applied`', async () => {
    const r = await takePreUpdateCopy({ from: 54, to: 55, now: NOW, originFrom: 53 });
    expect(r).toEqual({ path: `${DIR}/cairn-pre-update-54-to-55-20260925-101500.db`, reused: false });
  });

  it('a partway loop over four relaunch days keeps the origin copy: zero writes, zero removes', async () => {
    let listing = [file('cairn-pre-update-53-to-55-20260924-101500.db'), ...MANUAL_POOL];
    mockReadDir.mockImplementation(async () => listing);
    mockInvoke.mockImplementation(async (cmd: string, args: { dest?: string }) => {
      if (cmd === 'db_backup') { listing = [...listing, file(args.dest!.slice(DIR.length + 1))]; return undefined; }
      return OK;
    });
    for (const day of [25, 26, 27, 28]) {
      const r = await takePreUpdateCopy({ from: 54, to: 55, now: new Date(2026, 8, day, 9, 0, 0), originFrom: 53 });
      expect(r.path).toBe(`${DIR}/cairn-pre-update-53-to-55-20260924-101500.db`);
    }
    expect(calls('db_backup')).toHaveLength(0);
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('a rotation failure never masks a successful copy (best-effort, warned)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockReadDir.mockResolvedValue([
      file('cairn-pre-update-50-to-51-20260301-000000.db'),
      file('cairn-pre-update-51-to-52-20260601-000000.db'),
      file('cairn-pre-update-52-to-53-20260801-000000.db'),
    ]);
    mockRemove.mockRejectedValue(new Error('EPERM'));
    await expect(takePreUpdateCopy({ from: 53, to: 55, now: NOW })).resolves.toMatchObject({ reused: false });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('CR-U-11 — the sweep deletes a family file ONLY on a definitive rejection (U1-m2/m10)', () => {
  // The exact reasons validate_backup_file returns, probed with cargo on real
  // files: a garbled page, a zero-length file, a garbage file, and a VACUUM
  // INTO target truncated mid-write (the crashed-copy leftover the sweep is for).
  const DEFINITIVE = [
    BAD_REASON,
    'The backup failed an integrity check (quick_check returned "*** in database main ***\nTree 2 page 2: btreeInitPage() returns error code 11"). It may be corrupt.',
    'This does not look like a Cairn backup (no schema_migrations table).',
    'Integrity check could not run: error returned from database: (code: 26) file is not a database',
    'Integrity check could not run: error returned from database: (code: 11) database disk image is malformed',
  ];
  // (code: 14) is what cargo probed for a missing file and a mode-000 file.
  const TRANSIENT = [
    'This file could not be opened as a database: error returned from database: (code: 14) unable to open database file',
    'Integrity check could not run: error returned from database: (code: 5) database is locked',
    'This file could not be opened as a database: error communicating with database: Permission denied (os error 13)',
    "Could not read the backup's schema version: error returned from database: (code: 10) disk I/O error",
    'Could not open backup: invalid URL',
    'Backup path is not valid UTF-8.',
  ];

  for (const reason of DEFINITIVE) {
    it(`removes a family file rejected definitively: ${reason.slice(0, 60)}…`, async () => {
      const f = 'cairn-pre-update-52-to-53-20260801-090000.db';
      mockReadDir.mockResolvedValue([file(f)]);
      wireInvoke({ [`${DIR}/${f}`]: UNREADABLE(reason) });
      await takePreUpdateCopy({ from: 53, to: 55, now: NOW });
      expect(removed()).toEqual([`${DIR}/${f}`]);
    });
  }

  for (const reason of TRANSIENT) {
    it(`KEEPS a family file the validator could not open or check: ${reason.slice(0, 60)}…`, async () => {
      const f = 'cairn-pre-update-52-to-53-20260801-090000.db';
      mockReadDir.mockResolvedValue([file(f)]);
      wireInvoke({ [`${DIR}/${f}`]: UNREADABLE(reason) });
      await takePreUpdateCopy({ from: 53, to: 55, now: NOW });
      expect(mockRemove).not.toHaveBeenCalled();
    });
  }

  it("a partway chain's ORIGIN copy that is briefly unreadable is kept on disk — never removed, not reused this boot", async () => {
    const origin = 'cairn-pre-update-53-to-55-20260920-090000.db';
    mockReadDir.mockResolvedValue([file(origin)]);
    wireInvoke({ [`${DIR}/${origin}`]: UNREADABLE('Integrity check could not run: error returned from database: (code: 5) database is locked') });
    const r = await takePreUpdateCopy({ from: 54, to: 55, now: NOW, originFrom: 53 });
    expect(mockRemove).not.toHaveBeenCalled();
    expect(r).toEqual({ path: `${DIR}/cairn-pre-update-54-to-55-20260925-101500.db`, reused: false });
  });

  it('a kept-but-unreadable file is outside the rotation pool: with three valid files it is never the one rotated out', async () => {
    const unreadable = 'cairn-pre-update-49-to-50-20250101-000000.db'; // the OLDEST by time
    mockReadDir.mockResolvedValue([
      file(unreadable),
      file('cairn-pre-update-50-to-51-20260301-000000.db'),
      file('cairn-pre-update-51-to-52-20260601-000000.db'),
      file('cairn-pre-update-52-to-53-20260801-000000.db'),
    ]);
    wireInvoke({ [`${DIR}/${unreadable}`]: UNREADABLE('Integrity check could not run: error returned from database: (code: 5) database is locked') });
    await takePreUpdateCopy({ from: 53, to: 55, now: NOW });
    expect(removed()).toEqual([`${DIR}/cairn-pre-update-50-to-51-20260301-000000.db`]);
  });
});

describe('CR-U-16 — pins for the surviving mutants (U1-m24/m25/m27)', () => {
  it('U1-m24: origin reuse needs a VALID copy — a definitively invalid origin is swept, not reused, and a new copy is written', async () => {
    const origin = 'cairn-pre-update-53-to-55-20260920-090000.db';
    mockReadDir.mockResolvedValue([file(origin)]);
    wireInvoke({ [`${DIR}/${origin}`]: BAD });
    const r = await takePreUpdateCopy({ from: 54, to: 55, now: NOW, originFrom: 53 });
    expect(removed()).toEqual([`${DIR}/${origin}`]);
    expect(r.reused).toBe(false);
    expect(calls('db_backup')).toHaveLength(1);
  });

  it('U1-m25: the too-new boundary is exactly MAX+1 — never validated or removed; a from=MAX file IS validated', async () => {
    const nextBuild = `cairn-pre-update-${MAX_SCHEMA_VERSION + 1}-to-${MAX_SCHEMA_VERSION + 2}-20260924-090000.db`;
    const thisBuild = `cairn-pre-update-${MAX_SCHEMA_VERSION}-to-${MAX_SCHEMA_VERSION + 1}-20260923-090000.db`;
    mockReadDir.mockResolvedValue([file(nextBuild), file(thisBuild)]);
    wireInvoke({ [`${DIR}/${nextBuild}`]: BAD, [`${DIR}/${thisBuild}`]: OK });
    await takePreUpdateCopy({ from: 53, to: 55, now: NOW });
    const validated = calls('db_validate_backup').map((c) => (c[1] as { path: string }).path);
    expect(validated).not.toContain(`${DIR}/${nextBuild}`);
    expect(validated).toContain(`${DIR}/${thisBuild}`);
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('U1-m25: a MAX+1 file is outside the rotation pool; a from=MAX file is inside it', async () => {
    const nextBuild = `cairn-pre-update-${MAX_SCHEMA_VERSION + 1}-to-${MAX_SCHEMA_VERSION + 2}-20250101-000000.db`; // the OLDEST
    mockReadDir.mockResolvedValue([
      file(nextBuild),
      file('cairn-pre-update-50-to-51-20260301-000000.db'),
      file('cairn-pre-update-51-to-52-20260601-000000.db'),
      file(`cairn-pre-update-${MAX_SCHEMA_VERSION}-to-${MAX_SCHEMA_VERSION + 1}-20260801-000000.db`),
    ]);
    await takePreUpdateCopy({ from: 53, to: 55, now: NOW });
    expect(removed()).toEqual([`${DIR}/cairn-pre-update-50-to-51-20260301-000000.db`]);
  });

  it('U1-m27: a failed VACUUM INTO whose partial-target cleanup ALSO fails (ENOENT) still reports the Rust reason', async () => {
    wireInvoke({}, { backupRejects: 'db_backup: VACUUM INTO failed: unable to open database file' });
    mockRemove.mockRejectedValue(new Error('ENOENT: no such file or directory'));
    await expect(takePreUpdateCopy({ from: 53, to: 55, now: NOW })).rejects.toMatchObject({
      name: 'PreUpdateCopyError',
      reason: 'db_backup: VACUUM INTO failed: unable to open database file',
    });
  });
});

describe('THE LOOP PROOF (critic a): a failed-migration boot + restore never evicts a manual backup', () => {
  it('ten same-day boots with a FULL manual pool: one write, then nine reuses; zero removes; the pool is byte-identical', async () => {
    let listing = [...MANUAL_POOL];
    mockReadDir.mockImplementation(async () => listing);
    mockInvoke.mockImplementation(async (cmd: string, args: { dest?: string }) => {
      if (cmd === 'db_backup') { listing = [...listing, file(args.dest!.slice(DIR.length + 1))]; return undefined; }
      return OK;
    });
    // U1-m29: the fake remove REALLY removes from the folder listing, so the
    // byte-identical check below can fail on its own (not only via the
    // not-called check).
    mockRemove.mockImplementation(async (p: string) => { listing = listing.filter((f) => `${DIR}/${f.name}` !== p); });
    const before = MANUAL_POOL.map((f) => f.name);

    const results = [];
    for (let boot = 0; boot < 10; boot++) {
      // each relaunch a few minutes later, the same day, the same pending set
      results.push(await takePreUpdateCopy({ from: 53, to: 55, now: new Date(2026, 8, 25, 10, 15 + boot, 0) }));
    }

    expect(calls('db_backup')).toHaveLength(1);
    expect(results.map((r) => r.reused)).toEqual([false, true, true, true, true, true, true, true, true, true]);
    expect(new Set(results.map((r) => r.path)).size).toBe(1);
    expect(mockRemove).not.toHaveBeenCalled();
    expect(listing.filter((f) => /^cairn-\d{8}-\d{6}\.db$/.test(f.name)).map((f) => f.name)).toEqual(before);

    // …and the manual rotation, run over the same folder, ignores the family entirely.
    mockRemove.mockClear();
    await rotateBackups(DIR, 10);                 // exactly 10 manual files → nothing to rotate
    expect(mockRemove).not.toHaveBeenCalled();
    listing = [...listing, file('cairn-20260925-120000.db')];   // an 11th manual backup
    await rotateBackups(DIR, 10);
    expect(removed()).toEqual([`${DIR}/cairn-20260910-000000.db`]);   // the oldest MANUAL, never the family file
  });
});
