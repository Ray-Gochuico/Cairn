import { describe, it, expect } from 'vitest';
import { colorForAccount } from '@/lib/account-colors';

describe('colorForAccount', () => {
  it('returns the same color for the same account id on repeated calls', () => {
    expect(colorForAccount(1)).toBe(colorForAccount(1));
    expect(colorForAccount(42)).toBe(colorForAccount(42));
  });

  it('returns different colors for different account ids (most of the time)', () => {
    expect(colorForAccount(1)).not.toBe(colorForAccount(2));
    expect(colorForAccount(2)).not.toBe(colorForAccount(3));
  });

  it('returns a value from CHART_PALETTE', () => {
    const c = colorForAccount(123);
    expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('handles id = 0 without throwing', () => {
    expect(() => colorForAccount(0)).not.toThrow();
  });
});
