import { Issuer } from '@/types/enums';
import type { PdfTextItem, ParsedTransaction } from './types';
import { detectIssuer } from './detect-issuer';
import { parseChase } from './parsers/chase';
import { parseAmex } from './parsers/amex';
import { parseCiti } from './parsers/citi';
import { parseDiscover } from './parsers/discover';
import { parseCapitalOne } from './parsers/capital-one';
import { parseBoa } from './parsers/boa';
import { parseWellsFargo } from './parsers/wells-fargo';
import { parseGeneric } from './parsers/generic';

const PARSERS: Partial<Record<Issuer, (i: PdfTextItem[]) => ParsedTransaction[]>> = {
  [Issuer.CHASE]: parseChase,
  [Issuer.AMEX]: parseAmex,
  [Issuer.CITI]: parseCiti,
  [Issuer.DISCOVER]: parseDiscover,
  [Issuer.CAPITAL_ONE]: parseCapitalOne,
  [Issuer.BOA]: parseBoa,
  [Issuer.WELLS_FARGO]: parseWellsFargo,
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
