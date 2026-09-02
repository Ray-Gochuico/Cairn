import { afterEach, describe, expect, it, vi } from 'vitest';
import { enterExploreMode, exitExploreMode } from '@/lib/explore-transitions';
import { EXPLORE_FLAG_KEY, prefKey } from '@/lib/explore-mode';

/** The flag's VALUE is opaque to isExploreMode() — only presence matters —
 * so a fixed literal keeps this suite off the real clock (test-clock policy). */
const FLAG_SET_AT = '2026-07-08T12:00:00.000Z';

describe('explore transitions', () => {
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState({}, '', '/');
    vi.restoreAllMocks();
  });

  it('enter: close (flush) → set flag → navigate to "/" — in that order', async () => {
    const order: string[] = [];
    await enterExploreMode({
      closeDb: async () => void order.push('close'),
      reset: async () => void order.push('reset'),
      // W4 review MINOR 10: the flag is sampled AT the navigate call, not
      // after the promise resolves — otherwise a navigate-before-flag mutant
      // passes (the assertion below would see the flag either way).
      navigate: (path) =>
        order.push(`nav:${path}:${localStorage.getItem(EXPLORE_FLAG_KEY) !== null}`),
    });
    expect(order).toEqual(['close', 'nav:/:true']); // reset is NOT part of entry — boot wipes
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
    // W4 review MINOR 11: exit from a NON-root path. D-S4's "always '/'" is
    // the one deliberate difference from restore's reload() — a
    // navigate(window.location.pathname) mutant is invisible while the test
    // sits on jsdom's default '/'.
    window.history.pushState({}, '', '/investments');
    localStorage.setItem(EXPLORE_FLAG_KEY, FLAG_SET_AT);
    const order: string[] = [];
    await exitExploreMode({
      closeDb: async () => void order.push('close'),
      reset: async () => void order.push('reset'),
      navigate: (path) =>
        order.push(`nav:${path}:${localStorage.getItem(EXPLORE_FLAG_KEY) !== null}`),
    });
    expect(order).toEqual(['close', 'reset', 'nav:/:false']);
    expect(window.location.pathname).toBe('/investments'); // the spy never navigated
    expect(localStorage.getItem(EXPLORE_FLAG_KEY)).toBeNull();
  });

  // W4 review MAJOR 1/2: donut hidden sets, chart selections and the backtest
  // verdict cache are device-local but carry SAMPLE row ids / a sample
  // verdict. Ids restart at 1 in the post-exit real DB, so anything left
  // behind re-targets the user's own rows.
  it('exit: every explore-namespaced pref is gone and the REAL keys are untouched', async () => {
    localStorage.setItem(EXPLORE_FLAG_KEY, FLAG_SET_AT);
    // Written during the sample session, through prefKey (flag is set):
    localStorage.setItem(prefKey('donut.assets.hidden'), '["account:2"]');
    localStorage.setItem(prefKey('backtest:last-run:v1'), '{"v":1}');
    sessionStorage.setItem(prefKey('calculator.overrides.fi'), '{"spend":1}');
    // The user's own, from before they ever clicked Explore:
    localStorage.setItem('donut.assets.hidden', '["account:9"]');
    localStorage.setItem('theme', 'dark');

    await exitExploreMode({
      closeDb: async () => {},
      reset: async () => {},
      navigate: () => {},
    });

    expect(localStorage.getItem('explore.donut.assets.hidden')).toBeNull();
    expect(localStorage.getItem('explore.backtest:last-run:v1')).toBeNull();
    expect(sessionStorage.getItem('explore.calculator.overrides.fi')).toBeNull();
    expect(localStorage.getItem('donut.assets.hidden')).toBe('["account:9"]');
    expect(localStorage.getItem('theme')).toBe('dark'); // D-S7's device-pref exemption
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
