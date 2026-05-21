import { describe, it, expect } from 'vitest';
import { parseCapitalOne } from '@/pdf/parsers/capital-one';
import type { PdfTextItem } from '@/pdf/types';
import fixture from '../../fixtures/pdf/capital-one-sample.json';

describe('parseCapitalOne', () => {
  it('parses the Capital One activity table', () => {
    expect(parseCapitalOne(fixture as PdfTextItem[])).toEqual([
      { date: '2026-03-02', merchantRaw: 'WALMART.COM', merchant: 'WALMART.COM', amount: 48.77 },
      { date: '2026-03-08', merchantRaw: 'SHELL OIL 12345678', merchant: 'SHELL OIL', amount: 52.1 },
    ]);
  });
});
