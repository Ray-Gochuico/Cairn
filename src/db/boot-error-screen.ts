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
 *   - `ExploreBootError` (v1.7.1 U2): the SAMPLE data could not open → Try
 *     again only. The real profile's backups are never listed on it.
 * Anything else falls back to the original message + stack pane, now with the
 * restore list too.
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
import { setSkipOnce, takeRestoreFailureNotice } from '@/lib/boot-notices';
import { RELEASES_URL } from '@/lib/releases-url';
import { isExploreMode } from '@/lib/explore-mode';

type BackupEntry = import('@/lib/backup-restore').BackupEntry;

export interface BootScreenOptions {
  /** Injectable for tests; defaults to `window.location.reload()`. */
  reload?: () => void;
}

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

/** The existing reveal button, verbatim in behaviour: label by platform, a
 * lazy `revealBackupsDir` so this boot path has no static Tauri dependency. */
function makeRevealButton(): HTMLButtonElement {
  const revealBtn = makeButton(
    isWindows() ? 'Reveal backups in File Explorer' : 'Reveal backups in Finder',
  );
  revealBtn.addEventListener('click', () => {
    // Lazy-import so this boot-error path has no static Tauri dependency.
    void (async () => {
      try {
        const { revealBackupsDir } = await import('@/lib/backup-restore');
        await revealBackupsDir();
      } catch {
        // Browser/dev or opener unavailable — nothing more we can do; the
        // folder location is described in the body text above.
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
    const notice = makeParagraph(
      `The last restore did not finish: ${reason}. Your data was not changed.`,
    );
    notice.style.color = TEXT_COLOR;
    container.append(notice);
  }
}

interface RestoreSectionOptions {
  reveal: boolean;
  releases: boolean;
  reload: () => void;
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
  list.style.listStyle = 'none';
  list.style.padding = '0';

  section.append(title, lead, list);
  if (opts.reveal) section.append(makeRevealButton());
  if (opts.releases) section.append(makeReleasesButton());
  container.append(section);

  void hydrateRestoreList(list, section, opts.reload);
}

function setButtonsDisabled(scope: HTMLElement, disabled: boolean): void {
  for (const b of scope.querySelectorAll('button')) b.disabled = disabled;
}

/**
 * TOTAL by construction (PR-16): the whole body sits in one try/catch, so a
 * listing rejection, a non-array result or a throw while building rows all
 * end as the read-failure line — never an unhandled rejection.
 */
async function hydrateRestoreList(
  list: HTMLUListElement,
  section: HTMLElement,
  reload: () => void,
): Promise<void> {
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
    const rows = ordered.map((entry) => makeRestoreRow(entry, section, reload));
    list.append(...rows);
  } catch (err) {
    list.replaceWith(makeParagraph(`Could not read your backups: ${messageOf(err)}`));
  }
}

/**
 * One row: the label, a Restore button, and an alert slot created on demand.
 * Two-step confirm (critic c): click 1 validates (an invalid file shows the
 * validator's reason and never arms); a valid file re-labels the button and
 * adds Cancel; click 2 disables the whole section and restores (the restore
 * reloads on its way out). A restore that rejects before the swap reports it
 * and re-enables the controls.
 */
function makeRestoreRow(
  entry: BackupEntry,
  section: HTMLElement,
  reload: () => void,
): HTMLLIElement {
  const when = entry.takenAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

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
  label.textContent = entry.kind === 'pre-update' ? `Before update — ${when}` : when;

  const restoreBtn = makeButton('Restore');
  restoreBtn.style.marginBottom = '0';
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
  let cancel: HTMLButtonElement | null = null;
  const disarm = (): void => {
    armed = false;
    restoreBtn.textContent = 'Restore';
    cancel?.remove();
    cancel = null;
  };

  restoreBtn.addEventListener('click', () => {
    void (async () => {
      if (!armed) {
        setAlert(null);
        setButtonsDisabled(row, true);
        try {
          const { validateBackupFile } = await import('@/lib/backup-restore');
          const v = await validateBackupFile(entry.path);
          if (!v.ok) {
            setAlert(v.reason ?? 'That file is not a valid Cairn backup.');
            return;
          }
          armed = true;
          restoreBtn.textContent = 'Confirm restore — replaces your current data';
          const cancelBtn = makeButton('Cancel');
          cancelBtn.style.marginBottom = '0';
          cancelBtn.addEventListener('click', disarm);
          restoreBtn.after(cancelBtn);
          cancel = cancelBtn;
        } catch (err) {
          setAlert(`Could not read that file: ${messageOf(err)}`);
        } finally {
          setButtonsDisabled(row, false);
        }
        return;
      }
      setButtonsDisabled(section, true);
      try {
        const { restoreFromBackup } = await import('@/lib/backup-restore');
        // Boot path: the pool may never have been loaded (the generic screen),
        // so the exact not-loaded close rejection is tolerated. Reloads on its
        // way out once the swap has been attempted.
        await restoreFromBackup(entry.path, { tolerateNotLoaded: true, reload });
      } catch (err) {
        setAlert(`Restore did not start: ${messageOf(err)}`);
        setButtonsDisabled(section, false);
        disarm();
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
  const name = e instanceof Error ? e.name : '';
  const message = e instanceof Error ? e.message : String(e);

  // A SAMPLE boot failed (critic b). The real profile was never opened, so
  // nothing of it is listed, revealed or restored here.
  if (name === 'ExploreBootError') {
    const container = makeContainer();
    container.append(
      makeHeading('Sample data could not open'),
      makeParagraph(
        'Your own data was not opened and was not changed. Cairn opens your own profile next time.',
      ),
      makePre(message),
      makeReloadButton(reload),
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

  if (name === 'SchemaTooNewError') {
    const container = makeContainer();
    container.append(
      makeHeading('Update Cairn to open this data'),
      makeParagraph(message),
      makeParagraph('A copy from before an update does not include anything entered after it.'),
      makeParagraph('Restoring a copy replaces the data in this newer file; Cairn does not keep it.'),
    );
    appendFailureNotice(container);
    appendRestoreSection(container, { reveal: true, releases: true, reload });
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
    appendRestoreSection(container, { reveal: false, releases: false, reload });
    container.append(makePre(message));
    root.replaceChildren(container);
    return;
  }

  if (name === 'MigrationFailedError') {
    const container = makeContainer();
    const copyPath = (e as { preUpdateCopyPath?: unknown }).preUpdateCopyPath;
    const body =
      typeof copyPath === 'string' && copyPath.length > 0
        ? `The update stopped partway. A copy of your data from before the update was saved: ${basename(copyPath)}. ` +
          'Restoring it puts your data back the way it was; Cairn tries the update again when it opens. ' +
          'To use that data without the update, the previous version of Cairn is on the releases page.'
        : 'The update stopped partway. No copy was saved before it started.';
    // The cause's stack points at the failing migration; fall back to ours.
    const cause = (e as { cause?: unknown }).cause;
    const stack = cause instanceof Error && cause.stack ? cause.stack : (e as Error).stack;
    container.append(
      makeHeading("Cairn couldn't finish updating your data"),
      makeParagraph(body),
      makePre(message + '\n\n' + stack),
      makeReloadButton(reload), // the FIRST button on this screen
    );
    appendFailureNotice(container);
    appendRestoreSection(container, { reveal: true, releases: true, reload });
    root.replaceChildren(container);
    return;
  }

  // Generic fallback — original message + stack pane, then the restore list.
  const container = makeContainer(ERROR_COLOR);
  const pre = makePre(e instanceof Error ? message + '\n\n' + e.stack : String(e));
  pre.style.fontSize = '';
  container.append(makeHeading('Database initialization failed'), pre);
  appendFailureNotice(container);
  appendRestoreSection(container, { reveal: true, releases: false, reload });
  root.replaceChildren(container);
}
