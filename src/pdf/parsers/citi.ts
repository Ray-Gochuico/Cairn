import type { PdfTextItem, ParsedTransaction } from '../types';
import { inferStatementPeriod, resolveTransactionYear } from '../layout';
import { extractRowsByShape } from './shared';

const CITI_DATE = /^(\d{2})\/(\d{2})$/; // MM/DD — year resolved per-transaction

export function parseCiti(items: PdfTextItem[]): ParsedTransaction[] {
  const period = inferStatementPeriod(items);
  return extractRowsByShape(items, {
    dateRe: CITI_DATE,
    toIso: (m) => `${resolveTransactionYear(Number(m[1]), period)}-${m[1]}-${m[2]}`,
  });
}
