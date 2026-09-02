import { afterEach, describe, expect, it, vi } from 'vitest';
import { enterExploreMode, exitExploreMode } from '@/lib/explore-transitions';
import { EXPLORE_FLAG_KEY } from '@/lib/explore-mode';

/** The flag's VALUE is opaque to isExploreMode() — only presence matters —
 * so a fixed literal keeps this suite off the real clock (test-clock policy). */
const FLAG_SET_AT = '2026-07-08T12:00:00.000Z';

describe('explore transitions', () => {
  afterEach(() => {
    localStorage.removeItem(EXPLORE_FLAG_KEY);
    vi.restoreAllMocks();
  });

  it('enter: close (flush) → set flag → navigate to "/" — in that order', async () => {
    const order: string[] = [];
    await enterExploreMode({
      closeDb: async () => void order.push('close'),
      reset: async () => void order.push('reset'),
      navigate: (path) => order.push(`nav:${path}`),
    });
    expect(order).toEqual(['close', 'nav:/']); // reset is NOT part of entry — boot wipes
    expect(localStorage.getItem(EXPLORE_FLAG_KEY)).not.toBeNull();
  });

  it('enter: a flag-write failure still navigates (degrades to the real first-run, acceptance already durable)', async () => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const navigate = vi.fn();
    await enterExploreMode({ closeDb: async () => {}, reset: async () => {}, navigate });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/');
    expect(warn).toHaveBeenCalled(); // warn, never console.error (e2e console guard)
  });

  it('exit: close → reset → clear flag → navigate to "/" (never a reload-in-place)', async () => {
    localStorage.setItem(EXPLORE_FLAG_KEY, FLAG_SET_AT);
    const order: string[] = [];
    await exitExploreMode({
      closeDb: async () => void order.push('close'),
      reset: async () => void order.push('reset'),
      navigate: (path) => order.push(`nav:${path}`),
    });
    expect(order).toEqual(['close', 'reset', 'nav:/']);
    expect(localStorage.getItem(EXPLORE_FLAG_KEY)).toBeNull();
  });

  it('exit: the flag clears and navigation fires EVEN when the wipe throws (stale file is inert; next entry re-wipes)', async () => {
    localStorage.setItem(EXPLORE_FLAG_KEY, FLAG_SET_AT);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const navigate = vi.fn();
    await exitExploreMode({
      closeDb: async () => {},
      reset: async () => {
        throw new Error('disk');
      },
      navigate,
    });
    expect(localStorage.getItem(EXPLORE_FLAG_KEY)).toBeNull();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/');
    expect(warn).toHaveBeenCalled(); // warn, never console.error (e2e console guard)
  });
});
