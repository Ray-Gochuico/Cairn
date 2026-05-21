import { describe, it, expect } from 'vitest';
import {
  firstPageText,
  groupIntoRows,
  cleanMerchant,
  parseAmount,
  inferStatementPeriod,
  resolveTransactionYear,
} from '@/pdf/layout';
import type { PdfTextItem } from '@/pdf/types';

const item = (p: Partial<PdfTextItem> & { str: string }): PdfTextItem => ({
  page: 1, x: 0, y: 0, width: 10, height: 8, ...p,
});

describe('firstPageText', () => {
  it('joins only page-1 strings', () => {
    expect(
      firstPageText([item({ str: 'A', page: 1 }), item({ str: 'B', page: 2 })]),
    ).toBe('A');
  });
});

describe('groupIntoRows', () => {
  it('clusters items within yTolerance into one row, sorted left-to-right', () => {
    const rows = groupIntoRows([
      item({ str: 'right', x: 200, y: 100 }),
      item({ str: 'left', x: 10, y: 101 }),
      item({ str: 'next', x: 10, y: 130 }),
    ]);
    expect(rows.map((r) => r.map((i) => i.str))).toEqual([['left', 'right'], ['next']]);
  });

  it('does not merge rows from different pages at the same y', () => {
    const rows = groupIntoRows([
      item({ str: 'p1', x: 10, y: 100, page: 1 }),
      item({ str: 'p2', x: 10, y: 100, page: 2 }),
    ]);
    expect(rows).toHaveLength(2);
  });
});

describe('parseAmount', () => {
  it('parses a plain purchase amount as positive', () => {
    expect(parseAmount('$1,234.56')).toBe(1234.56);
    expect(parseAmount('54.00')).toBe(54);
  });
  it('parses minus / parenthesized credits as negative', () => {
    expect(parseAmount('-$50.00')).toBe(-50);
    expect(parseAmount('($50.00)')).toBe(-50);
    expect(parseAmount('50.00-')).toBe(-50);
  });
  it('returns null for non-amount tokens', () => {
    expect(parseAmount('STORE123')).toBeNull();
    expect(parseAmount('03/14')).toBeNull();
    expect(parseAmount('')).toBeNull();
  });
});

describe('cleanMerchant', () => {
  it('collapses whitespace', () => {
    expect(cleanMerchant('AMAZON   MARKETPLACE')).toBe('AMAZON MARKETPLACE');
  });
  it('strips a trailing 2-letter state code', () => {
    expect(cleanMerchant('STARBUCKS SEATTLE WA')).toBe('STARBUCKS SEATTLE');
  });
  it('strips trailing long store numbers and phone numbers', () => {
    expect(cleanMerchant('WALMART #088123')).toBe('WALMART');
    expect(cleanMerchant('COMCAST 800-555-1234')).toBe('COMCAST');
  });
  it('never returns empty — falls back to the trimmed raw', () => {
    expect(cleanMerchant('  WA  ')).toBe('WA');
  });
});

describe('inferStatementPeriod', () => {
  it('anchors on the latest year-bearing date on page 1', () => {
    // a year-crossing cycle: closing date is the later one
    expect(
      inferStatementPeriod([item({ str: 'Opening/Closing Date 12/28/25 - 01/27/26' })]),
    ).toEqual({ closingMonth: 1, closingYear: 2026 });
  });
  it('uses a 4-digit year and the latest date when several are present', () => {
    expect(
      inferStatementPeriod([
        item({ str: 'Statement closing date 03/14/2026' }),
        item({ str: 'Payment due date 04/10/2026' }),
      ]),
    ).toEqual({ closingMonth: 4, closingYear: 2026 });
  });
  it('falls back to the current month/year when no year-bearing date exists', () => {
    const now = new Date();
    expect(inferStatementPeriod([item({ str: 'no dated text' })])).toEqual({
      closingMonth: now.getMonth() + 1,
      closingYear: now.getFullYear(),
    });
  });
});

describe('resolveTransactionYear', () => {
  const period = { closingMonth: 1, closingYear: 2026 };
  it('uses the closing year for a month at or before the closing month', () => {
    expect(resolveTransactionYear(1, period)).toBe(2026);
  });
  it('uses the prior year for a month after the closing month', () => {
    expect(resolveTransactionYear(12, period)).toBe(2025);
  });
});
