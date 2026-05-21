import type { PdfTextItem, ParsedTransaction } from '../types';
import { extractRowsByShape } from './shared';

const DISCOVER_DATE = /^(\d{2})\/(\d{2})\/(\d{2})$/; // MM/DD/YY

export function parseDiscover(items: PdfTextItem[]): ParsedTransaction[] {
  return extractRowsByShape(items, {
    dateRe: DISCOVER_DATE,
    // `20xx` century prefix assumes all two-digit years are in the 2000s.
    toIso: (m) => `20${m[3]}-${m[1]}-${m[2]}`,
  });
}
