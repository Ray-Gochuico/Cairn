import { describe, it, expect } from 'vitest';
import { INTERVIEW_THREADS } from '@/domain/interview/registry';

describe('INTERVIEW_THREADS — the roster, in surface order (registry order is the strip order)', () => {
  it('five threads: next_dollar first (the bar), market_stress last (R4, ⚑ R4-F14)', () => {
    expect(INTERVIEW_THREADS.map((t) => t.id)).toEqual([
      'next_dollar', 'vehicle_replacement', 'home_purchase', 'college_vs_retirement', 'market_stress',
    ]);
  });
  it('ids are unique and every thread is household-scoped', () => {
    expect(new Set(INTERVIEW_THREADS.map((t) => t.id)).size).toBe(INTERVIEW_THREADS.length);
    for (const t of INTERVIEW_THREADS) expect(t.scope).toBe('household');
  });
});
