import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
vi.mock('@/lib/backup-restore', () => ({
  listBackups: vi.fn(),
  validateBackupFile: vi.fn(),
  restoreFromBackup: vi.fn(),
  revealBackupsDir: vi.fn(),
  backupsDirPath: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn(async () => undefined) }));
import { renderBootError } from '@/db/boot-error-screen';
import { SchemaTooNewError } from '@/db/migrations';
import { DatabaseCorruptError } from '@/db/integrity';
import { listBackups, validateBackupFile, restoreFromBackup, revealBackupsDir, backupsDirPath } from '@/lib/backup-restore';
import { openUrl } from '@tauri-apps/plugin-opener';
import { MigrationFailedError } from '@/db/migrations';
import { PreUpdateCopyError } from '@/lib/pre-update-copy';
import { EXPLORE_FLAG_KEY, ExploreBootError } from '@/lib/explore-mode';
import { PRE_UPDATE_HOLD_KEY, RESTORE_FAILURE_NOTICE_KEY, setUpdateHold, takeSkipOnce, takeUpdateHold } from '@/lib/boot-notices';
import { RELEASES_URL } from '@/lib/releases-url';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripComments } from '../policy/source-walker';
import { DatabaseInitError, UpdateHeldError } from '@/db/boot-errors';

describe('renderBootError', () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = document.createElement('div');
  });

  it('renders the "update Cairn" screen for SchemaTooNewError', () => {
    renderBootError(root, new SchemaTooNewError(99, 46));
    expect(root.textContent).toMatch(/update cairn/i);
    expect(root.textContent).toMatch(/newer version of cairn/i);
    // No raw stack pane for this friendly screen.
    expect(root.querySelector('pre')).toBeNull();
  });

  it('renders the corruption recovery screen with a reveal-backups button', () => {
    renderBootError(root, new DatabaseCorruptError('page 4 is never used'));
    expect(root.textContent).toMatch(/database may be corrupt/i);
    expect(root.textContent).toMatch(/backup/i);
    const btn = root.querySelector('button');
    expect(btn).not.toBeNull();
    expect(btn?.textContent).toMatch(/reveal backups/i);
    // The raw quick_check detail is shown for diagnostics.
    expect(root.querySelector('pre')?.textContent).toMatch(/page 4 is never used/);
  });

  it('falls back to a message + stack pane for an unknown error', () => {
    const err = new Error('something else broke');
    renderBootError(root, err);
    expect(root.textContent).toMatch(/database initialization failed/i);
    expect(root.querySelector('pre')?.textContent).toMatch(/something else broke/);
    // Not the friendly screens.
    expect(root.textContent).not.toMatch(/may be corrupt/i);
    expect(root.textContent).not.toMatch(/update cairn/i);
  });

  it('handles a non-Error thrown value without crashing', () => {
    renderBootError(root, 'a bare string failure');
    expect(root.textContent).toMatch(/database initialization failed/i);
    expect(root.querySelector('pre')?.textContent).toMatch(/a bare string failure/);
  });

  it('replaces prior content on each call (no accumulation)', () => {
    renderBootError(root, new SchemaTooNewError(99, 46));
    renderBootError(root, new Error('second'));
    // Only the most recent screen remains.
    expect(root.textContent).toMatch(/database initialization failed/i);
    expect(root.textContent).not.toMatch(/update cairn/i);
  });

  describe('platform-aware reveal label (distribution plan A3)', () => {
    afterEach(() => {
      // tests/setup.ts restores mocks but NOT stubbed globals.
      vi.unstubAllGlobals();
    });

    it('labels the reveal button for Finder on macOS (default jsdom UA)', () => {
      renderBootError(root, new DatabaseCorruptError('page 4 is never used'));
      expect(root.querySelector('button')?.textContent).toBe(
        'Reveal backups in Finder',
      );
    });

    it('labels the reveal button for File Explorer on Windows (WebView2 UA)', () => {
      vi.stubGlobal('navigator', {
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
      });
      renderBootError(root, new DatabaseCorruptError('page 4 is never used'));
      expect(root.querySelector('button')?.textContent).toBe(
        'Reveal backups in File Explorer',
      );
    });
  });
});

const mList = listBackups as unknown as ReturnType<typeof vi.fn>;
const mValidate = validateBackupFile as unknown as ReturnType<typeof vi.fn>;
const mRestore = restoreFromBackup as unknown as ReturnType<typeof vi.fn>;
const mReveal = revealBackupsDir as unknown as ReturnType<typeof vi.fn>;
const mOpenUrl = openUrl as unknown as ReturnType<typeof vi.fn>;
const mBackupsDir = backupsDirPath as unknown as ReturnType<typeof vi.fn>;

// PR-16: the seven EXISTING tests now render screens whose hydrator calls
// listBackups(); the bare vi.fn() would resolve undefined. One file-level hook
// (file-level hooks apply to every test in the file wherever they are
// declared); it also clears the explore flag the PR-8 test sets.
beforeEach(() => {
  mList.mockResolvedValue([]);
  localStorage.removeItem(EXPLORE_FLAG_KEY);
});

const PRE = {
  name: 'cairn-pre-update-53-to-55-20260925-101500.db',
  path: '/x/backups/cairn-pre-update-53-to-55-20260925-101500.db',
  takenAt: new Date(2026, 8, 25, 10, 15, 0), kind: 'pre-update' as const, schemaFrom: 53, schemaTo: 55,
};
const MANUAL = {
  name: 'cairn-20260926-120000.db', path: '/x/backups/cairn-20260926-120000.db',
  takenAt: new Date(2026, 8, 26, 12, 0, 0), kind: 'manual' as const,
};
const OK = { ok: true, user_version: 53, max_supported_version: 55, reason: null };
const buttons = (root: HTMLElement) => [...root.querySelectorAll('button')].map((b) => b.textContent);
const rows = (root: HTMLElement) => [...root.querySelectorAll('[data-testid="boot-restore-row"]')];
const settled = (root: HTMLElement, n: number) => vi.waitFor(() => expect(rows(root)).toHaveLength(n));
// CR-U-9: the arm guard reads an injectable clock (renderBootError's `now`).
// A fixed, test-owned counter keeps this file off the real clock (test-clock
// policy); `pastGuard()` steps it beyond the ~500 ms arm window.
let clockMs = 0;
const now = () => clockMs;
const pastGuard = () => { clockMs += 1000; };
const armedLabel = 'Confirm restore — replaces your current data';
const whenOf = (d: Date) => d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
/** CR-U-12: a failure that initDatabase's real branch threw (tagged). */
const dbInit = (msg: string) => new DatabaseInitError(new Error(msg));
const clickWith = (el: HTMLElement, detail: number) =>
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail }));

describe('v1.7.1 U2 — the restore section on every DB screen', () => {
  let root: HTMLElement;
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    root = document.createElement('div');
    mList.mockResolvedValue([MANUAL, PRE]); // manual is NEWER, but pre-update lists first
    mValidate.mockResolvedValue(OK);
    mRestore.mockResolvedValue(undefined);
  });

  for (const [label, err] of [
    ['DatabaseCorruptError', new DatabaseCorruptError('page 4 is never used')],
    ['SchemaTooNewError', new SchemaTooNewError(99, 55)],
    ['generic', dbInit('something else broke')],
    ['MigrationFailedError', new MigrationFailedError(new Error('duplicate column name'), PRE.path)],
  ] as const) {
    it(`${label}: lists backups, pre-update first with its caption, manual after — each with a Restore button`, async () => {
      renderBootError(root, err);
      expect(root.textContent).toContain('Restore a copy');
      expect(root.textContent).toContain('Cairn checks the file, then replaces your current data with it and reloads.');
      await settled(root, 2);
      expect(rows(root)[0].textContent).toContain('Before update — ');
      expect(rows(root)[0].textContent).toContain(PRE.takenAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }));
      expect(rows(root)[1].textContent).not.toContain('Before update');
      expect(rows(root).map((r) => r.querySelector('button')?.textContent)).toEqual(['Restore', 'Restore']);
    });
  }

  it('two-step confirm (critic c): click 1 validates and re-labels; nothing restores until click 2', async () => {
    const reload = vi.fn();
    renderBootError(root, new DatabaseCorruptError('x'), { reload, now });
    await settled(root, 2);
    const restoreBtn = rows(root)[0].querySelector('button')!;
    restoreBtn.click();
    await vi.waitFor(() => expect(mValidate).toHaveBeenCalledWith(PRE.path));
    expect(mRestore).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(restoreBtn.textContent).toBe('Confirm restore — replaces your current data'));
    const cancel = [...rows(root)[0].querySelectorAll('button')].find((b) => b.textContent === 'Cancel');
    expect(cancel).toBeDefined();
    pastGuard();
    restoreBtn.click();
    await vi.waitFor(() => expect(mRestore).toHaveBeenCalledTimes(1));
    expect(mRestore).toHaveBeenCalledWith(PRE.path, expect.objectContaining({ tolerateNotLoaded: true, reload }));
    // CR-U-18: the corrupt screen restores WITHOUT the one-boot hold.
    expect((mRestore.mock.calls[0][1] as { onRestored?: unknown }).onRestored).toBeUndefined();
  });

  it('Cancel puts the row back and never restores', async () => {
    renderBootError(root, new DatabaseCorruptError('x'));
    await settled(root, 2);
    const restoreBtn = rows(root)[0].querySelector('button')!;
    restoreBtn.click();
    await vi.waitFor(() => expect(restoreBtn.textContent).toBe('Confirm restore — replaces your current data'));
    [...rows(root)[0].querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!.click();
    expect(restoreBtn.textContent).toBe('Restore');
    expect([...rows(root)[0].querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Restore']);
    expect(mRestore).not.toHaveBeenCalled();
  });

  it('an invalid file shows the Rust reason in the row (a <p role="alert">, never a <pre>) and never confirms', async () => {
    mValidate.mockResolvedValue({ ok: false, user_version: 0, max_supported_version: 55, reason: 'This backup was created by a newer version of Cairn (schema 58; this app supports up to 55). Update Cairn, then restore.' });
    renderBootError(root, new SchemaTooNewError(99, 55));
    await settled(root, 2);
    rows(root)[1].querySelector('button')!.click();
    await vi.waitFor(() => expect(rows(root)[1].querySelector('[role="alert"]')?.textContent).toMatch(/newer version of Cairn/));
    expect(rows(root)[1].querySelector('button')?.textContent).toBe('Restore');
    expect(root.querySelector('pre')).toBeNull();                 // the SchemaTooNew pin holds AFTER the list settles
    expect(mRestore).not.toHaveBeenCalled();
  });

  it('a restore that rejects before the swap reports it in the row and re-enables the controls', async () => {
    mRestore.mockRejectedValue(new Error('close failed'));
    renderBootError(root, dbInit('x'), { now });
    await settled(root, 2);
    const btn = rows(root)[0].querySelector('button')!;
    btn.click();
    await vi.waitFor(() => expect(btn.textContent).toBe('Confirm restore — replaces your current data'));
    pastGuard();
    btn.click();
    await vi.waitFor(() => expect(rows(root)[0].querySelector('[role="alert"]')?.textContent).toBe('Restore did not start: close failed'));
    expect([...root.querySelectorAll('button')].every((b) => !b.disabled)).toBe(true);
  });

  it('empty folder → the calm empty line; a read failure → the reason', async () => {
    mList.mockResolvedValue([]);
    renderBootError(root, dbInit('x'));
    await vi.waitFor(() => expect(root.textContent).toContain('No backups were found in the backups folder.'));
    mList.mockRejectedValue(new Error('EACCES'));
    renderBootError(root, dbInit('x'));
    await vi.waitFor(() => expect(root.textContent).toContain('Could not read your backups: EACCES'));
  });

  it('corrupt: the FIRST button is still Reveal (pin), the hand-copy sentence is gone, the new body is present', async () => {
    renderBootError(root, new DatabaseCorruptError('page 4 is never used'));
    await settled(root, 2);
    expect(root.querySelector('button')?.textContent).toBe('Reveal backups in Finder');
    expect(root.textContent).not.toMatch(/replacing the database file/i);
    expect(root.textContent).toContain('Cairn could not open your data safely. You can restore one of your backups below, or open the backups folder.');
    expect(root.querySelector('pre')?.textContent).toMatch(/page 4 is never used/);
    expect(buttons(root).filter((t) => /^Reveal backups/.test(t ?? ''))).toHaveLength(1);
  });

  it('generic: after the list settles the text is STILL free of "may be corrupt" / "update cairn" (pin)', async () => {
    renderBootError(root, dbInit('something else broke'));
    await settled(root, 2);
    expect(root.textContent).not.toMatch(/may be corrupt/i);
    expect(root.textContent).not.toMatch(/update cairn/i);
    expect(buttons(root)).toEqual(['Try again', 'Restore', 'Restore', 'Reveal backups in Finder']); // CR-U-13: Try again first
  });

  it('a failure AFTER a successful sample boot (the explore flag still set) never lists or restores backups of the real profile (PR-8)', async () => {
    localStorage.setItem(EXPLORE_FLAG_KEY, '2026-07-08T12:00:00.000Z');
    renderBootError(root, new Error('Failed to fetch dynamically imported module'));
    await new Promise((r) => setTimeout(r, 20));               // give a wrongly-wired hydrator a tick
    expect(mList).not.toHaveBeenCalled();
    expect(root.textContent).not.toContain('Restore a copy');
    expect(root.textContent).toMatch(/database initialization failed/i);
    expect(buttons(root)).toEqual([]);
  });

  it('the hydrator is total: a non-array listing renders the read-failure line, never an unhandled rejection (PR-16)', async () => {
    mList.mockResolvedValue(undefined);
    renderBootError(root, dbInit('x'));
    await vi.waitFor(() => expect(root.textContent).toContain('Could not read your backups: '));
  });

  it('generic: a row alert quotes the validator reason verbatim; the phrase pin covers the screen copy, not interpolated Rust text (PR-21, documented)', async () => {
    mValidate.mockResolvedValue({ ok: false, user_version: 0, max_supported_version: 55, reason: 'The backup failed an integrity check (quick_check returned "x"). It may be corrupt.' });
    renderBootError(root, dbInit('something else broke'));
    await settled(root, 2);
    expect(root.textContent).not.toMatch(/may be corrupt/i);  // the pinned state
    rows(root)[0].querySelector('button')!.click();
    await vi.waitFor(() => expect(rows(root)[0].querySelector('[role="alert"]')?.textContent).toMatch(/It may be corrupt\./));
  });

  it('SchemaTooNew: the extra sentence, the releases button LAST, openUrl only on click', async () => {
    renderBootError(root, new SchemaTooNewError(99, 55));
    await settled(root, 2);
    expect(root.textContent).toContain('A copy from before an update does not include anything entered after it.');
    expect(root.textContent).toContain('Restoring a copy replaces the data in this newer file; Cairn does not keep it.');
    expect(buttons(root)).toEqual(['Restore', 'Restore', 'Reveal backups in Finder', 'Open the releases page']);
    expect(mOpenUrl).not.toHaveBeenCalled();
    [...root.querySelectorAll('button')].at(-1)!.click();
    await vi.waitFor(() => expect(mOpenUrl).toHaveBeenCalledWith(RELEASES_URL));
  });

  it('Reveal on the new screens calls revealBackupsDir', async () => {
    renderBootError(root, dbInit('x'));
    await settled(root, 2);
    [...root.querySelectorAll('button')].find((b) => b.textContent === 'Reveal backups in Finder')!.click();
    await vi.waitFor(() => expect(mReveal).toHaveBeenCalledTimes(1));
  });
});

describe('CR-U-9 — a double-click never both arms and confirms (U1-M3/M4); focus, announcement, names (U1-m11)', () => {
  let root: HTMLElement;
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    root = document.createElement('div');
    document.body.append(root); // focus needs a connected node
    mList.mockResolvedValue([MANUAL, PRE]);
    mValidate.mockResolvedValue(OK);
    mRestore.mockResolvedValue(undefined);
  });
  afterEach(() => root.remove());

  async function armFirstRow() {
    renderBootError(root, new DatabaseCorruptError('x'), { now });
    await settled(root, 2);
    const btn = rows(root)[0].querySelector('button')!;
    clickWith(btn, 1);
    await vi.waitFor(() => expect(btn.textContent).toBe(armedLabel));
    return btn;
  }

  it('the second click of a double-click (detail 2) after arming restores nothing, even past the arm window', async () => {
    const btn = await armFirstRow();
    pastGuard();
    clickWith(btn, 2);
    clickWith(btn, 3);
    await new Promise((r) => setTimeout(r, 20));
    expect(mRestore).not.toHaveBeenCalled();
    expect(btn.textContent).toBe(armedLabel); // still armed; a deliberate click can confirm
  });

  it('a click inside the ~500 ms arm window restores nothing; a deliberate click after it restores once', async () => {
    const btn = await armFirstRow();
    clockMs += 120;
    clickWith(btn, 1);
    await new Promise((r) => setTimeout(r, 20));
    expect(mRestore).not.toHaveBeenCalled();
    pastGuard();
    clickWith(btn, 1);
    await vi.waitFor(() => expect(mRestore).toHaveBeenCalledTimes(1));
  });

  it('arming moves focus to Cancel and announces the armed state in a polite live region', async () => {
    const btn = await armFirstRow();
    const cancel = [...rows(root)[0].querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!;
    expect(document.activeElement).toBe(cancel);
    const status = root.querySelector('[data-testid="boot-restore-status"]')!;
    expect(status.getAttribute('role')).toBe('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe(
      `Ready to restore the copy from before the update, ${whenOf(PRE.takenAt)}. Confirm restore replaces your current data; Cancel keeps it.`,
    );
    expect(btn.getAttribute('aria-label')).toBeNull(); // the armed button's name is its visible label
  });

  it('Cancel (or Escape) disarms, returns focus to the row Restore and clears the announcement', async () => {
    const btn = await armFirstRow();
    [...rows(root)[0].querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!.click();
    expect(document.activeElement).toBe(btn);
    expect(root.querySelector('[data-testid="boot-restore-status"]')!.textContent).toBe('');
    clickWith(btn, 1);
    await vi.waitFor(() => expect(btn.textContent).toBe(armedLabel));
    rows(root)[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(btn.textContent).toBe('Restore');
    expect(document.activeElement).toBe(btn);
    expect(mRestore).not.toHaveBeenCalled();
  });

  it('every row button has an accessible name that names its backup; the list keeps list semantics', async () => {
    renderBootError(root, new DatabaseCorruptError('x'), { now });
    await settled(root, 2);
    expect(rows(root)[0].querySelector('button')!.getAttribute('aria-label')).toBe(
      `Restore the copy from before the update, ${whenOf(PRE.takenAt)}`,
    );
    expect(rows(root)[1].querySelector('button')!.getAttribute('aria-label')).toBe(
      `Restore backup from ${whenOf(MANUAL.takenAt)}`,
    );
    expect(root.querySelector('[data-testid="boot-restore-list"]')!.getAttribute('role')).toBe('list');
  });

  it('arming a second row disarms the first: one armed row, one Cancel on the screen', async () => {
    const first = await armFirstRow();
    const second = rows(root)[1].querySelector('button')!;
    clickWith(second, 1);
    await vi.waitFor(() => expect(second.textContent).toBe(armedLabel));
    expect(first.textContent).toBe('Restore');
    expect(buttons(root).filter((t) => t === 'Cancel')).toHaveLength(1);
    expect(root.querySelector('[data-testid="boot-restore-status"]')!.textContent).toContain(
      `the backup from ${whenOf(MANUAL.takenAt)}`,
    );
  });
});

describe('CR-U-10 — while a restore is in flight, every button on the screen is disabled (U1-m12/m26)', () => {
  let root: HTMLElement;
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    root = document.createElement('div');
    mList.mockResolvedValue([PRE, MANUAL]);
    mValidate.mockResolvedValue(OK);
    mRestore.mockImplementation(() => new Promise(() => {})); // never settles: the restore is in flight
  });

  it('failed-migration screen: after the confirm, Try again, Reveal, releases and the other row are all disabled', async () => {
    const reload = vi.fn();
    renderBootError(root, new MigrationFailedError(new Error('duplicate column name'), PRE.path), { reload, now });
    await settled(root, 2);
    const btn = rows(root)[0].querySelector('button')!;
    btn.click();
    await vi.waitFor(() => expect(btn.textContent).toBe(armedLabel));
    pastGuard();
    btn.click();
    await vi.waitFor(() => expect(mRestore).toHaveBeenCalledTimes(1));
    const all = [...root.querySelectorAll('button')];
    expect(all.map((b) => b.textContent)).toEqual(
      ['Try again', armedLabel, 'Cancel', 'Restore', 'Reveal backups in Finder', 'Open the releases page'],
    );
    expect(all.every((b) => b.disabled)).toBe(true);
    all[0].click();                                 // a disabled Try again does nothing
    expect(reload).not.toHaveBeenCalled();
  });

  it('corrupt screen: the Reveal button outside the section is disabled too', async () => {
    renderBootError(root, new DatabaseCorruptError('x'), { now });
    await settled(root, 2);
    const btn = rows(root)[0].querySelector('button')!;
    btn.click();
    await vi.waitFor(() => expect(btn.textContent).toBe(armedLabel));
    pastGuard();
    btn.click();
    await vi.waitFor(() => expect(mRestore).toHaveBeenCalledTimes(1));
    expect([...root.querySelectorAll('button')].every((b) => b.disabled)).toBe(true);
  });

  it('a second row whose validation settles DURING the restore neither re-enables nor arms; a second restore never starts', async () => {
    let resolveSecond: (v: typeof OK) => void = () => {};
    mValidate.mockImplementation(async (path: string) =>
      path === MANUAL.path ? new Promise<typeof OK>((r) => { resolveSecond = r; }) : OK);
    renderBootError(root, new DatabaseCorruptError('x'), { now });
    await settled(root, 2);
    const second = rows(root)[1].querySelector('button')!;
    second.click();                                  // validation pending on row 2
    expect(second.disabled).toBe(true);              // the row-level disable during validation
    // Let row 2's lazy import settle first: two CONCURRENT dynamic imports of a
    // vi.mock'ed module can hand the second one the real module (a vitest
    // mocker artifact; a browser returns the same module to both).
    await vi.waitFor(() => expect(mValidate).toHaveBeenCalledWith(MANUAL.path));
    const first = rows(root)[0].querySelector('button')!;
    first.click();
    await vi.waitFor(() => expect(first.textContent).toBe(armedLabel));
    pastGuard();
    first.click();                                   // restore in flight
    await vi.waitFor(() => expect(mRestore).toHaveBeenCalledTimes(1));
    resolveSecond(OK);
    await new Promise((r) => setTimeout(r, 20));
    expect(second.disabled).toBe(true);
    expect(second.textContent).toBe('Restore');
    pastGuard();
    second.click();
    first.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(mRestore).toHaveBeenCalledTimes(1);
  });

  it('the "Restore did not start" path re-enables every button on the screen', async () => {
    mRestore.mockRejectedValue(new Error('close failed'));
    renderBootError(root, new MigrationFailedError(new Error('x'), PRE.path), { now });
    await settled(root, 2);
    const btn = rows(root)[0].querySelector('button')!;
    btn.click();
    await vi.waitFor(() => expect(btn.textContent).toBe(armedLabel));
    pastGuard();
    btn.click();
    await vi.waitFor(() => expect(rows(root)[0].querySelector('[role="alert"]')?.textContent).toBe('Restore did not start: close failed'));
    expect([...root.querySelectorAll('button')].every((b) => !b.disabled)).toBe(true);
    expect(buttons(root)[0]).toBe('Try again');
  });
});

describe('CR-U-12 — the restore section only for a DATABASE failure (U1-m33)', () => {
  let root: HTMLElement;
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    root = document.createElement('div');
    mList.mockResolvedValue([MANUAL, PRE]);
    mValidate.mockResolvedValue(OK);
  });

  it('a non-database bootstrap failure (a plain Error) gets the 1.7.0 generic screen: no section, no notice read, no buttons, never lists', async () => {
    sessionStorage.setItem(RESTORE_FAILURE_NOTICE_KEY, 'disk full during restore');
    const err = new Error('Failed to fetch dynamically imported module');
    renderBootError(root, err);
    await new Promise((r) => setTimeout(r, 20));               // give a wrongly-wired hydrator a tick
    expect(root.querySelector('h1')?.textContent).toBe('Database initialization failed');
    expect(root.querySelector('pre')?.textContent).toBe(`${err.message}\n\n${err.stack}`);
    expect(root.textContent).not.toContain('Restore a copy');
    expect(buttons(root)).toEqual([]);
    expect(mList).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(RESTORE_FAILURE_NOTICE_KEY)).toBe('disk full during restore'); // left for Settings
  });

  it('a DatabaseInitError gets the generic heading, its CAUSE in the pre, and the restore section', async () => {
    const cause = new Error('finance.db is locked');
    renderBootError(root, new DatabaseInitError(cause));
    expect(root.querySelector('h1')?.textContent).toBe('Database initialization failed');
    expect(root.querySelector('pre')?.textContent).toBe(`finance.db is locked\n\n${cause.stack}`);
    await settled(root, 2);
    expect(root.textContent).toContain('Restore a copy');
  });

  it('defense in depth (D-U1-20): a DatabaseInitError while the explore flag is set renders no section and never lists', async () => {
    localStorage.setItem(EXPLORE_FLAG_KEY, '2026-07-08T12:00:00.000Z');
    renderBootError(root, dbInit('x'));
    await new Promise((r) => setTimeout(r, 20));
    expect(mList).not.toHaveBeenCalled();
    expect(root.textContent).not.toContain('Restore a copy');
  });
});

describe('CR-U-13 — the generic DB screen offers Try again (U1-m15)', () => {
  it('Try again is the FIRST button and reloads; nothing is restored', async () => {
    vi.clearAllMocks();
    mList.mockResolvedValue([PRE]);
    const root = document.createElement('div');
    const reload = vi.fn();
    renderBootError(root, dbInit('database is locked'), { reload });
    await settled(root, 1);
    const first = root.querySelector('button')!;
    expect(first.textContent).toBe('Try again');
    first.click();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(mRestore).not.toHaveBeenCalled();
  });
});

describe('CR-U-14 — the update hold (U1-m8)', () => {
  let root: HTMLElement;
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    root = document.createElement('div');
    mList.mockResolvedValue([PRE, MANUAL]);
    mValidate.mockResolvedValue(OK);
    mRestore.mockResolvedValue(undefined);
  });

  async function confirmRow(i: number) {
    renderBootError(root, new MigrationFailedError(new Error('x'), PRE.path), { now });
    await settled(root, 2);
    const btn = rows(root)[i].querySelector('button')!;
    btn.click();
    await vi.waitFor(() => expect(btn.textContent).toBe(armedLabel));
    pastGuard();
    btn.click();
    await vi.waitFor(() => expect(mRestore).toHaveBeenCalledTimes(1));
    return mRestore.mock.calls[0][1] as { onRestored?: () => void };
  }

  it('a boot-screen restore of a PRE-UPDATE copy hands restoreFromBackup a hook that sets the one-boot hold', async () => {
    const opts = await confirmRow(0);
    expect(typeof opts.onRestored).toBe('function');
    expect(sessionStorage.getItem(PRE_UPDATE_HOLD_KEY)).toBeNull(); // only once the swap succeeded
    opts.onRestored!();
    expect(takeUpdateHold()).toBe(true);
  });

  it('a boot-screen restore of a MANUAL backup sets no hold', async () => {
    const opts = await confirmRow(1);
    expect(opts.onRestored).toBeUndefined();
    expect(takeUpdateHold()).toBe(false);
  });

  it('the hold screen: heading, body, and exactly Open the releases page / Try the update again / Reveal, in that order', async () => {
    renderBootError(root, new UpdateHeldError());
    expect(root.querySelector('h1')?.textContent).toBe('Cairn put back your data from before the update');
    expect(root.textContent).toContain(
      'The update was not run, so your data is the way it was before the update. To keep using Cairn now, install the previous version from the releases page.',
    );
    expect(buttons(root)).toEqual(['Open the releases page', 'Try the update again', 'Reveal backups in Finder']);
    expect(root.querySelector('pre')).toBeNull();
    await new Promise((r) => setTimeout(r, 20));
    expect(mList).not.toHaveBeenCalled();                       // no restore list here
    expect(mOpenUrl).not.toHaveBeenCalled();                    // no network until a click (CR-U-2)
    [...root.querySelectorAll('button')][0].click();
    await vi.waitFor(() => expect(mOpenUrl).toHaveBeenCalledWith(RELEASES_URL));
  });

  it('Try the update again clears the hold and reloads', () => {
    const reload = vi.fn();
    setUpdateHold();
    renderBootError(root, new UpdateHeldError(), { reload });
    [...root.querySelectorAll('button')][1].click();
    expect(takeUpdateHold()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('CR-U-16 — the confirm mutants (U1-m13)', () => {
  let root: HTMLElement;
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    root = document.createElement('div');
    mList.mockResolvedValue([PRE, MANUAL]);
    mValidate.mockResolvedValue(OK);
    mRestore.mockResolvedValue(undefined);
  });

  it('(a) after Cancel, Restore validates AGAIN and re-arms — it never restores on that click', async () => {
    renderBootError(root, new DatabaseCorruptError('x'), { now });
    await settled(root, 2);
    const btn = rows(root)[0].querySelector('button')!;
    btn.click();
    await vi.waitFor(() => expect(btn.textContent).toBe(armedLabel));
    [...rows(root)[0].querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!.click();
    pastGuard();
    btn.click();
    await vi.waitFor(() => expect(mValidate).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(btn.textContent).toBe(armedLabel));
    expect(mRestore).not.toHaveBeenCalled();
  });

  it('(c) after a "Restore did not start" rejection the row reads Restore again and has no Cancel', async () => {
    mRestore.mockRejectedValue(new Error('close failed'));
    renderBootError(root, new DatabaseCorruptError('x'), { now });
    await settled(root, 2);
    const btn = rows(root)[0].querySelector('button')!;
    btn.click();
    await vi.waitFor(() => expect(btn.textContent).toBe(armedLabel));
    pastGuard();
    btn.click();
    await vi.waitFor(() => expect(rows(root)[0].querySelector('[role="alert"]')?.textContent).toBe('Restore did not start: close failed'));
    expect(btn.textContent).toBe('Restore');
    expect([...rows(root)[0].querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Restore']);
  });
});

describe('CR-U-18 — the hold is scoped to the failed-migration screen and its true pre-update copy (U1F-M1/M2/M4)', () => {
  const OLDER_PRE = {
    name: 'cairn-pre-update-52-to-55-20260801-090000.db',
    path: '/x/backups/cairn-pre-update-52-to-55-20260801-090000.db',
    takenAt: new Date(2026, 7, 1, 9, 0, 0), kind: 'pre-update' as const, schemaFrom: 52, schemaTo: 55,
  };
  let root: HTMLElement;
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    root = document.createElement('div');
    mList.mockResolvedValue([PRE, OLDER_PRE, MANUAL]);
    mValidate.mockResolvedValue(OK);
    mRestore.mockResolvedValue(undefined);
  });

  async function confirm(err: unknown, rowIndex: number) {
    renderBootError(root, err, { now });
    await settled(root, 3);
    const btn = rows(root)[rowIndex].querySelector('button')!;
    btn.click();
    await vi.waitFor(() => expect(btn.textContent).toBe(armedLabel));
    pastGuard();
    btn.click();
    await vi.waitFor(() => expect(mRestore).toHaveBeenCalledTimes(1));
    return mRestore.mock.calls[0][1] as { onRestored?: () => void };
  }

  for (const [label, err] of [
    ['corrupt', new DatabaseCorruptError('x')],
    ['too-new', new SchemaTooNewError(99, 55)],
    ['generic database', dbInit('x')],
  ] as const) {
    it(`${label} screen: restoring the Before-update copy sets NO hold (the app boots normally after)`, async () => {
      const opts = await confirm(err, 0);
      expect(opts.onRestored).toBeUndefined();
      expect(takeUpdateHold()).toBe(false);
    });
  }

  it('failed-migration screen: only the copy the error NAMES holds — another pre-update copy does not', async () => {
    const opts = await confirm(new MigrationFailedError(new Error('x'), PRE.path), 1); // OLDER_PRE
    expect(opts.onRestored).toBeUndefined();
  });

  it('failed-migration screen: the named copy holds when it is from before the update', async () => {
    const opts = await confirm(new MigrationFailedError(new Error('x'), PRE.path), 0);
    expect(typeof opts.onRestored).toBe('function');
  });

  it('a PARTWAY copy (copyIsFromBeforeUpdate false) never holds, even when the error names it', async () => {
    const opts = await confirm(new MigrationFailedError(new Error('x'), PRE.path, false), 0);
    expect(opts.onRestored).toBeUndefined();
  });
});

describe('CR-U-20d (U1F-m15/m17) — the arm window edge, the name after every disarm, Escape during a restore', () => {
  let root: HTMLElement;
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    root = document.createElement('div');
    document.body.append(root);
    mList.mockResolvedValue([PRE, MANUAL]);
    mValidate.mockResolvedValue(OK);
    mRestore.mockResolvedValue(undefined);
  });
  afterEach(() => root.remove());
  const preName = () => `Restore the copy from before the update, ${whenOf(PRE.takenAt)}`;

  async function arm(err: unknown = new DatabaseCorruptError('x')) {
    renderBootError(root, err, { now });
    await settled(root, 2);
    const btn = rows(root)[0].querySelector('button')!;
    btn.click();
    await vi.waitFor(() => expect(btn.textContent).toBe(armedLabel));
    return { btn, armedAt: clockMs };
  }

  it('the window is exactly 500 ms: a click at +499 ms restores nothing, a click at +500 ms restores once', async () => {
    const { btn, armedAt } = await arm();
    clockMs = armedAt + 499;
    btn.click();
    await new Promise((r) => setTimeout(r, 20));
    expect(mRestore).not.toHaveBeenCalled();
    clockMs = armedAt + 500;
    btn.click();
    await vi.waitFor(() => expect(mRestore).toHaveBeenCalledTimes(1));
  });

  it('the accessible name comes back after Cancel, after Escape and after a "Restore did not start" rejection', async () => {
    const { btn } = await arm();
    [...rows(root)[0].querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!.click();
    expect(btn.getAttribute('aria-label')).toBe(preName());
    btn.click();
    await vi.waitFor(() => expect(btn.textContent).toBe(armedLabel));
    rows(root)[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(btn.getAttribute('aria-label')).toBe(preName());
    mRestore.mockRejectedValue(new Error('close failed'));
    btn.click();
    await vi.waitFor(() => expect(btn.textContent).toBe(armedLabel));
    pastGuard();
    btn.click();
    await vi.waitFor(() => expect(rows(root)[0].querySelector('[role="alert"]')?.textContent).toBe('Restore did not start: close failed'));
    expect(btn.getAttribute('aria-label')).toBe(preName());
  });

  it('Escape while a restore is in flight changes nothing: the confirm label and Cancel stay', async () => {
    mRestore.mockImplementation(() => new Promise(() => {}));
    const { btn } = await arm();
    pastGuard();
    btn.click();
    await vi.waitFor(() => expect(mRestore).toHaveBeenCalledTimes(1));
    rows(root)[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(btn.textContent).toBe(armedLabel);
    expect([...rows(root)[0].querySelectorAll('button')].map((b) => b.textContent)).toEqual([armedLabel, 'Cancel']);
  });
});

describe('CR-U-20f (U1F-m14) — focus comes back to the row after an alert', () => {
  // jsdom keeps focus on a disabled button; Blink and WebKit move it to <body>.
  // Mimic the browsers' focus fix-up so the test sees what a user would.
  let restoreDisabled: () => void = () => {};
  let root: HTMLElement;
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    root = document.createElement('div');
    document.body.append(root);
    mList.mockResolvedValue([PRE, MANUAL]);
    mValidate.mockResolvedValue(OK);
    mRestore.mockResolvedValue(undefined);
    const desc = Object.getOwnPropertyDescriptor(HTMLButtonElement.prototype, 'disabled')!;
    Object.defineProperty(HTMLButtonElement.prototype, 'disabled', {
      configurable: true,
      get: desc.get,
      set(v: boolean) {
        // Blur first: jsdom ignores blur() on an element that is already disabled.
        if (v && document.activeElement === this) (this as HTMLButtonElement).blur();
        desc.set!.call(this, v);
      },
    });
    restoreDisabled = () => Object.defineProperty(HTMLButtonElement.prototype, 'disabled', desc);
  });
  afterEach(() => { restoreDisabled(); root.remove(); });

  async function firstRow() {
    renderBootError(root, new DatabaseCorruptError('x'), { now });
    await settled(root, 2);
    const btn = rows(root)[0].querySelector('button')!;
    btn.focus();
    return btn;
  }

  it('an invalid file: the reason is an alert and focus is back on the row Restore', async () => {
    mValidate.mockResolvedValue({ ok: false, user_version: 0, max_supported_version: 55, reason: 'The backup failed an integrity check (quick_check returned "x"). It may be corrupt.' });
    const btn = await firstRow();
    btn.click();
    await vi.waitFor(() => expect(rows(root)[0].querySelector('[role="alert"]')).not.toBeNull());
    expect(document.activeElement).toBe(btn);
  });

  it('focus is only RETURNED, never stolen: a user who moved on (to Reveal) stays there', async () => {
    let settle: (v: unknown) => void = () => {};
    mValidate.mockImplementation(() => new Promise((r) => { settle = r; }));
    const btn = await firstRow();
    btn.click();
    await vi.waitFor(() => expect(mValidate).toHaveBeenCalled());
    const reveal = [...root.querySelectorAll('button')].find((b) => /^Reveal backups/.test(b.textContent ?? ''))!;
    reveal.focus();
    settle({ ok: false, user_version: 0, max_supported_version: 55, reason: 'The backup failed an integrity check (quick_check returned "x"). It may be corrupt.' });
    await vi.waitFor(() => expect(rows(root)[0].querySelector('[role="alert"]')).not.toBeNull());
    expect(document.activeElement).toBe(reveal);
  });

  it('a validate error: the same', async () => {
    mValidate.mockRejectedValue(new Error('ipc down'));
    const btn = await firstRow();
    btn.click();
    await vi.waitFor(() => expect(rows(root)[0].querySelector('[role="alert"]')?.textContent).toBe('Could not read that file: ipc down'));
    expect(document.activeElement).toBe(btn);
  });

  it('"Restore did not start": the same', async () => {
    mRestore.mockRejectedValue(new Error('close failed'));
    const btn = await firstRow();
    btn.click();
    await vi.waitFor(() => expect(btn.textContent).toBe(armedLabel));
    btn.focus();
    pastGuard();
    btn.click();
    await vi.waitFor(() => expect(rows(root)[0].querySelector('[role="alert"]')?.textContent).toBe('Restore did not start: close failed'));
    expect(document.activeElement).toBe(btn);
  });
});

describe('v1.7.1 U1 — the fail-closed screen (CR-U-1)', () => {
  let root: HTMLElement;
  beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); root = document.createElement('div'); });

  it('heading, "Your data was not changed.", the reason, and the three buttons in order', () => {
    renderBootError(root, new PreUpdateCopyError('db_backup: VACUUM INTO failed: disk full'));
    expect(root.querySelector('h1')?.textContent).toBe("Cairn couldn't save a copy of your data before updating it");
    expect(root.textContent).toContain('Your data was not changed.');
    expect(root.querySelector('pre')?.textContent).toBe('db_backup: VACUUM INTO failed: disk full');
    expect(buttons(root)).toEqual(['Try again', 'Continue without a copy', 'Reveal backups in Finder']);
    expect(mList).not.toHaveBeenCalled();                        // no restore list here (D-U1-9)
  });

  it('Try again reloads WITHOUT setting the skip flag; Continue sets it, then reloads', () => {
    const reload = vi.fn();
    renderBootError(root, new PreUpdateCopyError('x'), { reload });
    [...root.querySelectorAll('button')][0].click();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(takeSkipOnce()).toBe(false);
    [...root.querySelectorAll('button')][1].click();
    expect(takeSkipOnce()).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});

describe('v1.7.1 U1 — the failed-migration screen', () => {
  let root: HTMLElement;
  beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); root = document.createElement('div'); mList.mockResolvedValue([PRE]); mValidate.mockResolvedValue(OK); });

  it('with a copy: names the file, Try again FIRST, the list, Reveal, the releases button', async () => {
    const reload = vi.fn();
    renderBootError(root, new MigrationFailedError(new Error('duplicate column name: vehicle_repair_category_ids'), PRE.path), { reload });
    expect(root.querySelector('h1')?.textContent).toBe("Cairn couldn't finish updating your data");
    expect(root.textContent).toContain(`The update stopped partway. A copy of your data from before the update was saved: ${PRE.name}. Restoring it puts your data back the way it was; Cairn does not run the update again until you choose Try the update again. To use that data without the update, the previous version of Cairn is on the releases page.`); // CR-U-19 ⚑
    expect(root.querySelector('pre')?.textContent).toMatch(/duplicate column name/);
    await settled(root, 1);
    expect(buttons(root)).toEqual(['Try again', 'Restore', 'Reveal backups in Finder', 'Open the releases page']);
    [...root.querySelectorAll('button')][0].click();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('U1-m9: a copy that is NOT from before the update (a partway file with no origin copy) is named honestly', () => {
    const partway = '/x/backups/cairn-pre-update-54-to-55-20260925-101500.db';
    renderBootError(root, new MigrationFailedError(new Error('x'), partway, false));
    expect(root.textContent).toContain(
      'The update stopped partway. A copy of your data was saved before this attempt: cairn-pre-update-54-to-55-20260925-101500.db. An earlier attempt had already changed part of your data, so this copy is not from before the update.',
    );
    expect(root.textContent).not.toContain('from before the update was saved');
  });

  it("U1-m18: the pane shows the CAUSE's message + stack, never a repeat of the heading", () => {
    const cause = new Error('duplicate column name: vehicle_repair_category_ids');
    renderBootError(root, new MigrationFailedError(cause, PRE.path));
    expect(root.querySelector('pre')?.textContent).toBe(`duplicate column name: vehicle_repair_category_ids\n\n${cause.stack}`);
    expect(root.querySelector('pre')?.textContent).not.toContain('Cairn could not finish updating your data');
  });

  it('U1F-m10: the named PARTWAY copy\'s row, accessible name and announcement say what it is; other rows are unchanged', async () => {
    const r = document.createElement('div');
    document.body.append(r);
    renderBootError(r, new MigrationFailedError(new Error('x'), PRE.path, false), { now });
    await vi.waitFor(() => expect(rows(r)).toHaveLength(1));
    const row = rows(r)[0];
    expect(row.querySelector('span')?.textContent).toBe(`Saved before this attempt — ${whenOf(PRE.takenAt)}`);
    const btn = row.querySelector('button')!;
    expect(btn.getAttribute('aria-label')).toBe(`Restore the copy saved before this attempt, ${whenOf(PRE.takenAt)}`);
    btn.click();
    await vi.waitFor(() => expect(btn.textContent).toBe(armedLabel));
    expect(r.querySelector('[data-testid="boot-restore-status"]')!.textContent).toBe(
      `Ready to restore the copy saved before this attempt, ${whenOf(PRE.takenAt)}. Confirm restore replaces your current data; Cancel keeps it.`,
    );
    expect(r.textContent).not.toContain('Before update —');
    r.remove();
  });

  it('without a copy: says so', () => {
    renderBootError(root, new MigrationFailedError(new Error('x'), null));
    expect(root.textContent).toContain('The update stopped partway. No copy was saved before it started.');
    expect(root.textContent).not.toContain('was saved:');
  });
});

describe('v1.7.1 U2 — the sample-boot failure screen (critic b)', () => {
  it('names the sample, offers ONLY the reload (labelled for what it does, U1-m19), and never lists, reveals or opens anything', async () => {
    vi.clearAllMocks();
    const root = document.createElement('div');
    const reload = vi.fn();
    renderBootError(root, new ExploreBootError(new Error('sample-explore.db is locked')), { reload });
    expect(root.querySelector('h1')?.textContent).toBe('Sample data could not open');
    expect(root.textContent).toContain('Your own data was not opened and was not changed. Cairn opens your own profile next time.');
    expect(root.querySelector('pre')?.textContent).toBe('sample-explore.db is locked');
    // U1-m19: the flag is already cleared, so the reload opens the REAL profile —
    // the label says so instead of 'Try again'.
    expect(buttons(root)).toEqual(['Open your own profile']);
    await new Promise((r) => setTimeout(r, 20));               // give a wrongly-wired hydrator a tick
    expect(mList).not.toHaveBeenCalled();
    expect(root.textContent).not.toContain('Restore a copy');
    [...root.querySelectorAll('button')][0].click();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('v1.7.1 — the restore-failure notice is read and cleared on every DB screen', () => {
  for (const [label, err] of [
    ['corrupt', new DatabaseCorruptError('x')], ['too-new', new SchemaTooNewError(99, 55)], ['generic', dbInit('x')],
    ['pre-update', new PreUpdateCopyError('x')], ['migration', new MigrationFailedError(new Error('x'), null)],
  ] as const) {
    it(label, () => {
      vi.clearAllMocks();
      mList.mockResolvedValue([]);
      sessionStorage.setItem(RESTORE_FAILURE_NOTICE_KEY, 'disk full during restore');
      const root = document.createElement('div');
      renderBootError(root, err);
      expect(root.textContent).toContain('The last restore did not finish: disk full during restore. Your data was not changed.');
      expect(sessionStorage.getItem(RESTORE_FAILURE_NOTICE_KEY)).toBeNull();
    });
  }
});

describe('boot-error-screen invariants (source pins, CR-U-7)', () => {
  const RAW = readFileSync(resolve(__dirname, '../../src/db/boot-error-screen.ts'), 'utf8');
  // Pins read CODE (PR-2): docblocks may name innerHTML or a package in prose
  // (this file's :13 and platform.ts:5 do today). stripComments is
  // string-naive; the module carries no `//` or `/*` inside a string or regex.
  const SRC = stripComments(RAW);
  const TAURI_IMPORT = /from\s+['"]@tauri-apps\/|import\(\s*['"]@tauri-apps\//;
  it('static imports are Tauri-free modules only; every Tauri touch is a lazy import()', () => {
    const specifiers = [...SRC.matchAll(/^import[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]).sort();
    expect(specifiers).toEqual(['@/lib/boot-notices', '@/lib/explore-mode', '@/lib/platform', '@/lib/releases-url']);
    for (const s of specifiers) {
      const file = resolve(__dirname, '../../src', s.replace(/^@\//, '') + '.ts');
      expect(stripComments(readFileSync(file, 'utf8')), s).not.toMatch(TAURI_IMPORT);
    }
    expect(SRC).toMatch(/import\('@\/lib\/backup-restore'\)/);
    expect(SRC).toMatch(/import\('@tauri-apps\/plugin-opener'\)/);
  });
  it('textContent only: never innerHTML or window.confirm in code, never the updater package anywhere (the UpdaterSection guard greps raw files)', () => {
    expect(SRC).not.toMatch(/innerHTML|insertAdjacentHTML|window\.confirm/);
    expect(RAW).not.toMatch(/plugin-updater/);
  });
  it('RELEASES_URL parity with UpdaterSection (U4 folds the import)', () => {
    const updater = readFileSync(resolve(__dirname, '../../src/components/settings/UpdaterSection.tsx'), 'utf8');
    expect(updater).toContain(`'${RELEASES_URL}'`);
  });
});

describe('CR-U-15 — the restore-failure notice drops its "not changed" claim after a put-back failure', () => {
  it('a put-back failure reason renders without "Your data was not changed."', () => {
    sessionStorage.setItem(RESTORE_FAILURE_NOTICE_KEY, 'db_restore: failed to finalize the restore: simulated. Part of your current data could not be put back: /x/finance.db-wal is at /x/finance.db-wal.restore-old (denied)');
    const root = document.createElement('div');
    renderBootError(root, dbInit('x'));
    expect(root.textContent).toContain('The last restore did not finish: db_restore: failed to finalize the restore: simulated. Part of your current data could not be put back: /x/finance.db-wal is at /x/finance.db-wal.restore-old (denied).');
    expect(root.textContent).not.toContain('Your data was not changed.');
  });
});

describe('U1-m16 — the boot notice never renders a double period', () => {
  it('a reason that ends with a period', () => {
    sessionStorage.setItem(RESTORE_FAILURE_NOTICE_KEY, 'db_restore: the selected backup IS the live database.');
    const root = document.createElement('div');
    renderBootError(root, dbInit('x'));
    expect(root.textContent).toContain('The last restore did not finish: db_restore: the selected backup IS the live database. Your data was not changed.');
    expect(root.textContent).not.toContain('..');
  });
});

describe('U1-m17 — a failed Reveal says why and where the folder is', () => {
  const DIRPATH = '/Users/me/Library/Application Support/com.x.cairn/backups';
  let root: HTMLElement;
  beforeEach(() => {
    vi.clearAllMocks();
    root = document.createElement('div');
    mReveal.mockRejectedValue(new Error('No such file or directory (os error 2)'));
    mBackupsDir.mockResolvedValue(DIRPATH);
  });
  const reveal = () => [...root.querySelectorAll('button')].find((b) => /^Reveal backups/.test(b.textContent ?? ''))!;

  it('shows the reason (an alert, never a <pre>) and the folder path', async () => {
    renderBootError(root, new SchemaTooNewError(99, 55));
    // Let the list's lazy import settle first (two CONCURRENT dynamic imports
    // of a vi.mock'ed module can hand the second the real module).
    await vi.waitFor(() => expect(root.textContent).toContain('No backups were found in the backups folder.'));
    reveal().click();
    await vi.waitFor(() => expect(root.querySelector('[data-testid="boot-reveal-failure"] [role="alert"]')?.textContent)
      .toBe('Could not open the backups folder: No such file or directory (os error 2)'));
    expect(root.querySelector('[data-testid="boot-reveal-failure"]')!.textContent).toContain(`Backups folder: ${DIRPATH}`);
    expect(root.querySelector('pre')).toBeNull();               // the SchemaTooNew pin holds
  });

  it('when the path cannot be resolved either, only the reason shows', async () => {
    mBackupsDir.mockRejectedValue(new Error('no path API'));
    renderBootError(root, new PreUpdateCopyError('x'));
    reveal().click();
    await vi.waitFor(() => expect(root.querySelector('[data-testid="boot-reveal-failure"]')).not.toBeNull());
    expect(root.querySelector('[data-testid="boot-reveal-failure"]')!.textContent).not.toContain('Backups folder:');
  });

  it('a later successful Reveal clears the line', async () => {
    renderBootError(root, new PreUpdateCopyError('x'));
    reveal().click();
    await vi.waitFor(() => expect(root.querySelector('[data-testid="boot-reveal-failure"]')).not.toBeNull());
    mReveal.mockResolvedValue(undefined);
    reveal().click();
    await vi.waitFor(() => expect(root.querySelector('[data-testid="boot-reveal-failure"]')).toBeNull());
  });
});

