import { describe, it, expect } from 'vitest';
import { parseAmex } from '@/pdf/parsers/amex';
import type { PdfTextItem } from '@/pdf/types';
import fixture from '../../fixtures/pdf/amex-sample.json';

describe('parseAmex', () => {
  it('parses the Amex activity table with MM/DD/YY dates', () => {
    const result = parseAmex(fixture as PdfTextItem[]);
    expect(result).toEqual([
      { date: '2026-03-04', merchantRaw: 'UBER TRIP HELP.UBER.COM', merchant: 'UBER TRIP HELP.UBER.COM', amount: 18.4 },
      { date: '2026-03-09', merchantRaw: 'NETFLIX.COM', merchant: 'NETFLIX.COM', amount: 15.49 },
      { date: '2026-03-12', merchantRaw: 'AUTOPAY PAYMENT RECEIVED', merchant: 'AUTOPAY PAYMENT RECEIVED', amount: -340 },
    ]);
  });
});
