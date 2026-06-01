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

  // T6 Fix-5: YYYY-MM-DD DOB must be parsed as UTC midnight so that a UTC-negative
  // timezone never shifts a Jan-1 birthday into Dec-31 of the prior year and
  // produces an off-by-one age.
  //
  // Concrete failure scenario (EST / UTC-5):
  //   now  = 2025-12-31T23:30Z  (Dec 31 UTC, which is still Dec 31 EST too)
  //   born = 1990-01-01         = UTC midnight → local December 31 in UTC-5
  // Buggy code: birth.getFullYear() via local parse gives 1989 (shifted to Dec 31),
  //   now.getFullYear() = 2025, year-diff = 36. But birthday is Jan 1 and it's still
  //   Dec 31 UTC → age should be 35 (birthday not yet occurred).
  it('T6 UTC: Jan-1 DOB does not compute age one year high on Dec-31 UTC', () => {
    // "now" is Dec 31 2025 UTC 23:30.
    vi.setSystemTime(new Date('2025-12-31T23:30:00Z'));
    // Born 1990-01-01 UTC. Birthday hasn't occurred yet (still Dec 31 UTC).
    // Correct age = 35. Buggy (local) code gives 36.
    expect(currentAge('1990-01-01')).toBe(35);
  });

  it('T6 UTC: Jan-1 DOB gives correct age on the exact birthday (Jan 1 UTC)', () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    // On Jan 1 2026 UTC, person born 1990-01-01 UTC turns 36.
    expect(currentAge('1990-01-01')).toBe(36);
  });
});
