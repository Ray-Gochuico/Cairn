import type { PdfTextItem, ParsedTransaction } from '../types';
import { extractRowsByShape } from './shared';

const WELLS_FARGO_DATE = /^(\d{2})\/(\d{2})\/(\d{2})$/; // MM/DD/YY

export function parseWellsFargo(items: PdfTextItem[]): ParsedTransaction[] {
  return extractRowsByShape(items, {
    dateRe: WELLS_FARGO_DATE,
    // `20xx` century prefix assumes all two-digit years are in the 2000s.
    toIso: (m) => `20${m[3]}-${m[1]}-${m[2]}`,
  });
}
