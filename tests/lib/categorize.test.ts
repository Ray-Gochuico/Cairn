import { describe, it, expect } from 'vitest';
import { categorize } from '@/lib/categorize';
import type { MerchantOverride, MerchantSeed } from '@/types/schema';

const seeds: MerchantSeed[] = [
  { merchantPattern: 'UBER', categoryId: 34 },
  { merchantPattern: 'UBER EATS', categoryId: 32 },
  { merchantPattern: 'STARBUCKS', categoryId: 32 },
];

describe('categorize', () => {
  it('matches a seed pattern, case-insensitively', () => {
    expect(categorize('starbucks store #221', [], seeds)).toBe(32);
  });
  it('returns null when nothing matches', () => {
    expect(categorize('UNKNOWN MERCHANT', [], seeds)).toBeNull();
  });
  it('longest matching pattern wins (UBER EATS over UBER)', () => {
    expect(categorize('UBER EATS SF', [], seeds)).toBe(32);
    expect(categorize('UBER TRIP', [], seeds)).toBe(34);
  });
  it('a household override beats the seed map', () => {
    const overrides: MerchantOverride[] = [
      { householdId: 1, merchantPattern: 'STARBUCKS', categoryId: 25 },
    ];
    expect(categorize('STARBUCKS RESERVE', overrides, seeds)).toBe(25);
  });
});
