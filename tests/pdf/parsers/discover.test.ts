import { describe, it, expect } from 'vitest';
import { parseDiscover } from '@/pdf/parsers/discover';
import type { PdfTextItem } from '@/pdf/types';
import fixture from '../../fixtures/pdf/discover-sample.json';

describe('parseDiscover', () => {
  it('parses the Discover activity table', () => {
    expect(parseDiscover(fixture as PdfTextItem[])).toEqual([
      { date: '2026-03-06', merchantRaw: 'TARGET T-2841', merchant: 'TARGET T-2841', amount: 64.18 },
      { date: '2026-03-11', merchantRaw: 'DISCOVER PAYMENT', merchant: 'DISCOVER PAYMENT', amount: -150 },
    ]);
  });
});
