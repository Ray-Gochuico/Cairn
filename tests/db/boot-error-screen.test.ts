import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
vi.mock('@/lib/backup-restore', () => ({
  listBackups: vi.fn(),
  validateBackupFile: vi.fn(),
  restoreFromBackup: vi.fn(),
  revealBackupsDir: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn(async () => undefined) }));
import { renderBootError } from '@/db/boot-error-screen';
import { SchemaTooNewError } from '@/db/migrations';
import { DatabaseCorruptError } from '@/db/integrity';
import { listBackups, validateBackupFile, restoreFromBackup, revealBackupsDir } from '@/lib/backup-restore';
import { openUrl } from '@tauri-apps/plugin-opener';
import { MigrationFailedError } from '@/db/migrations';
import { PreUpdateCopyError } from '@/lib/pre-update-copy';
import { EXPLORE_FLAG_KEY, ExploreBootError } from '@/lib/explore-mode';
import { RESTORE_FAILURE_NOTICE_KEY, takeSkipOnce } from '@/lib/boot-notices';
import { RELEASES_URL } from '@/lib/releases-url';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripComments } from '../policy/source-walker';

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
    ['generic', new Error('something else broke')],
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
    expect(mRestore).toHaveBeenCalledWith(PRE.path, { tolerateNotLoaded: true, reload });
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
    renderBootError(root, new Error('x'), { now });
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
    renderBootError(root, new Error('x'));
    await vi.waitFor(() => expect(root.textContent).toContain('No backups were found in the backups folder.'));
    mList.mockRejectedValue(new Error('EACCES'));
    renderBootError(root, new Error('x'));
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
    renderBootError(root, new Error('something else broke'));
    await settled(root, 2);
    expect(root.textContent).not.toMatch(/may be corrupt/i);
    expect(root.textContent).not.toMatch(/update cairn/i);
    expect(buttons(root)).toEqual(['Restore', 'Restore', 'Reveal backups in Finder']);
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
    renderBootError(root, new Error('x'));
    await vi.waitFor(() => expect(root.textContent).toContain('Could not read your backups: '));
  });

  it('generic: a row alert quotes the validator reason verbatim; the phrase pin covers the screen copy, not interpolated Rust text (PR-21, documented)', async () => {
    mValidate.mockResolvedValue({ ok: false, user_version: 0, max_supported_version: 55, reason: 'The backup failed an integrity check (quick_check returned "x"). It may be corrupt.' });
    renderBootError(root, new Error('something else broke'));
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
    renderBootError(root, new Error('x'));
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
    expect(root.textContent).toContain(`The update stopped partway. A copy of your data from before the update was saved: ${PRE.name}. Restoring it puts your data back the way it was; Cairn tries the update again when it opens. To use that data without the update, the previous version of Cairn is on the releases page.`);
    expect(root.querySelector('pre')?.textContent).toMatch(/duplicate column name/);
    await settled(root, 1);
    expect(buttons(root)).toEqual(['Try again', 'Restore', 'Reveal backups in Finder', 'Open the releases page']);
    [...root.querySelectorAll('button')][0].click();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('without a copy: says so', () => {
    renderBootError(root, new MigrationFailedError(new Error('x'), null));
    expect(root.textContent).toContain('The update stopped partway. No copy was saved before it started.');
    expect(root.textContent).not.toContain('was saved:');
  });
});

describe('v1.7.1 U2 — the sample-boot failure screen (critic b)', () => {
  it('names the sample, offers ONLY Try again, and never lists, reveals or opens anything', async () => {
    vi.clearAllMocks();
    const root = document.createElement('div');
    const reload = vi.fn();
    renderBootError(root, new ExploreBootError(new Error('sample-explore.db is locked')), { reload });
    expect(root.querySelector('h1')?.textContent).toBe('Sample data could not open');
    expect(root.textContent).toContain('Your own data was not opened and was not changed. Cairn opens your own profile next time.');
    expect(root.querySelector('pre')?.textContent).toBe('sample-explore.db is locked');
    expect(buttons(root)).toEqual(['Try again']);
    await new Promise((r) => setTimeout(r, 20));               // give a wrongly-wired hydrator a tick
    expect(mList).not.toHaveBeenCalled();
    expect(root.textContent).not.toContain('Restore a copy');
    [...root.querySelectorAll('button')][0].click();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('v1.7.1 — the restore-failure notice is read and cleared on every DB screen', () => {
  for (const [label, err] of [
    ['corrupt', new DatabaseCorruptError('x')], ['too-new', new SchemaTooNewError(99, 55)], ['generic', new Error('x')],
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
