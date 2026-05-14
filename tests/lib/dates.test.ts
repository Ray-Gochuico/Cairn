import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { currentAge } from '@/lib/dates';

describe('currentAge', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the difference in calendar years when birthday has passed', () => {
    vi.setSystemTime(new Date('2026-06-15'));
    // Born 1990-01-01; on 2026-06-15 the birthday already passed -> 36
    expect(currentAge('1990-01-01')).toBe(36);
  });

  it('returns prior age when birthday has not yet occurred this year', () => {
    vi.setSystemTime(new Date('2026-06-15'));
    // Born 1990-12-31; birthday hasn't happened yet in 2026 -> 35
    expect(currentAge('1990-12-31')).toBe(35);
  });

  it('returns the new age when birthday is exactly today', () => {
    vi.setSystemTime(new Date('2026-06-15'));
    // Born 1990-06-15; birthday is today -> 36
    expect(currentAge('1990-06-15')).toBe(36);
  });

  it('returns prior age when current month equals birth month but day has not arrived', () => {
    vi.setSystemTime(new Date('2026-06-14'));
    // Born 1990-06-15; same month, but day-of-month not yet reached -> 35
    expect(currentAge('1990-06-15')).toBe(35);
  });

  it('returns the new age the day after the birthday', () => {
    vi.setSystemTime(new Date('2026-06-16'));
    expect(currentAge('1990-06-15')).toBe(36);
  });

  it('handles a baby born today (age 0)', () => {
    vi.setSystemTime(new Date('2026-05-14'));
    expect(currentAge('2026-05-14')).toBe(0);
  });
});
