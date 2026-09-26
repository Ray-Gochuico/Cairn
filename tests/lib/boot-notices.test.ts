import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PRE_UPDATE_HOLD_KEY,
  PRE_UPDATE_NOTICE_KEY,
  PRE_UPDATE_SKIP_ONCE_KEY,
  RESTORE_FAILURE_NOTICE_KEY,
  RESTORE_PUT_BACK_FAILED_PHRASE,
  restoreLeftDataUnchanged,
  withoutTrailingPeriod,
  clearPostUpdateNotice,
  clearUpdateHold,
  peekPostUpdateNote,
  peekPostUpdateNotice,
  setSkipOnce,
  setUpdateHold,
  stashPostUpdateNotice,
  stashRestoreFailureNotice,
  takeRestoreFailureNotice,
  takeSkipOnce,
  takeUpdateHold,
} from '@/lib/boot-notices';

beforeEach(() => window.sessionStorage.clear());

describe('boot notices (sessionStorage, Tauri-free)', () => {
  it('keys are the documented literals (the restore key is the pre-existing one)', () => {
    expect(RESTORE_FAILURE_NOTICE_KEY).toBe('cairn.restoreFailure');
    expect(PRE_UPDATE_NOTICE_KEY).toBe('cairn.preUpdateCopy.notice');
    expect(PRE_UPDATE_SKIP_ONCE_KEY).toBe('cairn.preUpdateCopy.skipOnce');
  });

  it('restore failure: stash → take returns it ONCE, then null', () => {
    stashRestoreFailureNotice('disk full during restore');
    expect(takeRestoreFailureNotice()).toBe('disk full during restore');
    expect(takeRestoreFailureNotice()).toBeNull();
  });

  it('post-update note: peek does NOT clear; clear does; null when absent', () => {
    expect(peekPostUpdateNotice()).toBeNull();
    stashPostUpdateNotice('/x/backups/cairn-pre-update-53-to-55-20260925-101500.db');
    expect(peekPostUpdateNotice()).toBe('/x/backups/cairn-pre-update-53-to-55-20260925-101500.db');
    expect(peekPostUpdateNotice()).toBe('/x/backups/cairn-pre-update-53-to-55-20260925-101500.db'); // StrictMode-safe
    clearPostUpdateNotice();
    expect(peekPostUpdateNotice()).toBeNull();
  });

  it('skip-once: false when unset; true exactly once after setSkipOnce()', () => {
    expect(takeSkipOnce()).toBe(false);
    setSkipOnce();
    expect(takeSkipOnce()).toBe(true);
    expect(takeSkipOnce()).toBe(false);
  });

  it('update hold (CR-U-14): the documented key; false when unset; true exactly once; clear drops it', () => {
    expect(PRE_UPDATE_HOLD_KEY).toBe('cairn.preUpdateCopy.holdOnce');
    expect(takeUpdateHold()).toBe(false);
    setUpdateHold();
    expect(takeUpdateHold()).toBe(true);
    expect(takeUpdateHold()).toBe(false);
    setUpdateHold();
    clearUpdateHold();
    expect(takeUpdateHold()).toBe(false);
  });

  it('every helper is safe when sessionStorage throws (private mode)', () => {
    const real = window.sessionStorage;
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() { throw new Error('denied'); },
    });
    try {
      expect(() => stashPostUpdateNotice('/p')).not.toThrow();
      expect(peekPostUpdateNotice()).toBeNull();
      expect(() => setSkipOnce()).not.toThrow();
      expect(takeSkipOnce()).toBe(false);
      expect(takeRestoreFailureNotice()).toBeNull();
      expect(() => setUpdateHold()).not.toThrow();
      expect(takeUpdateHold()).toBe(false);
      expect(() => clearUpdateHold()).not.toThrow();
    } finally {
      Object.defineProperty(window, 'sessionStorage', { configurable: true, value: real });
    }
  });
});

describe('CR-U-15 — a failed restore claims "your data was not changed" only when that is true', () => {
  it('a put-back failure (Rust reports it) is the one reason the claim is dropped for', () => {
    expect(RESTORE_PUT_BACK_FAILED_PHRASE).toBe('could not be put back');
    expect(restoreLeftDataUnchanged('db_restore: failed to finalize the restore (your data is unchanged): denied')).toBe(true);
    expect(restoreLeftDataUnchanged('The backup failed an integrity check (quick_check returned "x"). It may be corrupt.')).toBe(true);
    expect(restoreLeftDataUnchanged('db_restore: failed to finalize the restore: simulated. Part of your current data could not be put back: /x/finance.db-wal is at /x/finance.db-wal.restore-old (denied)')).toBe(false);
  });

  it('cross-language parity: the Rust put-back message carries the exact phrase', () => {
    const rust = readFileSync(resolve(__dirname, '../../src-tauri/src/db_backup.rs'), 'utf8');
    expect(rust).toContain(`Part of your current data ${RESTORE_PUT_BACK_FAILED_PHRASE}: {}`);
  });
});

describe('U1-m16 — a period-terminated reason never renders a double period', () => {
  it('withoutTrailingPeriod drops exactly ONE trailing period', () => {
    expect(withoutTrailingPeriod('db_restore: the selected backup IS the live database.')).toBe('db_restore: the selected backup IS the live database');
    expect(withoutTrailingPeriod('disk full during restore')).toBe('disk full during restore');
    expect(withoutTrailingPeriod('a..')).toBe('a.');
  });
});

describe('U1F-m10 — the post-update note knows whether its copy is from before the update', () => {
  it('stash defaults to a true pre-update copy; a partway copy is recorded as such; clear drops both', () => {
    stashPostUpdateNotice('/x/backups/cairn-pre-update-53-to-55-20260925-101500.db');
    expect(peekPostUpdateNote()).toEqual({ copyPath: '/x/backups/cairn-pre-update-53-to-55-20260925-101500.db', fromBeforeUpdate: true });
    stashPostUpdateNotice('/x/backups/cairn-pre-update-54-to-55-20260925-101500.db', false);
    expect(peekPostUpdateNote()).toEqual({ copyPath: '/x/backups/cairn-pre-update-54-to-55-20260925-101500.db', fromBeforeUpdate: false });
    clearPostUpdateNotice();
    expect(peekPostUpdateNote()).toBeNull();
  });
});

describe('CR-U-20a/h — the Rust refusals the notices quote (cross-language)', () => {
  const rust = readFileSync(resolve(__dirname, '../../src-tauri/src/db_backup.rs'), 'utf8');
  const ONE = 'from an earlier restore is next to your data. Move it out of that folder, then try again (your data is unchanged)';
  const MANY = 'from an earlier restore are next to your data. Move them out of that folder, then try again (your data is unchanged)';
  const STAGING = "db_restore: the selected file is Cairn's own restore staging file, not a backup (your data is unchanged)";

  it('the step-0 refusals (one leftover, both leftovers) and the staging-file refusal are the exact Rust formats', () => {
    expect(rust).toContain(`"db_restore: {one} ${ONE}"`);
    expect(rust).toContain(`"db_restore: {} ${MANY}"`);
    expect(rust).toContain(`"${STAGING}"`);
  });

  it('each keeps the notice\'s "Your data was not changed." (nothing was moved)', () => {
    for (const reason of [`db_restore: /x/finance.db-wal.restore-old ${ONE}`, `db_restore: /x/a and /x/b ${MANY}`, STAGING]) {
      expect(restoreLeftDataUnchanged(reason)).toBe(true);
    }
  });
});

describe('CR-U-23c — a stuck -shm (the rebuildable index) is not data loss', () => {
  const rust = readFileSync(resolve(__dirname, '../../src-tauri/src/db_backup.rs'), 'utf8');
  it('the Rust -shm-only format keeps "(your data is unchanged)" and never carries the alarm phrase', () => {
    expect(rust).toContain('"db_restore: {step} (your data is unchanged): {e}. The index file {}; SQLite rebuilds it from your data"');
  });
  it('so the notices keep "Your data was not changed." for it', () => {
    expect(restoreLeftDataUnchanged('db_restore: failed to finalize the restore (your data is unchanged): denied. The index file /x/finance.db-shm is at /x/finance.db-shm.restore-old (denied); SQLite rebuilds it from your data')).toBe(true);
  });
});

