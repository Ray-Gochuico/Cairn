import { describe, it, expect, afterEach } from 'vitest';
import {
  addMonthsYm, localDayOfInstant, monthYearLabel, todayIsoOf, utcNoonOf,
} from '@/lib/interview/kernel-dates';

describe('addMonthsYm — string arithmetic over YYYY-MM (ruling 1: never a Date)', () => {
  it.each([
    ['2026-01', 1, '2026-02'],  // Jan 31 + 1: the shipped setUTCMonth landed on Mar 3 → "March"
    ['2026-08', 42, '2030-02'], // Aug 31 + 42: shipped → Mar 3 2030 → "March 2030" and 43 months
    ['2026-12', 2, '2027-02'],  // Dec 31 + 2: shipped → "March 2027"
    ['2026-01', 13, '2027-02'],
    ['2026-08', 36, '2029-08'], // the effects.test CI-28 case (Aug 1 → no overflow either way)
    ['2026-03', 0, '2026-03'],
    ['2026-12', 1, '2027-01'],
    ['2026-01', -1, '2025-12'],
    ['2024-02', 12, '2025-02'],
  ])('%s + %i months = %s', (ym, n, out) => {
    expect(addMonthsYm(ym, n)).toBe(out);
  });

  it('always yields a well-formed YYYY-MM (the input carries no day, so no day can overflow)', () => {
    // MUTANT NOTE: a `new Date(y, m + n, 1)` implementation also passes THIS
    // table; the day-31 arms in effects.test.ts (Task 2) and
    // vehicle-replacement.test.ts (Task 3) are the receipts against a Date
    // reintroduced anywhere upstream of this helper.
    for (let n = -30; n <= 60; n++) expect(addMonthsYm('2026-07', n)).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/);
  });
});

describe('monthYearLabel — byte-parity with the two idioms it consolidates (U11)', () => {
  const shippedIdiom = (ym: string) =>
    new Date(`${ym}-01T12:00:00Z`).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  it('24 consecutive months + the T2 pin', () => {
    for (let n = 0; n < 24; n++) {
      const ym = addMonthsYm('2025-01', n);
      expect(monthYearLabel(ym)).toBe(shippedIdiom(ym));
    }
    expect(monthYearLabel('2028-06')).toBe('June 2028');
  });
});

describe('todayIsoOf / localDayOfInstant / utcNoonOf — class-specific TZ arms (ruling 3)', () => {
  const ORIGINAL_TZ = process.env.TZ;
  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  it('Pacific/Auckland: local midnight on the 1st is the PRIOR UTC day — todayIsoOf reads the local day', () => {
    process.env.TZ = 'Pacific/Auckland';
    const today = new Date(2026, 8, 1);
    expect(today.toISOString().slice(0, 10)).toBe('2026-08-31'); // the class this seam closes
    expect(todayIsoOf({ today })).toBe('2026-09-01');
    expect(utcNoonOf(todayIsoOf({ today })).getUTCMonth()).toBe(8); // the bridge keeps September under UTC accessors
  });

  it('America/Los_Angeles: an instant at 03:00Z on Sep 1 is Aug 31 locally — localDayOfInstant reads the local day', () => {
    process.env.TZ = 'America/Los_Angeles';
    expect(localDayOfInstant('2026-09-01T03:00:00.000Z')).toBe('2026-08-31');
    expect(monthYearLabel(localDayOfInstant('2026-09-01T03:00:00.000Z').slice(0, 7))).toBe('August 2026');
  });

  it('utcNoonOf: a calendar day at UTC noon reads as that day under every offset', () => {
    for (const tz of ['Pacific/Kiritimati', 'Pacific/Auckland', 'UTC', 'America/Los_Angeles', 'Pacific/Pago_Pago']) {
      process.env.TZ = tz;
      const d = utcNoonOf('2026-04-12');
      expect([d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()]).toEqual([2026, 3, 12]);
    }
  });
});
