import { Issuer } from '@/types/enums';
import { firstPageText } from './layout';
import type { PdfTextItem } from './types';

/** Issuer signatures, in priority order. First match wins. */
const SIGNATURES: ReadonlyArray<{ issuer: Issuer; patterns: RegExp[] }> = [
  { issuer: Issuer.CHASE, patterns: [/jpmorgan chase/i, /chase\.com/i, /\bchase\b/i] },
  { issuer: Issuer.AMEX, patterns: [/american express/i, /americanexpress\.com/i] },
  { issuer: Issuer.CITI, patterns: [/citibank/i, /citicards/i, /\bciti\b/i] },
  { issuer: Issuer.DISCOVER, patterns: [/discover\.com/i, /discover card/i, /\bdiscover\b/i] },
  { issuer: Issuer.CAPITAL_ONE, patterns: [/capital one/i, /capitalone\.com/i] },
  { issuer: Issuer.BOA, patterns: [/bank of america/i, /bankofamerica\.com/i] },
  { issuer: Issuer.WELLS_FARGO, patterns: [/wells fargo/i, /wellsfargo\.com/i] },
];

/** Identify the statement's issuer by scanning page-1 text. */
export function detectIssuer(items: PdfTextItem[]): Issuer {
  const text = firstPageText(items);
  for (const { issuer, patterns } of SIGNATURES) {
    if (patterns.some((p) => p.test(text))) return issuer;
  }
  return Issuer.UNKNOWN;
}
