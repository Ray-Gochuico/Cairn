import { describe, it, expect } from 'vitest';
import { evaluateBrackets, type Bracket } from '@/lib/tax';

const federal2026Single: Bracket[] = [
  { min: 0, max: 11600, rate: 0.10 },
  { min: 11600, max: 47150, rate: 0.12 },
  { min: 47150, max: 100525, rate: 0.22 },
  { min: 100525, max: 191950, rate: 0.24 },
  { min: 191950, max: 243725, rate: 0.32 },
  { min: 243725, max: 609350, rate: 0.35 },
  { min: 609350, max: null, rate: 0.37 },
];

describe('evaluateBrackets', () => {
  it('returns 0 for zero taxable income', () => {
    expect(evaluateBrackets(federal2026Single, 0)).toBe(0);
  });
  it('computes tax within the first bracket', () => {
    // 10% × 10000 = 1000
    expect(evaluateBrackets(federal2026Single, 10000)).toBeCloseTo(1000, 2);
  });
  it('crosses the first bracket boundary', () => {
    // 10% × 11600 = 1160; 12% × (20000 - 11600) = 1008; total 2168
    expect(evaluateBrackets(federal2026Single, 20000)).toBeCloseTo(2168, 2);
  });
  it('handles the $85.4k example (gross $100k − $14.6k std deduction)', () => {
    // 1160 + 12%×(47150-11600) + 22%×(85400-47150) = 1160 + 4266 + 8415 = 13841
    expect(evaluateBrackets(federal2026Single, 85400)).toBeCloseTo(13841, 0);
  });
  it('handles unbounded top bracket', () => {
    expect(evaluateBrackets(federal2026Single, 1000000)).toBeCloseTo(328187.75, 0);
  });
  it('rejects negative income', () => {
    expect(() => evaluateBrackets(federal2026Single, -1)).toThrow();
  });
});
