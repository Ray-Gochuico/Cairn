import type { PdfTextItem, ParsedTransaction } from '../types';
import { extractRowsByShape } from './shared';

const CAPITAL_ONE_DATE = /^(\d{2})\/(\d{2})\/(\d{2})$/; // MM/DD/YY

export function parseCapitalOne(items: PdfTextItem[]): ParsedTransaction[] {
  return extractRowsByShape(items, {
    dateRe: CAPITAL_ONE_DATE,
    toIso: (m) => `20${m[3]}-${m[1]}-${m[2]}`,
  });
}
