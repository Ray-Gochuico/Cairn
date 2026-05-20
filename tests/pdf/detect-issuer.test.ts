import { describe, it, expect } from 'vitest';
import { detectIssuer } from '@/pdf/detect-issuer';
import { Issuer } from '@/types/enums';
import type { PdfTextItem } from '@/pdf/types';

const page1 = (str: string): PdfTextItem[] => [
  { page: 1, str, x: 0, y: 0, width: 10, height: 8 },
];

describe('detectIssuer', () => {
  it.each([
    ['JPMorgan Chase Bank, N.A.', Issuer.CHASE],
    ['Manage your account at americanexpress.com', Issuer.AMEX],
    ['Citibank, N.A. cardmember', Issuer.CITI],
    ['Discover card statement', Issuer.DISCOVER],
    ['Capital One Bank (USA), N.A.', Issuer.CAPITAL_ONE],
    ['Bank of America credit card', Issuer.BOA],
    ['Wells Fargo & Company', Issuer.WELLS_FARGO],
  ])('detects %s', (text, expected) => {
    expect(detectIssuer(page1(text))).toBe(expected);
  });

  it('returns UNKNOWN when no signature matches', () => {
    expect(detectIssuer(page1('Generic Local Credit Union'))).toBe(Issuer.UNKNOWN);
  });

  it('only scans page 1', () => {
    const items: PdfTextItem[] = [
      { page: 1, str: 'no issuer here', x: 0, y: 0, width: 10, height: 8 },
      { page: 2, str: 'JPMorgan Chase', x: 0, y: 0, width: 10, height: 8 },
    ];
    expect(detectIssuer(items)).toBe(Issuer.UNKNOWN);
  });
});
