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
};

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

describe('AppSettingsSchema — autoInvestSalarySurplus', () => {
  it('defaults to false when omitted', () => {
    const parsed = AppSettingsSchema.parse(VALID_BASE);
    expect(parsed.autoInvestSalarySurplus).toBe(false);
  });

  it('accepts true', () => {
    const parsed = AppSettingsSchema.parse({
      ...VALID_BASE,
      autoInvestSalarySurplus: true,
    });
    expect(parsed.autoInvestSalarySurplus).toBe(true);
  });

  it('accepts false explicitly', () => {
    const parsed = AppSettingsSchema.parse({
      ...VALID_BASE,
      autoInvestSalarySurplus: false,
    });
    expect(parsed.autoInvestSalarySurplus).toBe(false);
  });

  it('rejects non-boolean values', () => {
    expect(() =>
      AppSettingsSchema.parse({
        ...VALID_BASE,
        autoInvestSalarySurplus: 'yes' as unknown as boolean,
      }),
    ).toThrow();
  });
});
