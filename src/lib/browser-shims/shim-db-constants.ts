/**
 * Shared constants for the browser-shim IndexedDB persistence layer.
 * Hoisted (W4) so the sql shim (plugin-sql.ts) and the sample-DB reset
 * (src/db/sample-reset.ts) can never drift on the IDB identity or the
 * URL→record-key mapping.
 */
export const SHIM_IDB_NAME = 'finance-app-shim';
export const SHIM_IDB_STORE = 'sqlite';

/** `sqlite:finance.db` → `finance.db` — the shim's record key for a DB URL. */
export function shimKeyForDbUrl(url: string): string {
  return url.replace(/^sqlite:/, '');
}
