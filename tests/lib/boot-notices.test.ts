import { beforeEach, describe, expect, it } from 'vitest';
import {
  PRE_UPDATE_NOTICE_KEY,
  PRE_UPDATE_SKIP_ONCE_KEY,
  RESTORE_FAILURE_NOTICE_KEY,
  clearPostUpdateNotice,
  peekPostUpdateNotice,
  setSkipOnce,
  stashPostUpdateNotice,
  stashRestoreFailureNotice,
  takeRestoreFailureNotice,
  takeSkipOnce,
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
    } finally {
      Object.defineProperty(window, 'sessionStorage', { configurable: true, value: real });
    }
  });
});
