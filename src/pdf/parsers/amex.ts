import type { PdfTextItem, ParsedTransaction } from '../types';
import { extractRowsByShape } from './shared';

/** Amex activity rows lead with an `MM/DD/YY` date. */
const AMEX_DATE = /^(\d{2})\/(\d{2})\/(\d{2})$/;

export function parseAmex(items: PdfTextItem[]): ParsedTransaction[] {
  return extractRowsByShape(items, {
    dateRe: AMEX_DATE,
    toIso: (m) => `20${m[3]}-${m[1]}-${m[2]}`,
  });
}
