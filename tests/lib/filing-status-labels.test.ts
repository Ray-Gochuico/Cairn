import { describe, it, expect } from 'vitest';
import { FILING_STATUS_LABELS } from '@/lib/filing-status-labels';

describe('FILING_STATUS_LABELS (Wave C C5 — shared ScenarioBar/wizard labels)', () => {
  it('pins all four sentence-cased labels', () => {
    expect(FILING_STATUS_LABELS.SINGLE).toBe('Single');
    expect(FILING_STATUS_LABELS.MFJ).toBe('Married filing jointly');
    expect(FILING_STATUS_LABELS.MFS).toBe('Married filing separately');
    expect(FILING_STATUS_LABELS.HOH).toBe('Head of household');
  });
});
