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

  it('fails CLOSED to the real profile when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(isExploreMode()).toBe(false);
  });

  it('clearExploreFlag never throws (best-effort)', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => clearExploreFlag()).not.toThrow();
  });

  it('pins the sample DB URL literal (mirrored by Rust SAMPLE_DB_URL)', () => {
    expect(EXPLORE_DB_URL).toBe('sqlite:sample-explore.db');
    expect(EXPLORE_FLAG_KEY).toBe('explore.sampleMode.v1');
  });
});
