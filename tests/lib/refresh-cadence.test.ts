import { describe, it, expect } from 'vitest';
import { isRefreshDue } from '@/lib/refresh-cadence';
import { RefreshCadence } from '@/types/enums';

const now = new Date('2026-05-22T12:00:00.000Z');

describe('isRefreshDue', () => {
  it('EVERY_LAUNCH is always due, regardless of lastRefreshAt', () => {
    expect(isRefreshDue(RefreshCadence.EVERY_LAUNCH, null, now)).toBe(true);
    expect(
      isRefreshDue(RefreshCadence.EVERY_LAUNCH, '2026-05-22T11:59:00.000Z', now),
    ).toBe(true);
  });

  it('MANUAL is never due', () => {
    expect(isRefreshDue(RefreshCadence.MANUAL, null, now)).toBe(false);
    expect(
      isRefreshDue(RefreshCadence.MANUAL, '2020-01-01T00:00:00.000Z', now),
    ).toBe(false);
  });

  it('DAILY is due when lastRefreshAt is null', () => {
    expect(isRefreshDue(RefreshCadence.DAILY, null, now)).toBe(true);
  });

  it('DAILY is due when 1+ days have elapsed', () => {
    expect(
      isRefreshDue(RefreshCadence.DAILY, '2026-05-21T11:59:00.000Z', now),
    ).toBe(true);
  });

  it('DAILY is not due when less than 1 day has elapsed', () => {
    expect(
      isRefreshDue(RefreshCadence.DAILY, '2026-05-22T01:00:00.000Z', now),
    ).toBe(false);
  });

  it('WEEKLY is due when lastRefreshAt is null', () => {
    expect(isRefreshDue(RefreshCadence.WEEKLY, null, now)).toBe(true);
  });

  it('WEEKLY is due when 7+ days have elapsed', () => {
    expect(
      isRefreshDue(RefreshCadence.WEEKLY, '2026-05-15T11:59:00.000Z', now),
    ).toBe(true);
  });

  it('WEEKLY is not due when less than 7 days have elapsed', () => {
    expect(
      isRefreshDue(RefreshCadence.WEEKLY, '2026-05-20T12:00:00.000Z', now),
    ).toBe(false);
  });
});
