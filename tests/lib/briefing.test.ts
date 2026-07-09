import { describe, it, expect } from 'vitest';
import {
  briefingHeading,
  endOfLastMonthIso,
  monthName,
  rollVisitStamps,
} from '@/lib/briefing';

describe('rollVisitStamps', () => {
  it('first-ever open: stamps today, no baseline, last-month mode', () => {
    const r = rollVisitStamps({ lastVisitDate: null, briefingBaselineDate: null }, '2026-07-09');
    expect(r).toEqual({
      stamps: { lastVisitDate: '2026-07-09', briefingBaselineDate: null },
      changed: true,
      baselineIso: null,
      mode: 'last-month',
    });
  });

  it('first open of a new day: baseline becomes the previous visit day', () => {
    const r = rollVisitStamps(
      { lastVisitDate: '2026-07-06', briefingBaselineDate: '2026-07-01' },
      '2026-07-09',
    );
    expect(r.stamps).toEqual({ lastVisitDate: '2026-07-09', briefingBaselineDate: '2026-07-06' });
    expect(r.changed).toBe(true);
    expect(r.baselineIso).toBe('2026-07-06');
    expect(r.mode).toBe('last-visit');
  });

  it('same-day re-open: stamps unchanged, baseline stable all day', () => {
    const r = rollVisitStamps(
      { lastVisitDate: '2026-07-09', briefingBaselineDate: '2026-07-06' },
      '2026-07-09',
    );
    expect(r.changed).toBe(false);
    expect(r.stamps).toEqual({ lastVisitDate: '2026-07-09', briefingBaselineDate: '2026-07-06' });
    expect(r.baselineIso).toBe('2026-07-06');
    expect(r.mode).toBe('last-visit');
  });

  it('a not-strictly-past baseline (clock skew / first roll of day 2) falls back to last-month mode', () => {
    // Day 2 of app life: yesterday's roll left baseline null.
    const r1 = rollVisitStamps({ lastVisitDate: '2026-07-08', briefingBaselineDate: null }, '2026-07-09');
    expect(r1.mode).toBe('last-visit'); // baseline 2026-07-08 IS strictly past
    // Clock rolled backwards past the stamp: never compare today to the future.
    const r2 = rollVisitStamps({ lastVisitDate: '2026-07-01', briefingBaselineDate: '2026-07-20' }, '2026-07-09');
    expect(r2.mode).toBe('last-month');
    expect(r2.baselineIso).toBeNull();
  });
});

describe('endOfLastMonthIso', () => {
  const d = (iso: string) => {
    const [y, m, day] = iso.split('-').map(Number);
    return new Date(y, m - 1, day); // local, matching lastMonthYyyymm's getters
  };
  it('mid-month → last calendar day of the previous month', () => {
    expect(endOfLastMonthIso(d('2026-07-09'))).toBe('2026-06-30');
  });
  it('January rolls to previous December', () => {
    expect(endOfLastMonthIso(d('2026-01-15'))).toBe('2025-12-31');
  });
  it('month-length edge: Mar 31 → Feb 28 (non-leap)', () => {
    expect(endOfLastMonthIso(d('2026-03-31'))).toBe('2026-02-28');
  });
});

describe('monthName / briefingHeading', () => {
  it('names the YYYY-MM month', () => {
    expect(monthName('2026-06')).toBe('June');
    expect(monthName('2025-12')).toBe('December');
  });
  it('heading is the spec title in last-visit mode, the month otherwise', () => {
    expect(briefingHeading('last-visit', '2026-06')).toBe('Since your last visit');
    expect(briefingHeading('last-month', '2026-06')).toBe('Since June');
  });
});
