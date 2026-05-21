import type { PdfTextItem, ParsedTransaction } from '../types';
import { extractRowsByShape } from './shared';

const BOA_DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/; // MM/DD/YYYY

export function parseBoa(items: PdfTextItem[]): ParsedTransaction[] {
  return extractRowsByShape(items, {
    dateRe: BOA_DATE,
    toIso: (m) => `${m[3]}-${m[1]}-${m[2]}`,
  });
}
