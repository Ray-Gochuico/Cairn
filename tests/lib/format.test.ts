import { describe, it, expect } from 'vitest';
import {
  formatCompactCurrency,
  formatSignedCurrency,
  formatDate,
  formatMonth,
  formatCurrencyCents,
} from '@/lib/format';

describe('formatDate', () => {
  it('renders a calendar-day ISO string as Mon D, YYYY', () => {
    expect(formatDate('2028-06-15')).toBe('Jun 15, 2028');
  });
  it('is UTC-stable: the displayed day never shifts for west-of-UTC locales', () => {
    expect(formatDate('2026-01-01')).toBe('Jan 1, 2026');
    expect(formatDate('2026-12-31')).toBe('Dec 31, 2026');
  });
});

describe('formatMonth', () => {
  it('renders YYYY-MM as Mon YYYY', () => {
    expect(formatMonth('2026-07')).toBe('Jul 2026');
  });
  it('accepts a full ISO day and formats its month', () => {
    expect(formatMonth('2027-01-15')).toBe('Jan 2027');
  });
});

describe('formatCurrencyCents', () => {
  it('renders exact cents with thousands separators', () => {
    expect(formatCurrencyCents(6846.84)).toBe('$6,846.84');
  });
  it('renders negatives with a leading minus and separators', () => {
    expect(formatCurrencyCents(-2450)).toBe('-$2,450.00');
  });
  it('pads whole dollars to two decimals', () => {
    expect(formatCurrencyCents(40)).toBe('$40.00');
  });
});

describe('formatSignedCurrency', () => {
  it('renders negatives with a true minus (U+2212), full dollar form', () => {
    expect(formatSignedCurrency(-215)).toBe('−$215');
    expect(formatSignedCurrency(-180000)).toBe('−$180,000');
    expect(formatSignedCurrency(-1).charCodeAt(0)).toBe(0x2212); // U+2212, not ASCII hyphen
  });
  it('renders non-negatives plain — no plus sign', () => {
    expect(formatSignedCurrency(0)).toBe('$0');
    expect(formatSignedCurrency(215)).toBe('$215');
    expect(formatSignedCurrency(170000)).toBe('$170,000');
  });
});

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
