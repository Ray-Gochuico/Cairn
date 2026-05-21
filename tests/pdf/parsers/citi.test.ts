import { describe, it, expect } from 'vitest';
import { parseCiti } from '@/pdf/parsers/citi';
import type { PdfTextItem } from '@/pdf/types';
import fixture from '../../fixtures/pdf/citi-sample.json';

describe('parseCiti', () => {
  it('parses the Citi activity table', () => {
    expect(parseCiti(fixture as PdfTextItem[])).toEqual([
      { date: '2026-03-03', merchantRaw: 'COSTCO WHSE #0511', merchant: 'COSTCO WHSE #0511', amount: 182.4 },
      { date: '2026-03-10', merchantRaw: 'SPOTIFY USA', merchant: 'SPOTIFY USA', amount: 11.99 },
    ]);
  });
});
