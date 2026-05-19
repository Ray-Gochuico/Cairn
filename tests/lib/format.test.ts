import { describe, it, expect } from 'vitest';
import { formatCompactCurrency } from '@/lib/format';

describe('formatCompactCurrency', () => {
  it('formats sub-thousand values with no suffix', () => {
    expect(formatCompactCurrency(0)).toBe('$0');
    expect(formatCompactCurrency(500)).toBe('$500');
    expect(formatCompactCurrency(999)).toBe('$999');
  });
  it('formats thousands with k suffix, no decimal when whole', () => {
    expect(formatCompactCurrency(1000)).toBe('$1k');
    expect(formatCompactCurrency(80000)).toBe('$80k');
    expect(formatCompactCurrency(999000)).toBe('$999k');
  });
  it('formats thousands with k suffix + 1 decimal when not whole', () => {
    expect(formatCompactCurrency(1500)).toBe('$1.5k');
    expect(formatCompactCurrency(12300)).toBe('$12.3k');
  });
  it('formats millions with M suffix, no decimal when whole', () => {
    expect(formatCompactCurrency(1000000)).toBe('$1M');
    expect(formatCompactCurrency(5000000)).toBe('$5M');
  });
  it('formats millions with M suffix + 1 decimal when not whole', () => {
    expect(formatCompactCurrency(1200000)).toBe('$1.2M');
    expect(formatCompactCurrency(5500000)).toBe('$5.5M');
  });
  it('preserves sign for negative values', () => {
    expect(formatCompactCurrency(-500)).toBe('$-500');
    expect(formatCompactCurrency(-80000)).toBe('$-80k');
    expect(formatCompactCurrency(-1200000)).toBe('$-1.2M');
  });
});
