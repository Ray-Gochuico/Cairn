import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EXPLORE_DB_URL,
  EXPLORE_FLAG_KEY,
  EXPLORE_PREF_PREFIX,
  clearExploreFlag,
  clearExplorePrefs,
  isExploreMode,
  prefKey,
  setExploreFlag,
} from '@/lib/explore-mode';

describe('explore-mode flag', () => {
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('round-trips: off by default, on after set, off after clear', () => {
    expect(isExploreMode()).toBe(false);
    setExploreFlag();
    expect(isExploreMode()).toBe(true);
    // The stored value is an ISO timestamp (house device-local idiom).
    expect(localStorage.getItem(EXPLORE_FLAG_KEY)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    clearExploreFlag();
    expect(isExploreMode()).toBe(false);
  });

  // NOTE: the spies below target the localStorage INSTANCE, not
  // Storage.prototype. In this jsdom the accessors are OWN properties of the
  // localStorage object, so a Storage.prototype spy never intercepts and both
  // of these cases would pass vacuously (verified at W4 execution time).
  it('fails CLOSED to the real profile when localStorage throws', () => {
    // Set the flag first, so a passing assertion can only come from the catch
    // (not from an absent key).
    setExploreFlag();
    expect(isExploreMode()).toBe(true);
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(isExploreMode()).toBe(false);
  });

  it('clearExploreFlag never throws (best-effort)', () => {
    const spy = vi.spyOn(window.localStorage, 'removeItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => clearExploreFlag()).not.toThrow();
    expect(spy).toHaveBeenCalledWith(EXPLORE_FLAG_KEY); // the throw was really reached
    spy.mockRestore(); // afterEach's own removeItem must not hit the throwing stub
  });

  it('pins the sample DB URL literal (mirrored by Rust SAMPLE_DB_URL)', () => {
    expect(EXPLORE_DB_URL).toBe('sqlite:sample-explore.db');
    expect(EXPLORE_FLAG_KEY).toBe('explore.sampleMode.v1');
  });
});

// ---------------------------------------------------------------------------
// W4 review MAJOR 1/2: device-local prefs that carry DB row ids or profile-
// derived values must not survive the exit into the real profile. The sample
// and the real DB both issue autoincrement ids from 1, so a sample-era
// `account:2` silently re-targets the user's second REAL account.
// ---------------------------------------------------------------------------
describe('prefKey — explore-namespaced device prefs', () => {
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('pins the namespace prefix', () => {
    expect(EXPLORE_PREF_PREFIX).toBe('explore.');
  });

  it('returns the base key on the real profile', () => {
    expect(isExploreMode()).toBe(false);
    expect(prefKey('donut.assets.hidden')).toBe('donut.assets.hidden');
  });

  it('prefixes the key while exploring', () => {
    setExploreFlag();
    expect(prefKey('donut.assets.hidden')).toBe('explore.donut.assets.hidden');
    expect(prefKey('backtest:last-run:v1')).toBe('explore.backtest:last-run:v1');
  });

  it('clearExplorePrefs removes every explore-namespaced key from BOTH stores and nothing else', () => {
    setExploreFlag();
    localStorage.setItem(prefKey('donut.assets.hidden'), '["account:2"]');
    localStorage.setItem(prefKey('backtest:last-run:v1'), '{}');
    sessionStorage.setItem(prefKey('calc.overrides.fi'), '{}');
    // Real-profile keys written BEFORE the explore session — untouched.
    localStorage.setItem('donut.assets.hidden', '["account:9"]');
    localStorage.setItem('theme', 'dark');
    sessionStorage.setItem('calc.overrides.fi', '{"real":1}');

    clearExplorePrefs();

    expect(localStorage.getItem('explore.donut.assets.hidden')).toBeNull();
    expect(localStorage.getItem('explore.backtest:last-run:v1')).toBeNull();
    expect(sessionStorage.getItem('explore.calc.overrides.fi')).toBeNull();
    expect(localStorage.getItem('donut.assets.hidden')).toBe('["account:9"]');
    expect(localStorage.getItem('theme')).toBe('dark');
    expect(sessionStorage.getItem('calc.overrides.fi')).toBe('{"real":1}');
  });

  it('clearExplorePrefs never throws (best-effort, like clearExploreFlag)', () => {
    vi.spyOn(window.localStorage, 'key').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => clearExplorePrefs()).not.toThrow();
  });
});
