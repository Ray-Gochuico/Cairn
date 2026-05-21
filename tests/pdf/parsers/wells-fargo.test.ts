import { describe, it, expect } from 'vitest';
import { parseWellsFargo } from '@/pdf/parsers/wells-fargo';
import type { PdfTextItem } from '@/pdf/types';
import fixture from '../../fixtures/pdf/wells-fargo-sample.json';

describe('parseWellsFargo', () => {
  it('parses the Wells Fargo activity table', () => {
    expect(parseWellsFargo(fixture as PdfTextItem[])).toEqual([
      { date: '2026-03-04', merchantRaw: 'HOME DEPOT #6402', merchant: 'HOME DEPOT #6402', amount: 214.55 },
      { date: '2026-03-09', merchantRaw: 'CHIPOTLE 1180', merchant: 'CHIPOTLE 1180', amount: 13.85 },
    ]);
  });
});
