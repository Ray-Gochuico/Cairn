import { describe, it, expect } from 'vitest';
import { CardLayoutEntrySchema, AppSettingsSchema } from '@/types/schema';
import { RefreshCadence } from '@/types/enums';

describe('CardLayoutEntrySchema', () => {
  it('accepts a well-formed entry', () => {
    expect(CardLayoutEntrySchema.parse({ id: 'growth', hidden: true })).toEqual({
      id: 'growth',
      hidden: true,
    });
  });

  it('rejects a non-string id', () => {
    expect(() => CardLayoutEntrySchema.parse({ id: 3, hidden: false })).toThrow();
  });
});

describe('AppSettingsSchema.investmentsCardLayout', () => {
  const base = {
    id: 1 as const,
    sidebarLayout: null,
    notificationsEnabled: true,
    notificationDay: 1,
    refreshCadence: RefreshCadence.DAILY,
    lastRefreshAt: null,
    statementsFolderPath: null,
    lastSeenMonth: null,
  };

  it('defaults investmentsCardLayout to null when omitted', () => {
    expect(AppSettingsSchema.parse(base).investmentsCardLayout).toBeNull();
  });

  it('accepts an array of card layout entries', () => {
    const parsed = AppSettingsSchema.parse({
      ...base,
      investmentsCardLayout: [{ id: 'sector', hidden: true }],
    });
    expect(parsed.investmentsCardLayout).toEqual([{ id: 'sector', hidden: true }]);
  });
});

describe('AppSettingsSchema.calculatorCardLayout', () => {
  const base = {
    id: 1 as const,
    sidebarLayout: null,
    notificationsEnabled: true,
    notificationDay: 1,
    refreshCadence: RefreshCadence.DAILY,
    lastRefreshAt: null,
    statementsFolderPath: null,
    lastSeenMonth: null,
  };

  it('defaults calculatorCardLayout to null when omitted', () => {
    expect(AppSettingsSchema.parse(base).calculatorCardLayout).toBeNull();
  });

  it('accepts an array of card layout entries', () => {
    const parsed = AppSettingsSchema.parse({
      ...base,
      calculatorCardLayout: [{ id: 'paycheck', hidden: true }],
    });
    expect(parsed.calculatorCardLayout).toEqual([{ id: 'paycheck', hidden: true }]);
  });
});
