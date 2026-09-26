/**
 * Friendly, recovery-oriented boot-error screens.
 *
 * Every DB boot failure gets a tailored, calm screen instead of a raw stack
 * trace, matched by error NAME:
 *   - `SchemaTooNewError` (H3): the DB is from a newer Cairn build → "update
 *     Cairn", plus a restore list and the releases page (v1.7.1 U2).
 *   - `DatabaseCorruptError` (M1): `PRAGMA quick_check` failed → "your database
 *     may be corrupt", the reveal-backups button FIRST, then a restore list.
 *   - `PreUpdateCopyError` (v1.7.1 U1, CR-U-1): the automatic copy taken before
 *     an update could not be written → fail-closed with a choice: Try again,
 *     Continue without a copy, Reveal backups. Nothing was migrated.
 *   - `MigrationFailedError` (v1.7.1 U1): the update stopped partway → Try
 *     again, a restore list (the copy taken before the update lists first),
 *     Reveal backups, the releases page.
 *   - `ExploreBootError` (v1.7.1 U2): the SAMPLE data could not open → one
 *     reload, labelled 'Open your own profile' (U1-m19). The real profile's
 *     backups are never listed on it.
 *   - `UpdateHeldError` (v1.7.1 CR-U-14): the boot after a boot-screen restore
 *     of a pre-update copy held the update → the releases page, Try the
 *     update again, Reveal backups. No restore list.
 *   - `DatabaseInitError` (v1.7.1 CR-U-12): any other failure of the
 *     real-profile DATABASE boot → the generic heading + pane, Try again
 *     (CR-U-13), then the restore list.
 * Anything else (not a database failure: a lazy App import, a theme module)
 * falls back to the 1.7.0 message + stack pane, with nothing destructive.
 *
 * The restore list (every DB screen except the fail-closed and sample ones)
 * is filled asynchronously through a lazy import of `@/lib/backup-restore`,
 * and restores through a two-step vanilla confirm: the first click validates
 * the file and re-labels the button, the second click restores. It renders
 * NOTHING while `isExploreMode()` is true (D-U1-20): a failure after a
 * successful sample boot must never offer the real profile's backups.
 *
 * Built with `createElement` + `textContent` (never `innerHTML`): error messages
 * can carry user-controlled file paths and the CSP lacks `'unsafe-inline'` for
 * scripts. The typed errors are matched by `name` (not `instanceof`) so this
 * stays robust even if a class identity is duplicated across bundle chunks.
 *
 * Extracted from `main.tsx` (which auto-runs `bootstrap()` on import) so the
 * branching is unit-testable in isolation.
 *
 * Static imports are Tauri-free leaf modules only (`@/lib/platform`,
 * `@/lib/boot-notices`, `@/lib/releases-url`, `@/lib/explore-mode`),
 * preserving this module's "no static Tauri imports on the boot path"
 * invariant; every Tauri touch is a lazy `import()` inside a click or the
 * list hydrator.
 */
import { isWindows } from '@/lib/platform';
import {
  clearUpdateHold,
  restoreLeftDataUnchanged,
  setSkipOnce,
  setUpdateHold,
  takeRestoreFailureNotice,
  withoutTrailingPeriod,
} from '@/lib/boot-notices';
import { RELEASES_URL } from '@/lib/releases-url';
import { isExploreMode } from '@/lib/explore-mode';

type BackupEntry = import('@/lib/backup-restore').BackupEntry;

export interface BootScreenOptions {
  /** Injectable for tests; defaults to `window.location.reload()`. */
  reload?: () => void;
  /** Monotonic milliseconds for the arm guard (CR-U-9). Injectable for tests;
   * defaults to `performance.now()`. */
  now?: () => number;
}

/** CR-U-9: an armed row ignores clicks for this long after arming, so the
 * second click of a double-click can never confirm. */
const ARM_GUARD_MS = 500;
/** CR-U-23b: the second click of a double-click (detail > 1) is dropped only
 * this long after arming. After it, any click confirms — a slow macOS
 * double-click setting can make a deliberate click arrive as detail 2. */
const MULTI_CLICK_WINDOW_MS = 1500;

const TEXT_COLOR = '#1f2937';
const ERROR_COLOR = '#dc2626';

function makeContainer(color: string = TEXT_COLOR): HTMLDivElement {
  const container = document.createElement('div');
  container.style.padding = '24px';
  container.style.fontFamily = 'system-ui';
  container.style.maxWidth = '640px';
  container.style.background = '#ffffff';
  container.style.color = color;
  return container;
}

function makeHeading(text: string): HTMLHeadingElement {
  const heading = document.createElement('h1');
  heading.textContent = text;
  return heading;
}

function makeParagraph(text: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.style.lineHeight = '1.5';
  p.textContent = text;
  return p;
}

function makePre(text: string): HTMLPreElement {
  const pre = document.createElement('pre');
  pre.style.background = '#f3f4f6';
  pre.style.padding = '12px';
  pre.style.borderRadius = '6px';
  pre.style.whiteSpace = 'pre-wrap';
  pre.style.fontSize = '12px';
  pre.textContent = text;
  return pre;
}

function makeButton(label: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.style.padding = '8px 14px';
  btn.style.borderRadius = '6px';
  btn.style.border = '1px solid #d1d5db';
  btn.style.cursor = 'pointer';
  btn.style.marginRight = '8px';
  btn.style.marginBottom = '12px';
  return btn;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The reveal button: label by platform, a lazy `revealBackupsDir` so this
 * boot path has no static Tauri dependency. A failed reveal (no backups
 * folder yet, the opener unavailable) says why and, when it can be resolved,
 * where the folder is (U1-m17) — the screens no longer describe its location
 * in their body text. */
function makeRevealButton(): HTMLButtonElement {
  const revealBtn = makeButton(
    isWindows() ? 'Reveal backups in File Explorer' : 'Reveal backups in Finder',
  );
  let failure: HTMLDivElement | null = null;
  revealBtn.addEventListener('click', () => {
    // Lazy-import so this boot-error path has no static Tauri dependency.
    void (async () => {
      let mod: typeof import('@/lib/backup-restore') | null = null;
      try {
        mod = await import('@/lib/backup-restore');
        await mod.revealBackupsDir();
        failure?.remove();
        failure = null;
      } catch (err) {
        let where: string | null = null;
        try {
          if (mod !== null) where = await mod.backupsDirPath();
        } catch {
          // The path API is unavailable too (the browser shim): reason only.
        }
        failure?.remove();
        failure = document.createElement('div');
        failure.setAttribute('data-testid', 'boot-reveal-failure');
        const reason = makeParagraph(`Could not open the backups folder: ${messageOf(err)}`);
        reason.setAttribute('role', 'alert');
        reason.style.margin = '0 0 4px';
        failure.append(reason);
        if (where !== null) {
          const path = makeParagraph(`Backups folder: ${where}`);
          path.style.margin = '0 0 12px';
          path.style.wordBreak = 'break-all';
          failure.append(path);
        }
        revealBtn.after(failure);
      }
    })();
  });
  return revealBtn;
}

/** Click-only (CR-U-2): the opener plugin is imported on click, never at render. */
function makeReleasesButton(): HTMLButtonElement {
  const btn = makeButton('Open the releases page');
  btn.addEventListener('click', () => {
    void import('@tauri-apps/plugin-opener')
      .then(({ openUrl }) => openUrl(RELEASES_URL))
      .catch(() => {
        // Opener unavailable — the screen still reads correctly without it.
      });
  });
  return btn;
}

function makeReloadButton(reload: () => void): HTMLButtonElement {
  const btn = makeButton('Try again');
  btn.addEventListener('click', () => reload());
  return btn;
}

/** Every DB screen reads (and clears) a failed restore's reason at render. */
function appendFailureNotice(container: HTMLElement): void {
  const reason = takeRestoreFailureNotice();
  if (reason !== null) {
    // CR-U-15: the "not changed" claim only when db_restore put everything
    // back. U1-m16: one period after the reason, never two.
    const clause = withoutTrailingPeriod(reason);
    const notice = makeParagraph(
      restoreLeftDataUnchanged(reason)
        ? `The last restore did not finish: ${clause}. Your data was not changed.`
        : `The last restore did not finish: ${clause}.`,
    );
    notice.style.color = TEXT_COLOR;
    container.append(notice);
  }
}

interface RestoreSectionOptions {
  reveal: boolean;
  releases: boolean;
  reload: () => void;
  now: () => number;
  /** CR-U-18: which row's restore sets the one-boot update hold. Passed ONLY
   * from the failed-migration screen, for the copy its error names when that
   * copy is from before the update; every other screen and row: none. */
  holdFor?: (entry: BackupEntry) => boolean;
  /** U1F-m10: the row whose copy is known NOT to be from before the update
   * (the failed-migration screen's named partway copy) is labelled for what
   * it is; every other pre-update row keeps 'Before update'. */
  notBeforeUpdate?: (entry: BackupEntry) => boolean;
}

/** Shared by every row of one restore section. */
interface RestoreContext {
  section: HTMLElement;
  /** The whole screen: every button in it is disabled while a restore is in
   * flight (CR-U-10), not only the section's. */
  screen: HTMLElement;
  /** True from the confirm click until a 'Restore did not start' rejection. */
  state: { restoring: boolean };
  /** The polite live region that announces an armed row (U1-m11). */
  status: HTMLElement;
  reload: () => void;
  now: () => number;
  /** Disarm callbacks of the currently armed rows (at most one, CR-U-9). */
  armed: Set<() => void>;
  holdFor: (entry: BackupEntry) => boolean;
  notBeforeUpdate: (entry: BackupEntry) => boolean;
}

/**
 * The shared restore section: a title, a lead, the list (filled
 * asynchronously), then the optional reveal and releases buttons. Inert while
 * `isExploreMode()` (D-U1-20): nothing rendered, nothing imported.
 */
function appendRestoreSection(container: HTMLElement, opts: RestoreSectionOptions): void {
  if (isExploreMode()) return;

  const section = document.createElement('div');
  section.setAttribute('data-testid', 'boot-restore-section');
  section.style.color = TEXT_COLOR;

  const title = makeParagraph('Restore a copy');
  title.style.fontWeight = '600';
  title.style.marginTop = '16px';
  const lead = makeParagraph(
    'Cairn checks the file, then replaces your current data with it and reloads.',
  );

  const list = document.createElement('ul');
  list.setAttribute('data-testid', 'boot-restore-list');
  // listStyle none strips list semantics in WebKit (VoiceOver); keep them.
  list.setAttribute('role', 'list');
  list.style.listStyle = 'none';
  list.style.padding = '0';

  const status = document.createElement('p');
  status.setAttribute('data-testid', 'boot-restore-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.style.margin = '0';
  status.style.lineHeight = '1.5';

  section.append(title, lead, list, status);
  if (opts.reveal) section.append(makeRevealButton());
  if (opts.releases) section.append(makeReleasesButton());
  container.append(section);

  const ctx: RestoreContext = {
    section,
    screen: container,
    state: { restoring: false },
    status,
    reload: opts.reload,
    now: opts.now,
    armed: new Set(),
    holdFor: opts.holdFor ?? (() => false),
    notBeforeUpdate: opts.notBeforeUpdate ?? (() => false),
  };
  void hydrateRestoreList(list, ctx);
}

/** U1F-m14: Blink and WebKit move focus to <body> when the focused button is
 * disabled; bring it back to `el` when that happened. */
function focusIfLost(el: HTMLElement): void {
  const active = document.activeElement;
  if (active === null || active === document.body) el.focus();
}

function setButtonsDisabled(scope: HTMLElement, disabled: boolean): void {
  for (const b of scope.querySelectorAll('button')) b.disabled = disabled;
}

/**
 * TOTAL by construction (PR-16): the whole body sits in one try/catch, so a
 * listing rejection, a non-array result or a throw while building rows all
 * end as the read-failure line — never an unhandled rejection.
 */
async function hydrateRestoreList(list: HTMLUListElement, ctx: RestoreContext): Promise<void> {
  try {
    const { listBackups } = await import('@/lib/backup-restore');
    const entries: unknown = await listBackups();
    if (Array.isArray(entries) === false) throw new Error('unexpected backups listing');
    const all = entries as BackupEntry[];
    if (all.length === 0) {
      list.replaceWith(makeParagraph('No backups were found in the backups folder.'));
      return;
    }
    // Pre-update copies first (a stable partition), then manual backups;
    // listBackups already returns each newest-first.
    const ordered = [
      ...all.filter((b) => b.kind === 'pre-update'),
      ...all.filter((b) => b.kind !== 'pre-update'),
    ];
    const rows = ordered.map((entry) => makeRestoreRow(entry, ctx));
    list.append(...rows);
  } catch (err) {
    list.replaceWith(makeParagraph(`Could not read your backups: ${messageOf(err)}`));
  }
}

/**
 * One row: the label, a Restore button, and an alert slot created on demand.
 * Two-step confirm (critic c): click 1 validates (an invalid file shows the
 * validator's reason and never arms); a valid file re-labels the button, adds
 * Cancel, moves focus to Cancel and announces the armed state; click 2
 * disables EVERY button on the screen (CR-U-10) and restores (the restore
 * reloads on its way out). Only a restore that rejects before the swap
 * reports it and re-enables the screen.
 *
 * CR-U-9 (U1-M3/M4): the validation round trip is shorter than a human
 * double-click, so the armed branch ignores the second click of a
 * double-click (`detail > 1`; keyboard activation has detail 0) and any click
 * within ARM_GUARD_MS of arming. Arming one row disarms any other.
 */
function makeRestoreRow(entry: BackupEntry, ctx: RestoreContext): HTMLLIElement {
  const when = entry.takenAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const preUpdate = entry.kind === 'pre-update';
  // U1F-m10: never call a copy 'from before the update' unless it is one.
  const partway = preUpdate && ctx.notBeforeUpdate(entry);

  const row = document.createElement('li');
  row.setAttribute('data-testid', 'boot-restore-row');
  row.style.display = 'flex';
  row.style.flexWrap = 'wrap';
  row.style.alignItems = 'center';
  row.style.gap = '8px';
  row.style.padding = '6px 0';
  row.style.borderBottom = '1px solid #e5e7eb';

  const label = document.createElement('span');
  label.style.marginRight = '8px';
  label.textContent = partway
    ? `Saved before this attempt — ${when}`
    : preUpdate
      ? `Before update — ${when}`
      : when;

  // The accessible name names the backup (mirrors DataSection, CR-U1-28);
  // the visible label stays the short 'Restore'.
  const restoreName = partway
    ? `Restore the copy saved before this attempt, ${when}`
    : preUpdate
      ? `Restore the copy from before the update, ${when}`
      : `Restore backup from ${when}`;
  const restoreBtn = makeButton('Restore');
  restoreBtn.style.marginBottom = '0';
  restoreBtn.setAttribute('aria-label', restoreName);
  row.append(label, restoreBtn);

  let alertEl: HTMLParagraphElement | null = null;
  const setAlert = (text: string | null): void => {
    if (text === null) {
      alertEl?.remove();
      alertEl = null;
      return;
    }
    if (alertEl === null) {
      alertEl = document.createElement('p');
      alertEl.setAttribute('role', 'alert');
      alertEl.style.flexBasis = '100%';
      alertEl.style.margin = '4px 0 0';
      alertEl.style.color = '#b91c1c';
      row.append(alertEl);
    }
    alertEl.textContent = text;
  };

  let armed = false;
  let armedAt = 0;
  // U1F-m16: a dropped multi-click is announced once per arm.
  let multiClickNoted = false;
  let cancel: HTMLButtonElement | null = null;
  const disarm = (): void => {
    const hadFocus = cancel !== null && document.activeElement === cancel;
    armed = false;
    ctx.armed.delete(disarm);
    restoreBtn.textContent = 'Restore';
    restoreBtn.setAttribute('aria-label', restoreName);
    if (hadFocus) restoreBtn.focus();
    cancel?.remove();
    cancel = null;
    ctx.status.textContent = '';
  };

  row.addEventListener('keydown', (ev) => {
    if (armed && !ctx.state.restoring && ev.key === 'Escape') disarm();
  });

  restoreBtn.addEventListener('click', (ev) => {
    void (async () => {
      // CR-U-10: nothing on the screen acts while a restore is in flight.
      if (ctx.state.restoring) return;
      if (!armed) {
        setAlert(null);
        setButtonsDisabled(row, true);
        try {
          const { validateBackupFile } = await import('@/lib/backup-restore');
          const v = await validateBackupFile(entry.path);
          // A restore started on another row while this one validated: stay
          // disabled and never arm (the restore reloads the page).
          if (ctx.state.restoring) return;
          if (!v.ok) {
            setAlert(v.reason ?? 'That file is not a valid Cairn backup.');
            return;
          }
          for (const other of [...ctx.armed]) other();
          armed = true;
          armedAt = ctx.now();
          multiClickNoted = false;
          ctx.armed.add(disarm);
          restoreBtn.textContent = 'Confirm restore — replaces your current data';
          restoreBtn.removeAttribute('aria-label');
          const cancelBtn = makeButton('Cancel');
          cancelBtn.style.marginBottom = '0';
          cancelBtn.addEventListener('click', disarm);
          restoreBtn.after(cancelBtn);
          cancel = cancelBtn;
          const subject = partway
            ? `the copy saved before this attempt, ${when}`
            : preUpdate
              ? `the copy from before the update, ${when}`
              : `the backup from ${when}`;
          ctx.status.textContent =
            `Ready to restore ${subject}. Confirm restore replaces your current data; Cancel keeps it.`;
        } catch (err) {
          setAlert(`Could not read that file: ${messageOf(err)}`);
        } finally {
          if (!ctx.state.restoring) {
            setButtonsDisabled(row, false);
            // After the re-enable: a disabled button cannot take focus. An
            // alert (invalid file, a validate error) leaves focus on the row's
            // Restore (U1F-m14); the alert itself is announced (role=alert).
            if (armed) cancel?.focus();
            else focusIfLost(restoreBtn);
          }
        }
        return;
      }
      // CR-U-9: never the second click of a double-click, never inside the
      // arm window. U1F-m16/CR-U-23b: a slow double-click setting can turn a
      // deliberate click into detail 2 — the multi-click drop is bounded to
      // MULTI_CLICK_WINDOW_MS, and the first drop says once what to do.
      if (ev.detail > 1 && ctx.now() - armedAt < MULTI_CLICK_WINDOW_MS) {
        if (!multiClickNoted) {
          multiClickNoted = true;
          ctx.status.textContent = 'Confirm restore is ready — select it once more to replace your data.';
        }
        return;
      }
      if (ctx.now() - armedAt < ARM_GUARD_MS) return;
      ctx.state.restoring = true;
      setButtonsDisabled(ctx.screen, true);
      // CR-U-23f: the row is no longer armed — say nothing stale meanwhile.
      ctx.status.textContent = '';
      try {
        const { restoreFromBackup } = await import('@/lib/backup-restore');
        // Boot path: the pool may never have been loaded (the generic screen),
        // so the exact not-loaded close rejection is tolerated. Reloads on its
        // way out once the swap has been attempted.
        // CR-U-14/18: putting back THE copy a failed update names (when it is
        // from before the update) holds that update for the next boot — set
        // only once the swap succeeded. Nothing else holds.
        await restoreFromBackup(entry.path, {
          tolerateNotLoaded: true,
          reload: ctx.reload,
          onRestored: ctx.holdFor(entry) ? setUpdateHold : undefined,
        });
      } catch (err) {
        // The only path that re-enables the screen (CR-U-10).
        ctx.state.restoring = false;
        setAlert(`Restore did not start: ${messageOf(err)}`);
        setButtonsDisabled(ctx.screen, false);
        disarm();
        focusIfLost(restoreBtn); // U1F-m14
      }
    })();
  });

  return row;
}

/** The file's basename, for either path separator. */
function basename(p: string): string {
  return p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1);
}

export function renderBootError(
  root: HTMLElement,
  e: unknown,
  opts: BootScreenOptions = {},
): void {
  const reload = opts.reload ?? (() => window.location.reload());
  const now = opts.now ?? (() => performance.now());
  const name = e instanceof Error ? e.name : '';
  const message = e instanceof Error ? e.message : String(e);

  // A SAMPLE boot failed (critic b). The real profile was never opened, so
  // nothing of it is listed, revealed or restored here. init.ts already
  // cleared the explore flag, so the reload opens the REAL profile — the
  // button says so (U1-m19).
  if (name === 'ExploreBootError') {
    const container = makeContainer();
    const openOwn = makeButton('Open your own profile');
    openOwn.addEventListener('click', () => reload());
    container.append(
      makeHeading('Sample data could not open'),
      makeParagraph(
        'Your own data was not opened and was not changed. Cairn opens your own profile next time.',
      ),
      makePre(message),
      openOwn,
    );
    root.replaceChildren(container);
    return;
  }

  // CR-U-1: the pre-update copy could not be written. Nothing was migrated;
  // the choice is Try again, Continue without a copy (one boot), Reveal.
  if (name === 'PreUpdateCopyError') {
    const container = makeContainer();
    const reason = (e as { reason?: unknown }).reason;
    const continueBtn = makeButton('Continue without a copy');
    continueBtn.addEventListener('click', () => {
      setSkipOnce();
      reload();
    });
    container.append(
      makeHeading("Cairn couldn't save a copy of your data before updating it"),
      makeParagraph('Your data was not changed.'),
      makePre(typeof reason === 'string' ? reason : message),
      makeReloadButton(reload),
      continueBtn,
      makeRevealButton(),
    );
    appendFailureNotice(container);
    root.replaceChildren(container);
    return;
  }

  // CR-U-14 (U1-m8): the boot after a restore of a pre-update copy. Nothing
  // was migrated; the choice is the previous version, a retry, or the folder.
  if (name === 'UpdateHeldError') {
    const container = makeContainer();
    const retry = makeButton('Try the update again');
    retry.addEventListener('click', () => {
      clearUpdateHold();
      reload();
    });
    container.append(
      makeHeading('Cairn put back your data from before the update'),
      makeParagraph(
        'The update was not run, so your data is the way it was before the update. To keep using Cairn now, install the previous version from the releases page.',
      ),
      makeReleasesButton(),
      retry,
      makeRevealButton(),
    );
    root.replaceChildren(container);
    return;
  }

  if (name === 'SchemaTooNewError') {
    const container = makeContainer();
    container.append(
      makeHeading('Update Cairn to open this data'),
      makeParagraph(message),
      makeParagraph('A copy from before an update does not include anything entered after it.'),
      makeParagraph('Restoring a copy replaces the data in this newer file; Cairn does not keep it.'),
    );
    appendFailureNotice(container);
    appendRestoreSection(container, { reveal: true, releases: true, reload, now });
    root.replaceChildren(container);
    return;
  }

  if (name === 'DatabaseCorruptError') {
    const container = makeContainer();
    const heading = makeHeading('Your database may be corrupt');
    heading.style.color = ERROR_COLOR;
    container.append(
      heading,
      makeParagraph(
        'Cairn could not open your data safely. You can restore one of your backups below, or open the backups folder.',
      ),
      makeRevealButton(), // the FIRST button on this screen (pinned)
    );
    appendFailureNotice(container);
    appendRestoreSection(container, { reveal: false, releases: false, reload, now });
    container.append(makePre(message));
    root.replaceChildren(container);
    return;
  }

  if (name === 'MigrationFailedError') {
    const container = makeContainer();
    const copyPath = (e as { preUpdateCopyPath?: unknown }).preUpdateCopyPath;
    // U1-m9: 'from before the update' only when the copy's `from` is the
    // chain origin; a copy of a file an earlier attempt changed partway is
    // named for what it is.
    const fromBeforeUpdate = (e as { copyIsFromBeforeUpdate?: unknown }).copyIsFromBeforeUpdate !== false;
    const chainOrigin = (e as { chainOrigin?: unknown }).chainOrigin;
    const body =
      typeof copyPath === 'string' && copyPath.length > 0
        ? fromBeforeUpdate
          ? `The update stopped partway. A copy of your data from before the update was saved: ${basename(copyPath)}. ` +
            'Restoring it puts your data back the way it was, and the next screen lets you choose whether to run the update again. ' +
            'To use that data without the update, the previous version of Cairn is on the releases page.'
          : `The update stopped partway. A copy of your data was saved before this attempt: ${basename(copyPath)}. ` +
            'An earlier attempt had already changed part of your data, so this copy is not from before the update.'
        : 'The update stopped partway. No copy was saved before it started.';
    // The cause's stack points at the failing migration; fall back to ours.
    const cause = (e as { cause?: unknown }).cause;
    // U1F-m18: a non-Error cause (Tauri rejects with a plain string) falls
    // back to this error's own stack, whose V8 header line repeats the
    // heading ('MigrationFailedError: Cairn could not finish …') — drop it.
    const ownStack = (e as Error).stack ?? '';
    const ownHeader = `${name}: ${message}`;
    const stack =
      cause instanceof Error && cause.stack
        ? cause.stack
        : ownStack.startsWith(ownHeader)
          ? ownStack.slice(ownHeader.length).replace(/^\n/, '')
          : ownStack;
    // U1-m18: the cause's own message — `message` repeats the heading.
    const causeMessage = cause === undefined ? message : messageOf(cause);
    container.append(
      makeHeading("Cairn couldn't finish updating your data"),
      makeParagraph(body),
      makePre(causeMessage + '\n\n' + stack),
      makeReloadButton(reload), // the FIRST button on this screen
    );
    appendFailureNotice(container);
    appendRestoreSection(container, {
      reveal: true,
      releases: true,
      reload,
      now,
      // CR-U-18: only this screen holds, and only for the named true copy.
      holdFor: (entry) => fromBeforeUpdate && typeof copyPath === 'string' && entry.path === copyPath,
      // U1F-m10 / CR-U-23a: the named copy when it is a partway one, and
      // EVERY family copy whose `from` is not the chain's origin, is
      // labelled for what it is.
      notBeforeUpdate: (entry) =>
        (!fromBeforeUpdate && typeof copyPath === 'string' && entry.path === copyPath) ||
        (typeof chainOrigin === 'number' && typeof entry.schemaFrom === 'number' && entry.schemaFrom !== chainOrigin),
    });
    root.replaceChildren(container);
    return;
  }

  // A DATABASE failure the real-profile boot threw without a typed name of
  // its own (CR-U-12): the generic heading, the cause's message + stack, then
  // the restore list.
  if (name === 'DatabaseInitError') {
    const container = makeContainer(ERROR_COLOR);
    const cause = (e as { cause?: unknown }).cause;
    const pre = makePre(
      cause instanceof Error
        ? cause.message + '\n\n' + cause.stack
        : message + '\n\n' + (e as Error).stack,
    );
    pre.style.fontSize = '';
    // CR-U-13 (U1-m15): transient failures land here (a lock, a full disk),
    // so the non-destructive retry comes first.
    container.append(makeHeading('Database initialization failed'), pre, makeReloadButton(reload));
    appendFailureNotice(container);
    appendRestoreSection(container, { reveal: true, releases: false, reload, now });
    root.replaceChildren(container);
    return;
  }

  // Generic fallback — the 1.7.0 screen: original message + stack pane, and
  // nothing destructive. Not a database failure (a lazy App import, a theme
  // module, …), so no restore list and no notice read (U1-m33).
  const container = makeContainer(ERROR_COLOR);
  const pre = makePre(e instanceof Error ? message + '\n\n' + e.stack : String(e));
  pre.style.fontSize = '';
  container.append(makeHeading('Database initialization failed'), pre);
  root.replaceChildren(container);
}
