import { describe, it, expect } from 'vitest';
import { parseGeneric } from '@/pdf/parsers/generic';
import type { PdfTextItem } from '@/pdf/types';

const item = (str: string, x: number, y: number): PdfTextItem => ({
  page: 1, str, x, y, width: 10, height: 8,
});

describe('parseGeneric', () => {
  it('parses single-digit and full-year date formats', () => {
    const items = [
      item('Statement Year 2026', 50, 40),
      item('4/7', 50, 100),
      item('LOCAL HARDWARE', 100, 100),
      item('$31.99', 500, 100),
      item('4/9/2026', 50, 124),
      item('CITY PARKING', 100, 124),
      item('$12.00', 500, 124),
    ];
    expect(parseGeneric(items)).toEqual([
      { date: '2026-04-07', merchantRaw: 'LOCAL HARDWARE', merchant: 'LOCAL HARDWARE', amount: 31.99 },
      { date: '2026-04-09', merchantRaw: 'CITY PARKING', merchant: 'CITY PARKING', amount: 12 },
    ]);
  });
});
