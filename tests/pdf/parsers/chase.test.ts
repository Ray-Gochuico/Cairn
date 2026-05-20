import { describe, it, expect } from 'vitest';
import { parseChase } from '@/pdf/parsers/chase';
import type { PdfTextItem } from '@/pdf/types';
import fixture from '../../fixtures/pdf/chase-sample.json';

describe('parseChase', () => {
  it('parses the Chase activity table', () => {
    const result = parseChase(fixture as PdfTextItem[]);
    expect(result).toEqual([
      { date: '2026-03-02', merchantRaw: 'PAYMENT THANK YOU', merchant: 'PAYMENT THANK YOU', amount: -200 },
      { date: '2026-03-05', merchantRaw: 'AMAZON.COM AMZN.COM/BILL WA', merchant: 'AMAZON.COM AMZN.COM/BILL', amount: 54.23 },
      { date: '2026-03-11', merchantRaw: "TRADER JOE'S #088", merchant: "TRADER JOE'S #088", amount: 73.1 },
    ]);
  });
});
