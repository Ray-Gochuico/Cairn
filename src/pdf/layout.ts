import type { PdfTextItem } from './types';

/** Concatenate page-1 strings — the haystack for issuer detection. */
export function firstPageText(items: PdfTextItem[]): string {
  return items
    .filter((i) => i.page === 1)
    .map((i) => i.str)
    .join(' ');
}

/**
 * Cluster text items into visual rows by y-proximity. Items within
 * `yTolerance` points of a row's anchor join it. Rows are returned
 * top-to-bottom, page-by-page; each row is sorted left-to-right.
 */
export function groupIntoRows(items: PdfTextItem[], yTolerance = 3): PdfTextItem[][] {
  const sorted = [...items].sort(
    (a, b) => a.page - b.page || a.y - b.y || a.x - b.x,
  );
  const rows: PdfTextItem[][] = [];
  for (const it of sorted) {
    const last = rows[rows.length - 1];
    const anchor = last?.[0];
    if (anchor && anchor.page === it.page && Math.abs(anchor.y - it.y) <= yTolerance) {
      last.push(it);
    } else {
      rows.push([it]);
    }
  }
  for (const row of rows) row.sort((a, b) => a.x - b.x);
  return rows;
}

/** Join a row's strings, collapsing whitespace. */
export function rowText(row: PdfTextItem[]): string {
  return row.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
}

const AMOUNT_RE = /^\(?-?\$?-?[\d,]+\.\d{2}-?\)?$/;

/**
 * Parse a currency token to a signed number. A leading/trailing minus or
 * surrounding parentheses mean negative (a credit/payment). Requires a
 * `.dd` cents suffix, so plain store numbers like "STORE123" return null.
 */
export function parseAmount(raw: string): number | null {
  const s = raw.trim();
  if (!AMOUNT_RE.test(s)) return null;
  const negative = /^\(.*\)$/.test(s) || s.includes('-');
  const digits = s.replace(/[^\d.]/g, '');
  const n = Number.parseFloat(digits);
  if (Number.isNaN(n)) return null;
  return negative ? -n : n;
}

/**
 * Strip trailing noise (phone numbers, long store ids, a trailing 2-letter
 * state code) from a raw merchant string and collapse whitespace. Never
 * returns empty — falls back to the trimmed raw input.
 */
export function cleanMerchant(raw: string): string {
  let s = raw.replace(/\s+/g, ' ').trim();
  s = s.replace(/\s+\d{3}[-.\s]?\d{3}[-.\s]?\d{4}$/, ''); // trailing phone
  s = s.replace(/\s+#?\d{5,}$/, ''); // trailing long store id
  s = s.replace(/\s+[A-Z]{2}$/, ''); // trailing 2-letter state code
  return s.trim() || raw.trim();
}

/**
 * Best-effort statement year for parsers whose date tokens omit the year
 * (e.g. Chase MM/DD). Reads page-1 text; falls back to the current year.
 */
export function inferStatementYear(items: PdfTextItem[]): number {
  const text = firstPageText(items);
  const full = text.match(/\b\d{1,2}\/\d{1,2}\/(\d{4}|\d{2})\b/);
  if (full) {
    const y = Number.parseInt(full[1], 10);
    return full[1].length === 2 ? 2000 + y : y;
  }
  const y4 = text.match(/\b(20\d{2})\b/);
  if (y4) return Number.parseInt(y4[1], 10);
  return new Date().getFullYear();
}
