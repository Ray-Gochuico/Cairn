import { describe, it, expect } from 'vitest';
import { evaluateBrackets, type Bracket, computeFica } from '@/lib/tax';

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

describe('computeFica', () => {
  it('applies 6.2% SS + 1.45% Medicare for income below SS wage base', () => {
    // 100000 × 0.062 = 6200; 100000 × 0.0145 = 1450; total 7650
    expect(computeFica(100000, 'SINGLE')).toBeCloseTo(7650, 2);
  });
  it('caps SS at the 2026 wage base ($176,100)', () => {
    // SS: 176100 × 0.062 = 10918.2 (capped); Medicare: 200000 × 0.0145 = 2900; total 13818.2
    expect(computeFica(200000, 'SINGLE')).toBeCloseTo(13818.2, 1);
  });
  it('applies +0.9% Additional Medicare Tax above $200k SINGLE', () => {
    // 250000: SS capped = 10918.2; Medicare: 250000 × 0.0145 + (250000-200000) × 0.009 = 3625 + 450 = 4075; total 14993.2
    expect(computeFica(250000, 'SINGLE')).toBeCloseTo(14993.2, 1);
  });
  it('uses $250k MFJ threshold for Additional Medicare Tax', () => {
    // 300000 MFJ: SS capped; Medicare: 300000 × 0.0145 + (300000-250000) × 0.009 = 4350 + 450 = 4800
    // total: 10918.2 + 4800 = 15718.2
    expect(computeFica(300000, 'MFJ')).toBeCloseTo(15718.2, 1);
  });
});
