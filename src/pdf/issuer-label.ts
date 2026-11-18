import { Issuer } from '@/types/enums';

/**
 * v1.8.0 W4 (G2-10 ⚑): each statement issuer's name as the PDF review shows
 * it. A Record over Issuer, so a new issuer cannot ship without a name.
 */
const ISSUER_LABELS: Record<Issuer, string> = {
  [Issuer.CHASE]: 'Chase',
  [Issuer.AMEX]: 'American Express',
  [Issuer.CITI]: 'Citi',
  [Issuer.DISCOVER]: 'Discover',
  [Issuer.CAPITAL_ONE]: 'Capital One',
  [Issuer.BOA]: 'Bank of America',
  [Issuer.WELLS_FARGO]: 'Wells Fargo',
  [Issuer.UNKNOWN]: 'Bank not recognized',
};

/** The bank's name in words; anything outside the Issuer list reads as not
 *  recognized, the same as UNKNOWN. */
export function issuerLabel(issuer: string | undefined): string {
  return issuer !== undefined && Object.prototype.hasOwnProperty.call(ISSUER_LABELS, issuer)
    ? ISSUER_LABELS[issuer as Issuer]
    : ISSUER_LABELS[Issuer.UNKNOWN];
}
