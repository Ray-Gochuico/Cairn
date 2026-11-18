/**
 * v1.8.0 W4 (G2-10, build-flag ⚑): the PDF review names the bank in words.
 * The review's description printed the raw Issuer code ('BOA', 'CAPITAL_ONE',
 * 'UNKNOWN'). issuerLabel names every Issuer, and anything else reads as not
 * recognized. Clock-free.
 */
import { describe, it, expect } from 'vitest';
import { issuerLabel } from '@/pdf/issuer-label';
import { Issuer } from '@/types/enums';

describe('issuerLabel (G2-10)', () => {
  it('names each bank Cairn reads', () => {
    expect(issuerLabel(Issuer.CHASE)).toBe('Chase');
    expect(issuerLabel(Issuer.AMEX)).toBe('American Express');
    expect(issuerLabel(Issuer.CITI)).toBe('Citi');
    expect(issuerLabel(Issuer.DISCOVER)).toBe('Discover');
    expect(issuerLabel(Issuer.CAPITAL_ONE)).toBe('Capital One');
    expect(issuerLabel(Issuer.BOA)).toBe('Bank of America');
    expect(issuerLabel(Issuer.WELLS_FARGO)).toBe('Wells Fargo');
  });

  it('a statement Cairn could not place reads "Bank not recognized"', () => {
    expect(issuerLabel(Issuer.UNKNOWN)).toBe('Bank not recognized');
  });

  it('a value outside the Issuer list reads "Bank not recognized" too', () => {
    expect(issuerLabel('GENERIC')).toBe('Bank not recognized');
    expect(issuerLabel(undefined)).toBe('Bank not recognized');
    expect(issuerLabel('toString')).toBe('Bank not recognized');
  });

  it('every Issuer has a name, and none is its raw code', () => {
    for (const issuer of Object.values(Issuer)) {
      const label = issuerLabel(issuer);
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toBe(issuer);
    }
  });
});
