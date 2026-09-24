import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { currentAge, currentAgeAsOf, localTodayISO, dateFromLocalISO, utcNoonOf } from '@/lib/dates';

describe('localTodayISO', () => {
  it('formats a passed Date by LOCAL parts, not UTC', () => {
    const d = new Date(2026, 0, 31, 23, 30);
    expect(localTodayISO(d)).toBe('2026-01-31');
  });
});

describe('dateFromLocalISO', () => {
  it('parses an ISO day to LOCAL midnight so local accessors agree', () => {
    const d = dateFromLocalISO('2026-07-08');
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 6, 8]);
  });
});

describe('currentAge', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Instants at 12:00Z so the LOCAL calendar day (B3) is the same day from UTC−11 to UTC+11.
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
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
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
    vi.setSystemTime(new Date('2026-05-14T12:00:00Z'));
    expect(currentAge('2026-05-14')).toBe(0);
  });

  /* B3 (v1.7.0, R4 design review ruling 7): age is as of the LOCAL calendar day,
     bridged at UTC noon into currentAgeAsOf's UTC accessors. The T6 fix (DOB
     parsed as UTC midnight) is kept: a Jan-1 birthday still never reads a year
     high because the DOB side is UTC and the as-of side is UTC noon of the local
     day. The pre-B3 shape read the wall-clock instant's UTC day, which is the
     NEIGHBOURING day between local midnight and UTC midnight — every evening
     west of Greenwich, every morning east of it. Zone arms below; the machine
     zone alone cannot prove either direction. */
  describe('reads the LOCAL calendar day (B3) — zone arms', () => {
    const ORIGINAL_TZ = process.env.TZ;
    afterEach(() => {
      if (ORIGINAL_TZ === undefined) delete process.env.TZ;
      else process.env.TZ = ORIGINAL_TZ;
    });

    // 2026-01-01T03:00Z is Dec 31 19:00 in Los Angeles and Jan 1 16:00 in Auckland (NZDT, UTC+13).
    it('Los Angeles at 03:00Z on Jan 1: still Dec 31 locally — the Jan-1 birthday has NOT happened (35; the UTC-day shape said 36)', () => {
      process.env.TZ = 'America/Los_Angeles';
      vi.setSystemTime(new Date('2026-01-01T03:00:00Z'));
      expect(currentAge('1990-01-01')).toBe(35);
    });

    it('Auckland at the same instant: Jan 1 locally — 36', () => {
      process.env.TZ = 'Pacific/Auckland';
      vi.setSystemTime(new Date('2026-01-01T03:00:00Z'));
      expect(currentAge('1990-01-01')).toBe(36);
    });

    // 2025-12-31T23:30Z (the old T6 instant) is Dec 31 15:30 in Los Angeles and Jan 1 12:30 in Auckland.
    it('Auckland at 23:30Z on Dec 31: Jan 1 locally — 36 (the UTC-day shape said 35)', () => {
      process.env.TZ = 'Pacific/Auckland';
      vi.setSystemTime(new Date('2025-12-31T23:30:00Z'));
      expect(currentAge('1990-01-01')).toBe(36);
    });

    it('Los Angeles at 23:30Z on Dec 31: Dec 31 locally — 35 (unchanged from T6)', () => {
      process.env.TZ = 'America/Los_Angeles';
      vi.setSystemTime(new Date('2025-12-31T23:30:00Z'));
      expect(currentAge('1990-01-01')).toBe(35);
    });

    it('injectable now: the birthday at 12:00Z reads the new age in both zones', () => {
      process.env.TZ = 'Pacific/Auckland';
      expect(currentAge('1990-06-15', new Date('2026-06-15T12:00:00Z'))).toBe(36);
      process.env.TZ = 'America/Los_Angeles';
      expect(currentAge('1990-06-15', new Date('2026-06-15T12:00:00Z'))).toBe(36);
    });

    // B3 review: the pin above cannot tell an honoured `now` from an ignored one (the clock
    // also reads 36). Here the clock is pinned at 36 and `now` sits in 2000, so an ignored
    // `now` reads 36, and a `now` read on its UTC day misses the Auckland arm.
    it('injectable now is honoured: a `now` whose age differs from the clock reads `now`\'s LOCAL-day age', () => {
      vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
      // 2000-06-15T12:00Z is Jun 15 05:00 in Los Angeles (PDT); 2000-06-14T12:00Z is Jun 14 05:00.
      process.env.TZ = 'America/Los_Angeles';
      expect(currentAge('1990-06-15', new Date('2000-06-15T12:00:00Z'))).toBe(10);
      expect(currentAge('1990-06-15', new Date('2000-06-14T12:00:00Z'))).toBe(9);
      // Auckland (NZST, UTC+12 in June): 2000-06-14T12:00Z is already Jun 15 00:00 locally — the
      // birthday (10); 2000-06-13T12:00Z is Jun 14 00:00 — the day before (9).
      process.env.TZ = 'Pacific/Auckland';
      expect(currentAge('1990-06-15', new Date('2000-06-14T12:00:00Z'))).toBe(10);
      expect(currentAge('1990-06-15', new Date('2000-06-13T12:00:00Z'))).toBe(9);
    });
  });
});

describe('currentAgeAsOf', () => {
  it('returns the year delta when the birthday has already passed', () => {
    // born 1990-01-01, as-of 2026-06-15 -> 36
    expect(currentAgeAsOf('1990-01-01', new Date('2026-06-15'))).toBe(36);
  });

  it('returns the prior age when the birthday has not yet occurred this year', () => {
    // born 1990-12-31, as-of 2026-06-15 -> 35
    expect(currentAgeAsOf('1990-12-31', new Date('2026-06-15'))).toBe(35);
  });

  it('returns the new age when the birthday is exactly the as-of day', () => {
    expect(currentAgeAsOf('1990-06-15', new Date('2026-06-15'))).toBe(36);
  });

  it('returns the prior age when same month but day-of-month not yet reached', () => {
    expect(currentAgeAsOf('1990-06-15', new Date('2026-06-14'))).toBe(35);
  });

  it('returns the new age the day after the birthday', () => {
    expect(currentAgeAsOf('1990-06-15', new Date('2026-06-16'))).toBe(36);
  });

  it('handles a baby born on the as-of day (age 0)', () => {
    expect(currentAgeAsOf('2026-05-14', new Date('2026-05-14'))).toBe(0);
  });

  // UTC parity with currentAge: a Jan-1 DOB must not read one year high when
  // the as-of instant is Dec-31 UTC (the EST off-by-one class). currentAgeAsOf
  // compares both sides via UTC accessors, so passing a UTC instant is exact.
  it('UTC: Jan-1 DOB is not one year high at Dec-31 23:30 UTC', () => {
    expect(currentAgeAsOf('1990-01-01', new Date('2025-12-31T23:30:00Z'))).toBe(35);
  });

  it('UTC: Jan-1 DOB is correct on the exact birthday (Jan 1 UTC)', () => {
    expect(currentAgeAsOf('1990-01-01', new Date('2026-01-01T00:00:00Z'))).toBe(36);
  });
});

describe('utcNoonOf (B3 — the one bridge from a local day into UTC-accessor helpers)', () => {
  it('returns the UTC-noon instant of the day, so no zone offset (±14 h) can move it off the day', () => {
    const d = utcNoonOf('2026-01-31');
    expect(d.toISOString()).toBe('2026-01-31T12:00:00.000Z');
    expect([d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours()]).toEqual([2026, 0, 31, 12]);
    // Round trip with currentAgeAsOf: the DOB day itself is a birthday.
    expect(currentAgeAsOf('1990-01-31', d)).toBe(36);
  });
});
