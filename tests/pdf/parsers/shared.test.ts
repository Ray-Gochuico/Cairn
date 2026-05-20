import { describe, it, expect } from 'vitest';
import { extractRowsByShape } from '@/pdf/parsers/shared';
import type { PdfTextItem } from '@/pdf/types';

const item = (str: string, x: number, y: number): PdfTextItem => ({
  page: 1, str, x, y, width: 10, height: 8,
});

// MM/DD config used across these tests.
const config = {
  dateRe: /^(\d{2})\/(\d{2})$/,
  toIso: (m: RegExpExecArray) => `2026-${m[1]}-${m[2]}`,
};

describe('extractRowsByShape', () => {
  it('extracts a date + merchant + amount row', () => {
    const items = [
      item('03/14', 50, 100),
      item('AMAZON MARKETPLACE', 100, 100),
      item('$54.23', 500, 100),
    ];
    expect(extractRowsByShape(items, config)).toEqual([
      { date: '2026-03-14', merchantRaw: 'AMAZON MARKETPLACE', merchant: 'AMAZON MARKETPLACE', amount: 54.23 },
    ]);
  });

  it('skips rows with no leading date', () => {
    const items = [item('Previous Balance', 50, 100), item('$0.00', 500, 100)];
    expect(extractRowsByShape(items, config)).toEqual([]);
  });

  it('folds a continuation row (no date, no amount) into the previous merchant', () => {
    const items = [
      item('03/14', 50, 100),
      item('SQ *COFFEE', 100, 100),
      item('$4.50', 500, 100),
      item('SAN FRANCISCO CA', 100, 130), // continuation
    ];
    const result = extractRowsByShape(items, config);
    expect(result).toHaveLength(1);
    expect(result[0].merchantRaw).toBe('SQ *COFFEE SAN FRANCISCO CA');
  });

  it('keeps a negative amount as a credit', () => {
    const items = [
      item('03/02', 50, 100),
      item('PAYMENT THANK YOU', 100, 100),
      item('-$200.00', 500, 100),
    ];
    expect(extractRowsByShape(items, config)[0].amount).toBe(-200);
  });
});
