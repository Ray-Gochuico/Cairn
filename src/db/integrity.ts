import type { Database } from './db';

/**
 * Thrown on boot when the live database fails a `PRAGMA quick_check`. We treat
 * this as a recoverable situation, not a crash: `src/main.tsx` catches it and
 * renders a "your database may be corrupt — here are your backups" screen with
 * a reveal-backups affordance, instead of a raw stack trace. The user can then
 * restore from a backup taken before the corruption.
 */
export class DatabaseCorruptError extends Error {
  /** The raw quick_check output (first problem line), for diagnostics. */
  readonly detail: string;
  constructor(detail: string) {
    super(
      'Your database may be corrupt and could not be opened safely. ' +
        'You can recover by restoring from a backup. ' +
        `(integrity check reported: ${detail})`,
    );
    this.name = 'DatabaseCorruptError';
    this.detail = detail;
    Object.setPrototypeOf(this, DatabaseCorruptError.prototype);
  }
}

/**
 * Run `PRAGMA quick_check` and throw `DatabaseCorruptError` if it does not
 * report `ok`.
 *
 * `quick_check` is the fast cousin of `integrity_check`: it verifies page/cell
 * structure and index↔table consistency without the full (slow) cross-index
 * scan, so it's cheap enough to run on every boot. A healthy database returns a
 * single row whose value is the literal `ok`; any other output means the file
 * is damaged. We read only the first row's first column and compare
 * case-insensitively.
 *
 * Kept adapter-agnostic (typed against the `Database` interface) so it runs the
 * same in prod (TauriAdapter), the browser shim, and tests (SqliteAdapter).
 */
export async function assertDatabaseIntegrity(db: Database): Promise<void> {
  const rows = await db.select<Record<string, unknown>>('PRAGMA quick_check');
  const first = rows[0];
  // No rows at all is itself anomalous — treat as a failure with a clear note.
  const value =
    first == null ? '(no result)' : String(first.quick_check ?? Object.values(first)[0] ?? '');
  if (value.trim().toLowerCase() !== 'ok') {
    throw new DatabaseCorruptError(value.trim() || '(empty result)');
  }
}
