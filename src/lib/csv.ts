/**
 * CSV core for the per-page "Export CSV" buttons.
 *
 * `toCsv` is pure and generic: it takes the rows and a column map and
 * produces an RFC-4180-escaped CSV string. `downloadCsv` is the only
 * impure part — a thin Blob + temporary-anchor download. It is kept
 * separate from the JSON export's download helper so this increment does
 * not depend on the Settings "Data" section.
 */

/** One CSV column: a header label and a pure cell extractor. */
export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | boolean | null;
}

/**
 * RFC-4180 escaping: a field containing a comma, a double-quote, or a
 * newline is wrapped in double-quotes, with embedded double-quotes doubled.
 */
function escapeCsvField(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
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
 * Trigger a browser download of `text` as `filename`. Uses a Blob + a
 * temporary anchor; the object URL is revoked immediately after the
 * synthetic click. Works in both the Tauri WebView and a plain browser.
 */
export function downloadCsv(filename: string, text: string): void {
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
