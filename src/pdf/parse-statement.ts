import { Issuer } from '@/types/enums';
import type { PdfTextItem, ParsedTransaction } from './types';
import { detectIssuer } from './detect-issuer';
import { parseChase } from './parsers/chase';
import { parseAmex } from './parsers/amex';
import { parseGeneric } from './parsers/generic';

/** Issuer → parser. Issuers without a dedicated parser yet (Citi, Discover,
 *  Capital One, BoA, Wells Fargo until Slice 7) are simply absent and route
 *  to the generic fallback. */
const PARSERS: Partial<Record<Issuer, (i: PdfTextItem[]) => ParsedTransaction[]>> = {
  [Issuer.CHASE]: parseChase,
  [Issuer.AMEX]: parseAmex,
};

export interface ParseResult {
  issuer: Issuer;
  transactions: ParsedTransaction[];
}

/**
 * Detect the issuer and route to its parser. Falls back to the generic
 * parser for an unknown issuer — and for a known issuer whose parser
 * returns zero rows, so a layout change never yields an empty import.
 */
export function parseStatement(items: PdfTextItem[]): ParseResult {
  const issuer = detectIssuer(items);
  const parser = PARSERS[issuer];
  let transactions = parser ? parser(items) : [];
  if (transactions.length === 0) {
    transactions = parseGeneric(items);
  }
  return { issuer, transactions };
}
