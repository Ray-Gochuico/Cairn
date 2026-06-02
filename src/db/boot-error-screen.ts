/**
 * Friendly, recovery-oriented boot-error screens.
 *
 * Two DB boot failures get tailored, actionable guidance instead of a raw stack
 * trace:
 *   - `SchemaTooNewError` (H3): the DB is from a newer Cairn build → "update
 *     Cairn".
 *   - `DatabaseCorruptError` (M1): `PRAGMA quick_check` failed → "your database
 *     may be corrupt", with a button to reveal the backups folder so the user
 *     can restore.
 * Anything else falls back to the original message + stack pane.
 *
 * Built with `createElement` + `textContent` (never `innerHTML`): error messages
 * can carry user-controlled file paths and the CSP lacks `'unsafe-inline'` for
 * scripts. The typed errors are matched by `name` (not `instanceof`) so this
 * stays robust even if a class identity is duplicated across bundle chunks.
 *
 * Extracted from `main.tsx` (which auto-runs `bootstrap()` on import) so the
 * branching is unit-testable in isolation.
 */
export function renderBootError(root: HTMLElement, e: unknown): void {
  const name = e instanceof Error ? e.name : '';
  const message = e instanceof Error ? e.message : String(e);

  const container = document.createElement('div');
  container.style.padding = '24px';
  container.style.fontFamily = 'system-ui';
  container.style.maxWidth = '640px';

  if (name === 'SchemaTooNewError') {
    container.style.color = '#1f2937';
    const heading = document.createElement('h1');
    heading.textContent = 'Update Cairn to open this data';
    const body = document.createElement('p');
    body.style.lineHeight = '1.5';
    body.textContent = message;
    container.append(heading, body);
    root.replaceChildren(container);
    return;
  }

  if (name === 'DatabaseCorruptError') {
    container.style.color = '#1f2937';
    const heading = document.createElement('h1');
    heading.style.color = '#dc2626';
    heading.textContent = 'Your database may be corrupt';
    const body = document.createElement('p');
    body.style.lineHeight = '1.5';
    body.textContent =
      'Cairn could not open your data safely. If you have a backup, you can ' +
      'recover by replacing the database file with a recent backup. Your ' +
      'backups are in the “backups” folder next to your data.';
    const detail = document.createElement('pre');
    detail.style.background = '#f3f4f6';
    detail.style.padding = '12px';
    detail.style.borderRadius = '6px';
    detail.style.whiteSpace = 'pre-wrap';
    detail.style.fontSize = '12px';
    detail.textContent = message;

    const revealBtn = document.createElement('button');
    revealBtn.textContent = 'Reveal backups in Finder';
    revealBtn.style.padding = '8px 14px';
    revealBtn.style.borderRadius = '6px';
    revealBtn.style.border = '1px solid #d1d5db';
    revealBtn.style.cursor = 'pointer';
    revealBtn.style.marginBottom = '12px';
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

    container.append(heading, body, revealBtn, detail);
    root.replaceChildren(container);
    return;
  }

  // Generic fallback — original message + stack pane.
  container.style.color = '#dc2626';
  const heading = document.createElement('h1');
  heading.textContent = 'Database initialization failed';
  const pre = document.createElement('pre');
  pre.style.background = '#f3f4f6';
  pre.style.padding = '12px';
  pre.style.borderRadius = '6px';
  pre.style.whiteSpace = 'pre-wrap';
  pre.textContent = e instanceof Error ? message + '\n\n' + e.stack : String(e);
  container.append(heading, pre);
  root.replaceChildren(container);
}
