import { describe, it, expect } from 'vitest';
import { AppSettingsSchema } from '@/types/schema';
import { RefreshCadence } from '@/types/enums';

const VALID_BASE = {
  id: 1 as const,
  sidebarLayout: null,
  notificationsEnabled: true,
  notificationDay: 1,
  refreshCadence: RefreshCadence.EVERY_LAUNCH,
  lastRefreshAt: null,
  statementsFolderPath: null,
  lastSeenMonth: null,
  lastVisitDate: null,
  briefingBaselineDate: null,
};

describe('AppSettingsSchema — briefing visit stamps (migration 0050)', () => {
  it('accepts null for both stamps (first-ever open)', () => {
    const parsed = AppSettingsSchema.parse(VALID_BASE);
    expect(parsed.lastVisitDate).toBeNull();
    expect(parsed.briefingBaselineDate).toBeNull();
  });

  it('accepts YYYY-MM-DD strings for both stamps', () => {
    const parsed = AppSettingsSchema.parse({
      ...VALID_BASE,
      lastVisitDate: '2026-07-09',
      briefingBaselineDate: '2026-07-06',
    });
    expect(parsed.lastVisitDate).toBe('2026-07-09');
    expect(parsed.briefingBaselineDate).toBe('2026-07-06');
  });

  it('rejects non-string stamps', () => {
    expect(() => AppSettingsSchema.parse({ ...VALID_BASE, lastVisitDate: 20260709 })).toThrow();
    expect(() =>
      AppSettingsSchema.parse({ ...VALID_BASE, briefingBaselineDate: 20260706 }),
    ).toThrow();
  });
});

describe('AppSettingsSchema — utility category fields', () => {
  it('defaults both fields to null when omitted', () => {
    const parsed = AppSettingsSchema.parse(VALID_BASE);
    expect(parsed.propertyUtilitiesCategoryIds).toBeNull();
    expect(parsed.vehicleGasCategoryIds).toBeNull();
  });

  it('accepts arrays of positive ints', () => {
    const parsed = AppSettingsSchema.parse({
      ...VALID_BASE,
      propertyUtilitiesCategoryIds: [10, 20],
      vehicleGasCategoryIds: [17],
    });
    expect(parsed.propertyUtilitiesCategoryIds).toEqual([10, 20]);
    expect(parsed.vehicleGasCategoryIds).toEqual([17]);
  });

  it('accepts an empty array (explicit "none")', () => {
    const parsed = AppSettingsSchema.parse({
      ...VALID_BASE,
      propertyUtilitiesCategoryIds: [],
      vehicleGasCategoryIds: [],
    });
    expect(parsed.propertyUtilitiesCategoryIds).toEqual([]);
    expect(parsed.vehicleGasCategoryIds).toEqual([]);
  });

  it('accepts explicit null for either field', () => {
    const parsed = AppSettingsSchema.parse({
      ...VALID_BASE,
      propertyUtilitiesCategoryIds: null,
      vehicleGasCategoryIds: null,
    });
    expect(parsed.propertyUtilitiesCategoryIds).toBeNull();
    expect(parsed.vehicleGasCategoryIds).toBeNull();
  });

  it('rejects zero or negative ids', () => {
    expect(() =>
      AppSettingsSchema.parse({
        ...VALID_BASE,
        propertyUtilitiesCategoryIds: [0],
      }),
    ).toThrow();
    expect(() =>
      AppSettingsSchema.parse({
        ...VALID_BASE,
        vehicleGasCategoryIds: [-1],
      }),
    ).toThrow();
  });

  it('rejects non-integer ids', () => {
    expect(() =>
      AppSettingsSchema.parse({
        ...VALID_BASE,
        propertyUtilitiesCategoryIds: [1.5],
      }),
    ).toThrow();
  });
});

describe('AppSettingsSchema — autoInvestSalarySurplus removed', () => {
  // The autoInvestSalarySurplus field was removed in the 2026-05-26 What-If
  // revamp. Replaced by LeverPayload.gapAllocation (per-scenario routing).
  // The migration 0029 column lives on as a zombie in SQLite (forward-only
  // migrations) but no app code reads or writes it.
  it('does not expose autoInvestSalarySurplus on the parsed output', () => {
    const parsed = AppSettingsSchema.parse(VALID_BASE);
    expect((parsed as Record<string, unknown>).autoInvestSalarySurplus).toBeUndefined();
  });

  it('drops any provided autoInvestSalarySurplus input (unknown key)', () => {
    const parsed = AppSettingsSchema.parse({
      ...VALID_BASE,
      autoInvestSalarySurplus: true,
    });
    expect((parsed as Record<string, unknown>).autoInvestSalarySurplus).toBeUndefined();
  });
});
