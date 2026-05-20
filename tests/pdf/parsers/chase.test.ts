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

  it('dates transactions across a year boundary using the statement period', () => {
    const items: PdfTextItem[] = [
      { page: 1, str: 'Opening/Closing Date 12/28/25 - 01/27/26', x: 50, y: 60, width: 240, height: 8 },
      { page: 1, str: '12/30', x: 50, y: 200, width: 32, height: 8 },
      { page: 1, str: 'OLD YEAR STORE', x: 95, y: 200, width: 150, height: 8 },
      { page: 1, str: '$40.00', x: 505, y: 200, width: 40, height: 8 },
      { page: 1, str: '01/15', x: 50, y: 224, width: 32, height: 8 },
      { page: 1, str: 'NEW YEAR STORE', x: 95, y: 224, width: 150, height: 8 },
      { page: 1, str: '$60.00', x: 505, y: 224, width: 40, height: 8 },
    ];
    const result = parseChase(items);
    expect(result.map((t) => t.date)).toEqual(['2025-12-30', '2026-01-15']);
  });
});
