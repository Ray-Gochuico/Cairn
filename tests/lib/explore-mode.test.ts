import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EXPLORE_DB_URL,
  EXPLORE_FLAG_KEY,
  clearExploreFlag,
  isExploreMode,
  setExploreFlag,
} from '@/lib/explore-mode';

describe('explore-mode flag', () => {
  afterEach(() => {
    localStorage.removeItem(EXPLORE_FLAG_KEY);
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
