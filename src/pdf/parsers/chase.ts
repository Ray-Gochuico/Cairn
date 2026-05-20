import type { PdfTextItem, ParsedTransaction } from '../types';
import { inferStatementPeriod, resolveTransactionYear } from '../layout';
import { extractRowsByShape } from './shared';

/** Chase activity rows lead with an `MM/DD` date; the year is resolved
 *  per-transaction against the statement's closing month/year. */
const CHASE_DATE = /^(\d{2})\/(\d{2})$/;

export function parseChase(items: PdfTextItem[]): ParsedTransaction[] {
  const period = inferStatementPeriod(items);
  return extractRowsByShape(items, {
    dateRe: CHASE_DATE,
    toIso: (m) => `${resolveTransactionYear(Number(m[1]), period)}-${m[1]}-${m[2]}`,
  });
}
