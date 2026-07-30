/**
 * CSV core for the per-page "Export CSV" buttons.
 *
 * `toCsv` is pure and generic: it takes the rows and a column map and
 * produces an RFC-4180-escaped CSV string. `downloadCsv` is the only
 * impure part — runtime-aware save (native dialog in Tauri, Blob +
 * temporary-anchor download in a browser). It is kept separate from the
 * JSON export's download helper so this increment does not depend on the
 * Settings "Data" section.
 */

import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import { isTauriRuntime } from './tauri-runtime';

/** One CSV column: a header label and a pure cell extractor. */
export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | boolean | null;
}

/**
 * Spreadsheet formula-injection guard (OWASP "CSV injection"): a field whose
 * first character is '=', '+', '-', '@', TAB, or CR is interpreted as a
 * formula by Excel / Google Sheets / Numbers on open. Prefix a single quote
 * so it renders as literal text.
 *
 * Plain numbers are EXEMPT: numeric columns (amounts, balances, rates) export
 * `number` values that stringify like "-123.45" — a leading minus on a real
 * number is not executable, and guarding it would corrupt the column for
 * re-import and spreadsheet arithmetic. Exponent forms are included because
 * String(-1e21) is "-1e+21".
 */
// \n \v \f: spreadsheet engines strip these too before formula detection (round-3).
const FORMULA_LEAD = /^[=+\-@\t\r\n\v\f]/;
const PLAIN_NUMBER = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

function guardFormulaInjection(value: string): string {
  if (FORMULA_LEAD.test(value) && !PLAIN_NUMBER.test(value)) {
    return `'${value}`;
  }
  return value;
}

/**
 * RFC-4180 escaping: a field containing a comma, a double-quote, or a
 * newline is wrapped in double-quotes, with embedded double-quotes doubled.
 * Runs AFTER the formula-injection guard so the guarded text is what gets
 * quoted.
 */
function escapeCsvField(value: string): string {
  const guarded = guardFormulaInjection(value);
  if (/[",\n]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

/** `null` → empty cell; numbers and booleans stringify plainly. */
function cellToString(value: string | number | boolean | null): string {
  return value === null ? '' : String(value);
}

/**
 * Serialize `rows` to a CSV string: a header line built from the column
 * headers, then one line per row. Lines are joined with `\n` (accepted by
 * Excel, Numbers, and Google Sheets). An empty `rows` yields the header
 * line alone.
 */
export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((c) => escapeCsvField(c.header)).join(',');
  const lines = rows.map((row) =>
    columns.map((c) => escapeCsvField(cellToString(c.value(row)))).join(','),
  );
  return [header, ...lines].join('\n');
}

/**
 * Save `text` as `filename`, per runtime.
 *
 * In the Tauri app: native save dialog (plugin-dialog `save`) then
 * plugin-fs `writeFile`. This is the same shape as the working backup
 * "Save a copy…" flow, and it MUST be `writeFile` (bytes), not
 * `writeTextFile` — the granted `fs:allow-write-file` capability does not
 * permit the `write_text_file` command, and the fs capability ratchet
 * (tests/policy/capabilities-policy.test.ts) is frozen. Cancelling the
 * dialog is a clean no-op.
 *
 * In a plain browser (dev:browser / e2e): Blob + temporary anchor; the
 * object URL is revoked immediately after the synthetic click. The anchor
 * pattern does NOT work in the Tauri WKWebView — it has no download
 * manager and no download handler is registered, so wry silently cancels
 * the navigation (the pre-W19 bug: every Export CSV was a no-op in the
 * installed app).
 */
export async function downloadCsv(filename: string, text: string): Promise<void> {
  if (isTauriRuntime()) {
    const dest = await save({
      defaultPath: filename,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (dest === null) return; // user cancelled
    await writeFile(dest, new TextEncoder().encode(text));
    return;
  }
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
