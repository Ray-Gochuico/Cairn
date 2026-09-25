/**
 * Boot error tags (v1.7.1 U1, code-review round CR-U-12). Tauri-free and
 * import-free: the pre-React boot-error screen matches these by NAME (never
 * `instanceof`), and tests construct them directly.
 *
 * `DatabaseInitError` marks a failure that initDatabase's REAL-profile branch
 * threw without a typed name of its own (a load failure, a runner failure
 * with nothing pending, …). Only such a failure — or one of the typed boot
 * errors — gets the database screens with the restore list. Any other
 * rejection that reaches main.tsx's catch (a lazy App import, a theme module)
 * is not a database failure and gets the 1.7.0 generic screen, with nothing
 * destructive on it (U1-m33).
 */
export class DatabaseInitError extends Error {
  readonly cause: unknown;
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'DatabaseInitError';
    this.cause = cause;
    Object.setPrototypeOf(this, DatabaseInitError.prototype);
  }
}

/**
 * CR-U-14 (U1-m8): thrown by the pre-update gate on the one boot after a
 * boot-screen restore of a pre-update copy, INSTEAD of migrating — the
 * restored file is the data from before the update, and re-running the same
 * update at once would undo the restore. The boot screen renders the calm
 * hold screen for it. Nothing was migrated and no copy was taken.
 */
export class UpdateHeldError extends Error {
  constructor() {
    super('Cairn held the update for this launch after putting back the copy from before it.');
    this.name = 'UpdateHeldError';
    Object.setPrototypeOf(this, UpdateHeldError.prototype);
  }
}

/** The typed errors initDatabase's real branch already throws by name; each
 * has its own screen, so none is re-tagged. */
const TYPED_DATABASE_BOOT_ERRORS: ReadonlySet<string> = new Set([
  'DatabaseCorruptError',
  'SchemaTooNewError',
  'PreUpdateCopyError',
  'MigrationFailedError',
  'DatabaseInitError',
  'UpdateHeldError',
]);

/** Tag a real-profile database boot failure; typed errors pass through. */
export function tagDatabaseInitError(e: unknown): Error {
  if (e instanceof Error && TYPED_DATABASE_BOOT_ERRORS.has(e.name)) return e;
  return new DatabaseInitError(e);
}
