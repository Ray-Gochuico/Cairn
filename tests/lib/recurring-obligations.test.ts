import { describe, it, expect } from 'vitest';
import {
  isActiveOn,
  monthlyHousingObligation,
  monthlyLeaseObligation,
  monthlyRecurringObligation,
} from '@/lib/recurring-obligations';
import type { HousingPayment, VehicleLease } from '@/types/schema';

const rent = (
  startDate: string,
  endDate: string | null,
  monthlyAmount: number,
): HousingPayment => ({
  id: 1,
  householdId: 1,
  ownerPersonId: null,
  name: 'r',
  monthlyAmount,
  startDate,
  endDate,
});

const lease = (
  startDate: string,
  endDate: string | null,
  monthlyAmount: number,
): VehicleLease => ({
  id: 1,
  householdId: 1,
  ownerPersonId: null,
  name: 'l',
  monthlyAmount,
  startDate,
  endDate,
});

describe('isActiveOn', () => {
  it('is true on the start date', () => {
    expect(isActiveOn({ startDate: '2026-05-01', endDate: null }, '2026-05-15')).toBe(true);
  });

  it('is false before the start date', () => {
    expect(isActiveOn({ startDate: '2026-05-01', endDate: null }, '2026-04-30')).toBe(false);
  });

  it('is true on the end date', () => {
    expect(
      isActiveOn({ startDate: '2026-05-01', endDate: '2026-12-31' }, '2026-12-31'),
    ).toBe(true);
  });

  it('is false after the end date', () => {
    expect(
      isActiveOn({ startDate: '2026-05-01', endDate: '2026-12-31' }, '2027-01-01'),
    ).toBe(false);
  });

  it('is true forever when end date is null', () => {
    expect(isActiveOn({ startDate: '2026-05-01', endDate: null }, '2099-12-31')).toBe(true);
  });
});

describe('monthlyHousingObligation', () => {
  it('sums all active rentals for the as-of month', () => {
    const items = [
      rent('2026-01-01', null, 2400),
      rent('2026-04-01', '2026-12-31', 1500),
      rent('2027-01-01', null, 3200), // not yet active in 2026-05
    ];
    expect(monthlyHousingObligation(items, '2026-05-15')).toBe(2400 + 1500);
  });

  it('returns 0 when no items are active', () => {
    expect(monthlyHousingObligation([rent('2026-06-01', null, 2400)], '2026-05-01')).toBe(0);
  });
});

describe('monthlyLeaseObligation', () => {
  it('sums all active leases for the as-of month', () => {
    const items = [
      lease('2026-01-01', '2029-12-31', 599),
      lease('2026-03-01', null, 1200),
    ];
    expect(monthlyLeaseObligation(items, '2026-05-15')).toBe(599 + 1200);
  });

  it('excludes leases that have already ended', () => {
    const items = [lease('2024-01-01', '2025-12-31', 500)];
    expect(monthlyLeaseObligation(items, '2026-01-01')).toBe(0);
  });
});

describe('monthlyRecurringObligation', () => {
  it('is the sum of housing + lease totals', () => {
    expect(
      monthlyRecurringObligation(
        [rent('2026-01-01', null, 2400)],
        [lease('2026-01-01', null, 599)],
        '2026-05-15',
      ),
    ).toBe(2999);
  });

  it('is zero when both lists are empty', () => {
    expect(monthlyRecurringObligation([], [], '2026-05-15')).toBe(0);
  });
});
