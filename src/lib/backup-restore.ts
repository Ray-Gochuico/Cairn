import { z } from 'zod';

/**
 * Backup envelope — the JSON shape we round-trip to disk.
 *
 * Lenient by design: each entity array is `z.array(z.any())` and household
 * is `z.any().nullable()`. The envelope only enforces shape (which keys exist
 * + version pinning), not row-level field validity. Real per-entity validation
 * lives in the repo layer when we apply a restore — those code paths already
 * call the entity Zod schemas before any INSERT.
 *
 * Why lenient at this layer:
 *   - The schema can grow (new entity tables in later phases) without forcing
 *     every backup file to be re-versioned.
 *   - Restore can present per-row errors with a row-level Zod failure, instead
 *     of failing the whole file at envelope parse time.
 *   - It keeps this module zero-coupled to the entity schemas, which evolve
 *     independently.
 *
 * The `version: z.literal(1)` IS strict — bumping the envelope shape requires
 * a deliberate version bump and a migrator.
 */
export const BackupSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  household: z.any().nullable(),
  persons: z.array(z.any()),
  dependents: z.array(z.any()),
  accounts: z.array(z.any()),
  holdings: z.array(z.any()),
  contributions: z.array(z.any()),
  account_snapshots: z.array(z.any()),
  loans: z.array(z.any()),
  loan_payments: z.array(z.any()),
  properties: z.array(z.any()),
  vehicles: z.array(z.any()),
  equity_grants: z.array(z.any()),
  goals: z.array(z.any()),
});

export type Backup = z.infer<typeof BackupSchema>;
export type BackupData = Omit<Backup, 'version' | 'exportedAt'>;

/**
 * Wraps the entity arrays in a versioned envelope and stamps `exportedAt`
 * with the current ISO timestamp. Returns a pretty-printed JSON string so
 * users can sanity-check the file in any text editor.
 */
export function serializeBackup(data: BackupData): string {
  const payload: Backup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    ...data,
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Parses + validates a backup JSON string. Throws with a clear message for
 * malformed JSON; otherwise rethrows the Zod error verbatim so callers can
 * surface field-level details to the user.
 */
export function deserializeBackup(json: string): Backup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Invalid JSON');
  }
  return BackupSchema.parse(parsed);
}

// ───────────────────────────────────────────────────────────────────────────
// Whole-database backup + restore (the REAL, lossless path).
//
// The JSON envelope above is legacy: it only round-tripped in-memory store
// state for ~13 of ~30 tables. The functions below back up and restore the
// ENTIRE `finance.db` file via Rust commands (`db_backup`/`db_restore`), so
// every table — transactions, settings, scenarios, tickers, categories,
// learning_state, snapshots, … — is preserved exactly. This is the primary
// path the Settings → Data UI uses.
// ───────────────────────────────────────────────────────────────────────────

import { invoke } from '@tauri-apps/api/core';
import { appConfigDir } from '@tauri-apps/api/path';
import { mkdir, readDir, remove } from '@tauri-apps/plugin-fs';
import { save } from '@tauri-apps/plugin-dialog';
import { revealItemInDir } from '@tauri-apps/plugin-opener';

/** The plugin connection URL the app loads (and the key both Rust commands
 * resolve their pool/path from). Single source of truth here. */
export const DB_URL = 'sqlite:finance.db';

/** Name of the rotating backups subdirectory under the app config dir. */
export const BACKUPS_DIR_NAME = 'backups';

/** How many timestamped backups to keep before rotating the oldest out. */
export const MAX_BACKUPS = 10;

/** Result shape returned by the Rust `db_validate_backup` command. */
export interface BackupValidation {
  ok: boolean;
  user_version: number;
  max_supported_version: number;
  reason: string | null;
}

/**
 * True when running inside the Tauri webview (vs. `dev:browser`). We probe the
 * runtime marker Tauri injects rather than importing the SDK's `isTauri`,
 * because the browser shim for `@tauri-apps/api/core` does not re-export it —
 * importing it would break the browser build. The Data UI uses this to gate the
 * desktop-only backup/restore actions and show a "desktop app" note otherwise.
 */
export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** Join path segments with the POSIX separator (macOS-first app; the app
 * config dir is always an absolute POSIX path on macOS). */
function joinPath(...segments: string[]): string {
  return segments
    .map((s, i) => (i === 0 ? s.replace(/\/+$/, '') : s.replace(/^\/+|\/+$/g, '')))
    .filter((s) => s.length > 0)
    .join('/');
}

/** Two-digit zero-pad. */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Build the timestamped backup filename `cairn-YYYYMMDD-HHMMSS.db` from a
 * local-time Date. Local time (not UTC) so the filename matches the wall clock
 * the user reads — these files are for human browsing in Finder.
 */
export function backupFilename(now: Date = new Date()): string {
  const y = now.getFullYear();
  const mo = pad2(now.getMonth() + 1);
  const d = pad2(now.getDate());
  const h = pad2(now.getHours());
  const mi = pad2(now.getMinutes());
  const s = pad2(now.getSeconds());
  return `cairn-${y}${mo}${d}-${h}${mi}${s}.db`;
}

/** Absolute path to the rotating backups directory under the app config dir
 * (same base dir the plugin stores `finance.db` in). */
export async function backupsDirPath(): Promise<string> {
  const base = await appConfigDir();
  return joinPath(base, BACKUPS_DIR_NAME);
}

/**
 * Delete all but the newest `keep` `cairn-*.db` files in `dir`. The timestamped
 * naming sorts lexicographically in chronological order, so "newest" is just
 * the tail of the sorted list. Only `cairn-*.db` files are considered —
 * unrelated files and subdirectories are never touched.
 */
export async function rotateBackups(dir: string, keep: number = MAX_BACKUPS): Promise<void> {
  const entries = await readDir(dir);
  const backups = entries
    .filter((e) => e.isFile && /^cairn-\d{8}-\d{6}\.db$/.test(e.name))
    .map((e) => e.name)
    .sort(); // lexicographic == chronological for this naming
  if (backups.length <= keep) return;
  const toRemove = backups.slice(0, backups.length - keep);
  for (const name of toRemove) {
    await remove(joinPath(dir, name));
  }
}

/**
 * Take a real, whole-file backup into the rotating `backups/` dir and return
 * the absolute path written. Flow: ensure `backups/` exists → invoke the Rust
 * `db_backup` (VACUUM INTO a fresh timestamped file) → rotate to MAX_BACKUPS.
 */
export async function runBackup(now: Date = new Date()): Promise<string> {
  const dir = await backupsDirPath();
  await mkdir(dir, { recursive: true });
  const dest = joinPath(dir, backupFilename(now));
  await invoke('db_backup', { db: DB_URL, dest });
  // Rotation is best-effort cleanup; never let it mask a successful backup.
  try {
    await rotateBackups(dir, MAX_BACKUPS);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[backup] rotation failed (backup itself succeeded):', e);
  }
  return dest;
}

/** Read-only pre-flight: ask Rust whether `path` is a restorable Cairn backup. */
export async function validateBackupFile(path: string): Promise<BackupValidation> {
  return invoke<BackupValidation>('db_validate_backup', { path });
}

/**
 * sessionStorage key carrying a failed-restore reason across the forced reload,
 * so the freshly-booted app can surface what went wrong. Read-once (the reader
 * removes it). See `takeRestoreFailureNotice`.
 */
export const RESTORE_FAILURE_NOTICE_KEY = 'cairn.restoreFailure';

/**
 * Restore the live database from `source`, corruption-safely:
 *   1. close the live pool so no connection holds the file/WAL open;
 *   2. invoke Rust `db_restore` (re-validates, then ATOMICALLY swaps the file +
 *      clears the stale `-wal`/`-shm` sidecars — see src-tauri/src/db_backup.rs);
 *   3. ALWAYS reload the webview so boot re-inits a fresh pool.
 *
 * STEP 1 invokes the plugin's `close` command directly rather than
 * `Database.load(url).close()`. CRITICAL DISTINCTION: `Database.load` runs the
 * plugin's `load` command, which `Pool::connect`s a BRAND-NEW pool and
 * OVERWRITES the live one in `DbInstances` — `.close()` would then close that
 * new pool while the original live pool's connections linger (still holding the
 * file open during the swap → corruption risk). The `close` command instead
 * looks up the EXISTING entry and `pool.close().await`s it deterministically,
 * draining every connection AND checkpointing the WAL before we touch the file.
 * (See tauri-plugin-sql 2.4.0 commands.rs `load` vs `close`.)
 *
 * M-4 — RELOAD IS UNCONDITIONAL ONCE THE POOL IS CLOSED. After step 1 the
 * session is running on a CLOSED pool; every subsequent query would fail, so
 * leaving the app running (e.g. because `db_restore` threw) would brick it until
 * a manual restart. We therefore reload whether step 2 succeeds OR throws. This
 * is only safe because of H-1: a failed `db_restore` leaves the ORIGINAL
 * `finance.db` byte-for-byte intact, so the post-reload boot re-inits cleanly on
 * valid data. On failure we stash the reason in sessionStorage first so the app
 * can surface it after reload (best-effort; never blocks the reload).
 *
 * If the CLOSE itself fails (step 1, before the point of no return), the pool
 * may still be alive — we do NOT reload and propagate the error so the caller
 * surfaces it against the still-live DB.
 *
 * `reload` is injectable for tests; it defaults to `window.location.reload`.
 */
export async function restoreFromBackup(
  source: string,
  opts: { reload?: () => void } = {},
): Promise<void> {
  const reload = opts.reload ?? (() => window.location.reload());

  // Deterministically close the EXISTING live pool (drains + closes every
  // connection, checkpoints WAL). Do NOT use Database.load here — see above.
  // A failure here is BEFORE the point of no return: propagate without reload.
  await invoke('plugin:sql|close', { db: DB_URL });

  // Point of no return: the pool is closed. From here we MUST reload no matter
  // what, or the session is stuck on a dead pool (M-4).
  try {
    await invoke('db_restore', { db: DB_URL, source });
  } catch (e) {
    // H-1 guarantees the original finance.db is intact on a failed restore, so
    // the reload below re-inits on valid data. Stash the reason for the app to
    // show post-reload; swallow any sessionStorage error (never block reload).
    try {
      const reason = e instanceof Error ? e.message : String(e);
      window.sessionStorage?.setItem(RESTORE_FAILURE_NOTICE_KEY, reason);
    } catch {
      // sessionStorage unavailable — the reload still happens; reason is lost.
    }
  } finally {
    reload();
  }
}

/**
 * Read-and-clear the failed-restore reason left by `restoreFromBackup` before a
 * forced reload. Returns the reason once (subsequent calls return null).
 * Safe to call on every boot; returns null when there's nothing pending.
 */
export function takeRestoreFailureNotice(): string | null {
  try {
    const reason = window.sessionStorage?.getItem(RESTORE_FAILURE_NOTICE_KEY) ?? null;
    if (reason !== null) window.sessionStorage.removeItem(RESTORE_FAILURE_NOTICE_KEY);
    return reason;
  } catch {
    return null;
  }
}

/**
 * "Save a copy…": prompt for a destination with a native save dialog, then
 * VACUUM a fresh backup straight to the chosen path. Returns the path written,
 * or null if the user cancelled.
 */
export async function saveBackupCopy(now: Date = new Date()): Promise<string | null> {
  const dest = await save({
    defaultPath: backupFilename(now),
    filters: [{ name: 'Cairn backup', extensions: ['db'] }],
  });
  if (!dest) return null;
  await invoke('db_backup', { db: DB_URL, dest });
  return dest;
}

/** Reveal the rotating backups directory in Finder. */
export async function revealBackupsDir(): Promise<void> {
  const dir = await backupsDirPath();
  await revealItemInDir(dir);
}
