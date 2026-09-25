/**
 * Boot/session notices — sessionStorage keys that carry a one-line fact across
 * a forced reload or into the first render after an update. Tauri-free so the
 * pre-React boot-error screen (src/db/boot-error-screen.ts) can import it
 * statically. sessionStorage dies with the window, so nothing here outlives
 * the session; explore's exit blanks the store (explore-mode.ts).
 *
 *  - RESTORE_FAILURE_NOTICE_KEY (moved from backup-restore.ts, v1.7.1 U1):
 *    a failed db_restore's reason, read-once by DataSection and by every
 *    boot-error screen.
 *  - PRE_UPDATE_NOTICE_KEY: the path of the copy taken before this boot's
 *    migrations; PostUpdateNote peeks it on mount and clears it on Dismiss.
 *  - PRE_UPDATE_SKIP_ONCE_KEY: "Continue without a copy" — consumed by the
 *    next boot's decision point (init.ts maybeTakePreUpdateCopy).
 *  - PRE_UPDATE_HOLD_KEY (code-review round, CR-U-14): set by a boot-screen
 *    restore of a pre-update copy once the swap succeeded; consumed at the
 *    start of the next real boot, which then holds the update for that one
 *    boot instead of re-running it.
 */
export const RESTORE_FAILURE_NOTICE_KEY = 'cairn.restoreFailure';
export const PRE_UPDATE_NOTICE_KEY = 'cairn.preUpdateCopy.notice';
export const PRE_UPDATE_SKIP_ONCE_KEY = 'cairn.preUpdateCopy.skipOnce';
export const PRE_UPDATE_HOLD_KEY = 'cairn.preUpdateCopy.holdOnce';

function write(key: string, value: string): void {
  try { window.sessionStorage.setItem(key, value); } catch { /* best-effort */ }
}
function peek(key: string): string | null {
  try { return window.sessionStorage.getItem(key); } catch { return null; }
}
function clear(key: string): void {
  try { window.sessionStorage.removeItem(key); } catch { /* best-effort */ }
}
function take(key: string): string | null {
  const v = peek(key);
  if (v !== null) clear(key);
  return v;
}

/**
 * CR-U-15: db_restore sets the replaced file's -wal/-shm aside and puts them
 * back when the swap fails. When one cannot go back, its message says so with
 * this exact phrase (src-tauri/src/db_backup.rs put_back_or_report; pinned
 * across the two languages in tests/lib/boot-notices.test.ts), and the
 * restore-failure notices must then NOT claim the data was not changed.
 */
export const RESTORE_PUT_BACK_FAILED_PHRASE = 'could not be put back';

/** False only when db_restore reported a sidecar it could not put back. */
export function restoreLeftDataUnchanged(reason: string): boolean {
  return !reason.includes(RESTORE_PUT_BACK_FAILED_PHRASE);
}

export function stashRestoreFailureNotice(reason: string): void { write(RESTORE_FAILURE_NOTICE_KEY, reason); }
export function takeRestoreFailureNotice(): string | null { return take(RESTORE_FAILURE_NOTICE_KEY); }

export function stashPostUpdateNotice(copyPath: string): void { write(PRE_UPDATE_NOTICE_KEY, copyPath); }
export function peekPostUpdateNotice(): string | null { return peek(PRE_UPDATE_NOTICE_KEY); }
export function clearPostUpdateNotice(): void { clear(PRE_UPDATE_NOTICE_KEY); }

export function setSkipOnce(): void { write(PRE_UPDATE_SKIP_ONCE_KEY, '1'); }
export function takeSkipOnce(): boolean { return take(PRE_UPDATE_SKIP_ONCE_KEY) !== null; }

export function setUpdateHold(): void { write(PRE_UPDATE_HOLD_KEY, '1'); }
export function takeUpdateHold(): boolean { return take(PRE_UPDATE_HOLD_KEY) !== null; }
export function clearUpdateHold(): void { clear(PRE_UPDATE_HOLD_KEY); }
