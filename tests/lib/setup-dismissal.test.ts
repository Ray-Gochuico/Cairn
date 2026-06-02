import { describe, it, expect, beforeEach } from 'vitest';
import {
  SETUP_DISMISSED_KEY,
  isSetupDismissed,
  markSetupDismissed,
  shouldRedirectToSetup,
} from '@/lib/setup-dismissal';

describe('setup-dismissal marker', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('isSetupDismissed is false before the marker is set', () => {
    expect(isSetupDismissed()).toBe(false);
  });

  it('markSetupDismissed persists a marker that isSetupDismissed reads back', () => {
    markSetupDismissed();
    expect(localStorage.getItem(SETUP_DISMISSED_KEY)).not.toBeNull();
    expect(isSetupDismissed()).toBe(true);
  });
});

describe('shouldRedirectToSetup (H1: gate on dismissed marker)', () => {
  it('redirects a brand-new user (no persons, not dismissed) on the root path', () => {
    expect(
      shouldRedirectToSetup({ personCount: 0, dismissed: false, path: '/' }),
    ).toBe(true);
    expect(
      shouldRedirectToSetup({ personCount: 0, dismissed: false, path: '' }),
    ).toBe(true);
  });

  it('does NOT redirect once setup has been dismissed, even with zero persons', () => {
    // The H1 re-entry trap: finishing a skip-heavy setup leaves personCount 0,
    // but the dismissed marker must stop the groundhog-day redirect.
    expect(
      shouldRedirectToSetup({ personCount: 0, dismissed: true, path: '/' }),
    ).toBe(false);
  });

  it('does NOT redirect when persons already exist', () => {
    expect(
      shouldRedirectToSetup({ personCount: 2, dismissed: false, path: '/' }),
    ).toBe(false);
  });

  it('does NOT redirect when not on the root path', () => {
    expect(
      shouldRedirectToSetup({ personCount: 0, dismissed: false, path: '/monthly' }),
    ).toBe(false);
  });
});
