import type { PdfTextItem, ParsedTransaction } from '../types';
import { inferStatementYear } from '../layout';
import { extractRowsByShape } from './shared';

/** Chase activity rows lead with an `MM/DD` date; the year is on the
 *  statement's Opening/Closing Date line. */
const CHASE_DATE = /^(\d{2})\/(\d{2})$/;

export function parseChase(items: PdfTextItem[]): ParsedTransaction[] {
  const year = inferStatementYear(items);
  return extractRowsByShape(items, {
    dateRe: CHASE_DATE,
    toIso: (m) => `${year}-${m[1]}-${m[2]}`,
  });
}
