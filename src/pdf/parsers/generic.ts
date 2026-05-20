import type { PdfTextItem, ParsedTransaction } from '../types';
import { inferStatementPeriod, resolveTransactionYear } from '../layout';
import { extractRowsByShape } from './shared';

/** Flexible: `M/D`, `M/D/YY`, or `M/D/YYYY`. */
const GENERIC_DATE = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/;

export function parseGeneric(items: PdfTextItem[]): ParsedTransaction[] {
  const period = inferStatementPeriod(items);
  return extractRowsByShape(items, {
    dateRe: GENERIC_DATE,
    toIso: (m) => {
      const mm = m[1].padStart(2, '0');
      const dd = m[2].padStart(2, '0');
      const yr = m[3]
        ? m[3].length === 2
          ? 2000 + Number(m[3])
          : Number(m[3])
        : resolveTransactionYear(Number(m[1]), period);
      return `${yr}-${mm}-${dd}`;
    },
  });
}
