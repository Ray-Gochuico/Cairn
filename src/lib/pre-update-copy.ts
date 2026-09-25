/**
 * The automatic pre-update safety copy (v1.7.1 U1; CR-U-1/3/5).
 *
 * Called by src/db/init.ts on the REAL profile, in the Tauri runtime, only
 * when migrations are pending, strictly BEFORE runMigrations. Writes a
 * validated VACUUM INTO copy of the untouched database into $APPCONFIG/backups
 * under the `cairn-pre-update-<from>-to-<to>-YYYYMMDD-HHMMSS.db` family
 * (src/lib/pre-update-names.ts), which manual rotation can never match.
 *
 * Order: mkdir -p → readDir → sweep (remove family files the validator
 * definitively rejects; keep ones it could not open or check, and files too
 * new for this build) → reuse (a partway chain's
 * ORIGIN copy, any day — D-U1-17; else a valid same-from/to copy taken TODAY,
 * local day) → db_backup (a rejection removes its own partial target) →
 * db_validate_backup (else remove + throw) → rotate the VALID family pool to
 * PRE_UPDATE_KEEP (after the write; best effort). Every failure surfaces as
 * PreUpdateCopyError, which the boot screen renders as the fail-closed choice.
 */
import { invoke } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import { mkdir, readDir, remove } from '@tauri-apps/plugin-fs';
import { MAX_SCHEMA_VERSION } from '@/db/migrations';
import { localTodayISO } from './dates';
import { DB_URL, backupsDirPath, validateBackupFile } from './backup-restore';
import {
  PRE_UPDATE_KEEP,
  parsePreUpdateCopyName,
  preUpdateCopyFilename,
  type PreUpdateCopyName,
} from './pre-update-names';

export class PreUpdateCopyError extends Error {
  readonly reason: string;
  readonly cause: unknown;
  constructor(reason: string, cause?: unknown) {
    super(`Cairn could not save a copy of your data before updating it: ${reason}`);
    this.name = 'PreUpdateCopyError';
    this.reason = reason;
    this.cause = cause;
    Object.setPrototypeOf(this, PreUpdateCopyError.prototype);
  }
}

/**
 * CR-U-11 (U1-m2/m10): true only when a validator rejection says the file is
 * DEFINITIVELY not a valid Cairn database — its quick_check reported a
 * problem, it is not a SQLite database, its image is malformed, or it has no
 * schema_migrations table (the Rust reasons in src-tauri/src/db_backup.rs
 * validate_backup_file; SQLite's NOTADB/CORRUPT texts ride inside sqlx's
 * "(code: N) …" message). Any other rejection — the file could not be opened
 * (a lock, a permission, an I/O error) or its check could not run — says
 * nothing about the file, so the sweep KEEPS it. The phrases are pinned in
 * tests/lib/pre-update-copy.test.ts with the real Rust formats.
 */
export function isDefinitivelyInvalidCopy(reason: string | null): boolean {
  if (reason === null) return false;
  return (
    reason.startsWith('The backup failed an integrity check') ||
    reason.includes('no schema_migrations table') ||
    reason.includes('file is not a database') ||
    reason.includes('database disk image is malformed')
  );
}

export interface TakePreUpdateCopyArgs {
  from: number;
  to: number;
  now: Date;
  /** Partway chain (D-U1-17): the schema the interrupted update STARTED from
   * (the file's user_version). Its copy is reused whatever the day or `to`. */
  originFrom?: number;
}
export interface TakePreUpdateCopyResult { path: string; reused: boolean }

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function takePreUpdateCopy(args: TakePreUpdateCopyArgs): Promise<TakePreUpdateCopyResult> {
  try {
    return await takeInner(args);
  } catch (e) {
    throw e instanceof PreUpdateCopyError ? e : new PreUpdateCopyError(messageOf(e), e);
  }
}

async function takeInner({ from, to, now, originFrom }: TakePreUpdateCopyArgs): Promise<TakePreUpdateCopyResult> {
  const dir = await backupsDirPath();
  await mkdir(dir, { recursive: true });

  const entries = await readDir(dir);
  const family: PreUpdateCopyName[] = [];
  for (const e of entries) {
    if (!e.isFile) continue;
    const parsed = parsePreUpdateCopyName(e.name);
    if (parsed) family.push(parsed);
  }
  family.sort((a, b) => a.takenAt.getTime() - b.takenAt.getTime() || a.name.localeCompare(b.name));

  // Sweep + reuse. A file whose `from` exceeds this build's MAX was written by
  // a newer build (a downgrade): keep it untouched (D-U1-6). A file the
  // validator DEFINITIVELY rejects is a leftover from a crashed VACUUM INTO
  // and is removed; one it merely could not open or check (a lock, a
  // permission, an I/O error) is KEPT — out of reuse and rotation for this
  // boot, never deleted: it may be a partway chain's only origin copy
  // (CR-U-11).
  const valid: PreUpdateCopyName[] = [];
  const today = localTodayISO(now);
  for (const f of family) {
    if (f.schemaFrom > MAX_SCHEMA_VERSION) continue;
    const path = await join(dir, f.name);
    const v = await validateBackupFile(path);
    if (!v.ok) {
      if (isDefinitivelyInvalidCopy(v.reason)) {
        try { await remove(path); } catch (e) { console.warn('[pre-update] could not remove an invalid copy:', e); } // eslint-disable-line no-console
      }
      continue;
    }
    valid.push(f);
  }
  const newestFirst = [...valid].reverse();
  // A partway chain (D-U1-17) resumes from the copy it started from, any day.
  const origin = originFrom === undefined ? undefined : newestFirst.find((f) => f.schemaFrom === originFrom);
  if (origin) return { path: await join(dir, origin.name), reused: true };
  const reusable = newestFirst.find(
    (f) => f.schemaFrom === from && f.schemaTo === to && localTodayISO(f.takenAt) === today,
  );
  if (reusable) return { path: await join(dir, reusable.name), reused: true };

  const destName = preUpdateCopyFilename(from, to, now);
  const dest = await join(dir, destName);
  try {
    await invoke('db_backup', { db: DB_URL, dest });
  } catch (e) {
    // SQLite does not unlink a failed VACUUM INTO target; on a full disk the
    // partial file would keep the last free bytes and defeat "Continue without
    // a copy" (PR-4). A same-name NON-file entry was never ours — leave it.
    if (!entries.some((x) => x.name === destName && !x.isFile)) {
      try { await remove(dest); } catch { /* nothing was created */ }
    }
    throw new PreUpdateCopyError(messageOf(e), e);
  }
  const v = await validateBackupFile(dest);
  if (!v.ok) {
    try { await remove(dest); } catch { /* best-effort */ }
    throw new PreUpdateCopyError(v.reason ?? 'the copy did not validate');
  }

  // Rotate the FAMILY only, after a successful write, never on failure. The
  // pool is `valid` (oldest first): swept files are gone, and too-new files are
  // outside it (D-U1-6, PR-14).
  try {
    const excess = valid.length + 1 - PRE_UPDATE_KEEP; // +1: the file just written is the newest
    for (const f of valid.slice(0, Math.max(0, excess))) await remove(await join(dir, f.name));
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[pre-update] rotation failed (the copy itself succeeded):', e);
  }
  return { path: dest, reused: false };
}
