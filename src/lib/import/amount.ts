/**
 * Wave-9 S78: locale-tolerant CSV amount parsing. The old helper deleted
 * commas/spaces unconditionally, so European exports corrupted silently
 * ("1.234,56" → 1.23456; "1 234,56" → 123456). Semantics (Decision 11):
 *  - both '.' and ',' present → the LAST separator is the decimal point;
 *  - ',' only → a 1–2 digit tail is a decimal comma; exact 3-digit groups
 *    are US thousands; anything else is rejected (null);
 *  - '.' only → US decimal, EXCEPT repeated exact-3-digit groups
 *    ("1.234.567"), which read as EU thousands. A single "1.234" stays a US
 *    decimal — indistinguishable, and US is this app's home convention;
 *  - "(…)" and leading '-' negate; currency symbols and all space-class
 *    grouping (incl. NBSP/thin space) are stripped.
 * Returns null for anything ambiguous or non-numeric — the validator turns
 * null into a row error instead of a silently-wrong number.
 */
export function parseImportAmount(raw: string): number | null {
  let v = raw.trim();
  if (v === '') return null;
  const parens = v.startsWith('(') && v.endsWith(')');
  if (parens) v = v.slice(1, -1).trim();
  let negative = parens;
  if (v.startsWith('-')) {
    negative = true;
    v = v.slice(1);
  } else if (v.startsWith('+')) {
    v = v.slice(1);
  }
  // NBSP (\u00A0) and narrow no-break space (\u202F) are written as unicode
  // escapes so the intent survives editors; \s covers the rest.
  v = v.replace(/[$\u20AC\u00A3\s\u00A0\u202F]/g, '');
  const lastComma = v.lastIndexOf(',');
  const lastDot = v.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) {
      // EU shape "1.234,56": dots are grouping, the (single) comma is decimal.
      v = v.replace(/\./g, '');
      if (v.indexOf(',') !== v.lastIndexOf(',')) return null; // two commas after dot-strip: ambiguous
      v = v.replace(',', '.');
    } else {
      // US shape "1,234.56": commas are grouping.
      v = v.replace(/,/g, '');
    }
  } else if (lastComma !== -1) {
    const parts = v.split(',');
    if (parts.length > 1 && parts.slice(1).every((p) => p.length === 3)) v = parts.join('');
    else if (parts.length === 2 && parts[1].length >= 1 && parts[1].length <= 2)
      v = `${parts[0]}.${parts[1]}`;
    else return null;
  } else if (lastDot !== -1) {
    const parts = v.split('.');
    if (parts.length > 2) {
      if (parts.slice(1).every((p) => p.length === 3)) v = parts.join('');
      else return null;
    }
  }
  if (!/^\d+(\.\d+)?$|^\.\d+$/.test(v)) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}
