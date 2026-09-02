import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { enterExploreMode, exitExploreMode } from '@/lib/explore-transitions';
import { EXPLORE_FLAG_KEY, prefKey } from '@/lib/explore-mode';
import { usePillLayout } from '@/components/dashboard/use-pill-layout';
import { INTERVIEW_BAR_KEY } from '@/lib/interview/bar-store';

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

  // W4 smoke D1, the whole leak in one test: the smoke drove
  // Explore → Customize layout → Move a pill → Start my real setup and found
  // `dashboardPillLayout.v1` sitting in the REAL profile, ordered by the
  // SAMPLE session. Nothing below is stubbed except the DB/navigation deps —
  // the layout write is the production hook.
  it('enter → reorder the dashboard → exit leaves NO dashboard layout key behind', async () => {
    const deps = { closeDb: async () => {}, reset: async () => {}, navigate: () => {} };
    await enterExploreMode(deps);

    const { result, unmount } = renderHook(() =>
      usePillLayout(['net-worth', 'total-debt', 'savings-rate']),
    );
    act(() => result.current.move('total-debt', -1));
    expect(JSON.parse(localStorage.getItem('explore.dashboardPillLayout.v1')!)[0].id)
      .toBe('total-debt');
    unmount();

    await exitExploreMode(deps);

    // The real profile boots with no layout key at all — exactly the state a
    // control run (never entering explore) leaves behind.
    expect(localStorage.getItem('dashboardPillLayout.v1')).toBeNull();
    expect(localStorage.getItem('explore.dashboardPillLayout.v1')).toBeNull();
    expect(localStorage.getItem(EXPLORE_FLAG_KEY)).toBeNull();
  });

  // Coordinator ruling (2026-09-02, W4 smoke follow-up): the namespace ratchet
  // cannot reach every writer. A FROZEN module — the $X bar's session store in
  // the interview kernel — keeps a RAW sessionStorage key, and sessionStorage
  // survives location.assign, so a hypothetical typed against the sample was
  // still answered on the real profile. Exit therefore wipes the whole store
  // after the prefix sweep: at that moment the real profile is first-run, so
  // there is nothing of the user's in there to lose.
  it('exit: sessionStorage is wiped after the sweep — raw keys frozen modules wrote never survive', async () => {
    localStorage.setItem(EXPLORE_FLAG_KEY, FLAG_SET_AT);
    sessionStorage.setItem(
      INTERVIEW_BAR_KEY,
      JSON.stringify({ amountCents: 25_000, cadence: 'per-month' }),
    );
    sessionStorage.setItem(prefKey('calc-basis:calculators'), 'future');
    localStorage.setItem('theme', 'dark');

    await exitExploreMode({
      closeDb: async () => {},
      reset: async () => {},
      navigate: () => {},
    });

    expect(sessionStorage.getItem(INTERVIEW_BAR_KEY)).toBeNull();
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.getItem(EXPLORE_FLAG_KEY)).toBeNull();
    // localStorage is NOT blanket-wiped — real device prefs still belong to
    // the user (the sweep there is prefix-scoped, by design).
    expect(localStorage.getItem('theme')).toBe('dark');
  });

  it('exit: a sessionStorage wipe failure still clears the flag and navigates (best-effort)', async () => {
    localStorage.setItem(EXPLORE_FLAG_KEY, FLAG_SET_AT);
    vi.spyOn(window.sessionStorage, 'clear').mockImplementation(() => {
      throw new Error('denied');
    });
    const navigate = vi.fn();
    await exitExploreMode({ closeDb: async () => {}, reset: async () => {}, navigate });
    expect(localStorage.getItem(EXPLORE_FLAG_KEY)).toBeNull();
    expect(navigate).toHaveBeenCalledWith('/');
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
