import { describe, it, expect } from 'vitest';
import { parseBoa } from '@/pdf/parsers/boa';
import type { PdfTextItem } from '@/pdf/types';
import fixture from '../../fixtures/pdf/boa-sample.json';

describe('parseBoa', () => {
  it('parses the Bank of America activity table', () => {
    expect(parseBoa(fixture as PdfTextItem[])).toEqual([
      { date: '2026-03-05', merchantRaw: 'WHOLE FOODS MKT', merchant: 'WHOLE FOODS MKT', amount: 96.32 },
      { date: '2026-03-13', merchantRaw: 'DELTA AIR LINES', merchant: 'DELTA AIR LINES', amount: 412 },
    ]);
  });
});
