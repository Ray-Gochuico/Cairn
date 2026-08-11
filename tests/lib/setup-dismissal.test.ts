import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SETUP_DISMISSED_KEY,
  isSetupDismissed,
  markSetupDismissed,
  shouldRedirectToSetup,
  hasSetupInProgress,
  SETUP_PROGRESS_KEY,
  finishSetup,
} from '@/lib/setup-dismissal';
import { SETUP_PROGRESS_V2_KEY, SETUP_PROGRESS_V1_KEY } from '@/lib/setup-progress';
import { ONBOARDING_TAILOR_DONE_KEY } from '@/lib/onboarding-state';

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

describe('hasSetupInProgress (Wave C C4)', () => {
  beforeEach(() => localStorage.clear());
  it('false with no persisted wizard run; true once progress exists', () => {
    expect(hasSetupInProgress()).toBe(false);
    localStorage.setItem(SETUP_PROGRESS_KEY, '{"currentSection":3}');
    expect(hasSetupInProgress()).toBe(true);
  });
  it('exports the canonical key SectionLayout writes', () => {
    expect(SETUP_PROGRESS_KEY).toBe('setupWizard.progress.v1');
  });
  it('true when only the v2 progress key exists (worded-onboarding wave)', () => {
    localStorage.setItem('setupWizard.progress.v2', '{}');
    expect(hasSetupInProgress()).toBe(true);
  });
  it('false for a revisit-origin v2 record through the re-exported symbol (Wave A item 3)', () => {
    localStorage.setItem('setupWizard.progress.v2', '{"origin":"revisit"}');
    expect(hasSetupInProgress()).toBe(false);
  });
});

describe('finishSetup (shared by both views)', () => {
  beforeEach(() => localStorage.clear());

  it('marks dismissed, clears BOTH progress keys, routes fresh users to /welcome', () => {
    localStorage.setItem(SETUP_PROGRESS_V1_KEY, '{}');
    localStorage.setItem(SETUP_PROGRESS_V2_KEY, '{}');
    const navigate = vi.fn();
    finishSetup(navigate);
    expect(localStorage.getItem('setupWizard.dismissed.v1')).not.toBeNull();
    expect(localStorage.getItem(SETUP_PROGRESS_V1_KEY)).toBeNull();
    expect(localStorage.getItem(SETUP_PROGRESS_V2_KEY)).toBeNull();
    expect(navigate).toHaveBeenCalledWith('/welcome');
  });

  it('routes tailor-done users straight to the Dashboard', () => {
    localStorage.setItem(ONBOARDING_TAILOR_DONE_KEY, '2026-08-01T00:00:00.000Z');
    const navigate = vi.fn();
    finishSetup(navigate);
    expect(navigate).toHaveBeenCalledWith('/');
  });
});
