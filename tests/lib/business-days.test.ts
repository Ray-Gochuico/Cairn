import { describe, it, expect } from 'vitest';
import { lastBusinessDayOfMonth, monthsBetween } from '@/lib/business-days';

describe('lastBusinessDayOfMonth', () => {
  it('returns the 31st when it falls on a weekday', () => {
    // May 31 2024 is a Friday
    expect(lastBusinessDayOfMonth('2024-05')).toBe('2024-05-31');
  });
  it('skips back to Friday when month ends on a Saturday', () => {
    // June 30 2024 is a Sunday → expect Friday June 28
    expect(lastBusinessDayOfMonth('2024-06')).toBe('2024-06-28');
  });
  it('skips back to Friday when month ends on a Sunday', () => {
    // March 31 2024 is a Sunday → expect Friday March 29
    expect(lastBusinessDayOfMonth('2024-03')).toBe('2024-03-29');
  });
  it('handles February correctly in a leap year', () => {
    // February 29 2024 is a Thursday
    expect(lastBusinessDayOfMonth('2024-02')).toBe('2024-02-29');
  });
});

describe('monthsBetween', () => {
  it('lists 12 months ending at the given month', () => {
    const m = monthsBetween('2023-07', '2024-06');
    expect(m).toHaveLength(12);
    expect(m[0]).toBe('2023-07');
    expect(m[11]).toBe('2024-06');
  });
});
