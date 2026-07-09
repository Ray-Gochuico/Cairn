import { describe, it, expect } from 'vitest';
import { parseImportAmount } from '@/lib/import/amount';

describe('parseImportAmount (wave-9 S78)', () => {
  it.each([
    // [raw, expected]
    ['-30', -30],
    ['-42.50', -42.5],
    ['$1,234.56', 1234.56], // US thousands + decimal
    ['1.234,56', 1234.56], // EU thousands + decimal comma
    ['1 234,56', 1234.56], // EU space grouping
    ['1 234,56', 1234.56], // NBSP grouping
    ['12,34', 12.34], // decimal comma, 2-digit tail
    ['1,234', 1234], // US thousands (comma + exact 3-digit group)
    ['1,234,567.89', 1234567.89],
    ['1.234.567', 1234567], // EU multi-dot grouping
    ['1.234', 1.234], // single dot, 3-digit tail: US decimal (documented tradeoff)
    ['(1.234,56)', -1234.56], // parens negative + EU
    ['€2.500,00', 2500],
    ['+15', 15],
  ])('parses %s → %d', (raw, expected) => {
    expect(parseImportAmount(raw)).toBeCloseTo(expected as number, 10);
  });

  it.each([['', null], ['abc', null], ['1,23,45', null], ['.', null]])(
    'rejects %s',
    (raw, expected) => expect(parseImportAmount(raw as string)).toBe(expected),
  );
});
