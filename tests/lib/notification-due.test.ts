import { describe, it, expect } from 'vitest';
import { shouldNotify } from '@/lib/notification-due';
import type { AppSettings } from '@/types/schema';
import { RefreshCadence } from '@/types/enums';

const base: AppSettings = {
  id: 1,
  sidebarLayout: null,
  notificationsEnabled: true,
  notificationDay: 5,
  refreshCadence: RefreshCadence.EVERY_LAUNCH,
  lastRefreshAt: null,
  statementsFolderPath: null,
};

describe('shouldNotify', () => {
  it('returns true when enabled and now is the configured day', () => {
    expect(shouldNotify(base, new Date(2026, 4, 5))).toBe(true);
  });

  it('returns false when enabled but now is a different day', () => {
    expect(shouldNotify(base, new Date(2026, 4, 6))).toBe(false);
  });

  it('returns false when notifications are disabled, even on the right day', () => {
    expect(
      shouldNotify({ ...base, notificationsEnabled: false }, new Date(2026, 4, 5)),
    ).toBe(false);
  });

  it('honors a notificationDay other than the default', () => {
    const settings = { ...base, notificationDay: 28 };
    expect(shouldNotify(settings, new Date(2026, 1, 28))).toBe(true);
    expect(shouldNotify(settings, new Date(2026, 1, 27))).toBe(false);
  });
});
