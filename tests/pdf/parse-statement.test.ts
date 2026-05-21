import { describe, it, expect } from 'vitest';
import { parseStatement } from '@/pdf/parse-statement';
import { Issuer } from '@/types/enums';
import type { PdfTextItem } from '@/pdf/types';
import chaseFixture from '../fixtures/pdf/chase-sample.json';
import citiFixture from '../fixtures/pdf/citi-sample.json';

describe('parseStatement', () => {
  it('detects the issuer and routes to its parser', () => {
    const items = [
      { page: 1, str: 'JPMorgan Chase', x: 0, y: 0, width: 10, height: 8 },
      ...(chaseFixture as PdfTextItem[]),
    ];
    const result = parseStatement(items);
    expect(result.issuer).toBe(Issuer.CHASE);
    expect(result.transactions.length).toBe(3);
  });

  it('falls back to the generic parser for an unknown issuer', () => {
    const items: PdfTextItem[] = [
      { page: 1, str: 'Local Credit Union 2026', x: 0, y: 0, width: 10, height: 8 },
      { page: 1, str: '5/1', x: 50, y: 100, width: 20, height: 8 },
      { page: 1, str: 'CORNER STORE', x: 100, y: 100, width: 90, height: 8 },
      { page: 1, str: '$9.99', x: 500, y: 100, width: 40, height: 8 },
    ];
    const result = parseStatement(items);
    expect(result.issuer).toBe(Issuer.UNKNOWN);
    expect(result.transactions).toHaveLength(1);
  });

  it('falls back to generic when a known-issuer parser yields nothing', () => {
    // Chase signature, but no MM/DD rows — generic still finds the M/D row.
    const items: PdfTextItem[] = [
      { page: 1, str: 'JPMorgan Chase', x: 0, y: 0, width: 10, height: 8 },
      { page: 1, str: '6/3', x: 50, y: 100, width: 20, height: 8 },
      { page: 1, str: 'BOOKSHOP', x: 100, y: 100, width: 70, height: 8 },
      { page: 1, str: '$22.00', x: 500, y: 100, width: 40, height: 8 },
    ];
    expect(parseStatement(items).transactions).toHaveLength(1);
  });

  it('routes a Citi statement to parseCiti and returns 2 transactions', () => {
    const items: PdfTextItem[] = [
      { page: 1, str: 'Citi', x: 0, y: 0, width: 10, height: 8 },
      ...(citiFixture as PdfTextItem[]),
    ];
    const result = parseStatement(items);
    expect(result.issuer).toBe(Issuer.CITI);
    expect(result.transactions).toHaveLength(2);
  });
});
