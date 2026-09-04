import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { migrateUncustomizedLayout, useWidgetLayout } from '@/components/dashboard/use-widget-layout';
import { clearExploreFlag, clearExplorePrefs, setExploreFlag } from '@/lib/explore-mode';

const STORAGE_KEY = 'dashboardWidgetLayout.v1';

describe('useWidgetLayout', () => {
  beforeEach(() => {
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  });

  it('starts with default ids, none hidden, when localStorage is empty', () => {
    const { result } = renderHook(() => useWidgetLayout(['a', 'b', 'c']));
    expect(result.current.layout).toEqual([
      { id: 'a', hidden: false },
      { id: 'b', hidden: false },
      { id: 'c', hidden: false },
    ]);
  });

  it('move swaps adjacent items and is a no-op at the edges', () => {
    const { result } = renderHook(() => useWidgetLayout(['a', 'b', 'c']));
    act(() => result.current.move('a', -1));
    expect(result.current.layout.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    act(() => result.current.move('b', -1));
    expect(result.current.layout.map((e) => e.id)).toEqual(['b', 'a', 'c']);
    act(() => result.current.move('a', 1));
    expect(result.current.layout.map((e) => e.id)).toEqual(['b', 'c', 'a']);
    act(() => result.current.move('a', 1));
    expect(result.current.layout.map((e) => e.id)).toEqual(['b', 'c', 'a']);
  });

  it('hide / show toggles the hidden flag in place', () => {
    const { result } = renderHook(() => useWidgetLayout(['a', 'b']));
    act(() => result.current.hide('a'));
    expect(result.current.hidden('a')).toBe(true);
    act(() => result.current.show('a'));
    expect(result.current.hidden('a')).toBe(false);
  });

  it('persists state to its OWN storage key, not the pill layout key', () => {
    const { result } = renderHook(() => useWidgetLayout(['w1', 'w2']));
    act(() => result.current.hide('w1'));
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
    expect(stored).toEqual([
      { id: 'w1', hidden: true },
      { id: 'w2', hidden: false },
    ]);
    // The pill layout key should be untouched.
    expect(window.localStorage.getItem('dashboardPillLayout.v1')).toBeNull();
  });

  it('reads existing state from localStorage on mount', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ id: 'b', hidden: false }, { id: 'a', hidden: true }]),
    );
    const { result } = renderHook(() => useWidgetLayout(['a', 'b']));
    expect(result.current.layout.map((e) => e.id)).toEqual(['b', 'a']);
    expect(result.current.hidden('a')).toBe(true);
  });

  it('drops stale ids and appends new ids to the end of the stored order', () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { id: 'c', hidden: false },
        { id: 'OLD-REMOVED', hidden: false },
        { id: 'a', hidden: true },
      ]),
    );
    const { result } = renderHook(() => useWidgetLayout(['a', 'b', 'c']));
    expect(result.current.layout.map((e) => e.id)).toEqual(['c', 'a', 'b']);
    expect(result.current.hidden('a')).toBe(true);
    expect(result.current.hidden('b')).toBe(false);
  });

  it('gracefully ignores corrupt localStorage content', () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json}');
    const { result } = renderHook(() => useWidgetLayout(['a', 'b']));
    expect(result.current.layout).toEqual([
      { id: 'a', hidden: false },
      { id: 'b', hidden: false },
    ]);
  });
});

describe('one-time migration for never-customized layouts', () => {
  const NEW_DEFAULTS = ['pills-section', 'asset-value-chart', 'spending', 'concentration', 'goals'];

  beforeEach(() => {
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  });

  it('rebuilds the exact old default order to the new defaults', () => {
    localStorage.setItem(
      'dashboardWidgetLayout.v1',
      JSON.stringify(['pills-section', 'spending', 'concentration', 'goals'].map((id) => ({ id, hidden: false }))),
    );
    const { result } = renderHook(() => useWidgetLayout(NEW_DEFAULTS));
    expect(result.current.layout.map((e) => e.id)).toEqual(NEW_DEFAULTS);
  });

  it('leaves customized layouts alone (new id appends at the end)', () => {
    localStorage.setItem(
      'dashboardWidgetLayout.v1',
      JSON.stringify([
        { id: 'spending', hidden: false },
        { id: 'pills-section', hidden: false },
        { id: 'concentration', hidden: true },
        { id: 'goals', hidden: false },
      ]),
    );
    const { result } = renderHook(() => useWidgetLayout(NEW_DEFAULTS));
    expect(result.current.layout.map((e) => e.id)).toEqual([
      'spending', 'pills-section', 'concentration', 'goals', 'asset-value-chart',
    ]);
  });

  it('leaves default-ORDER layouts with a hidden widget alone (hidden counts as customized)', () => {
    // Same order as the old default, but the user hid one widget — that IS
    // a customization, so the migration must not resurrect it into the new
    // default (which would un-hide concentration).
    localStorage.setItem(
      'dashboardWidgetLayout.v1',
      JSON.stringify([
        { id: 'pills-section', hidden: false },
        { id: 'spending', hidden: false },
        { id: 'concentration', hidden: true },
        { id: 'goals', hidden: false },
      ]),
    );
    const { result } = renderHook(() => useWidgetLayout(NEW_DEFAULTS));
    expect(result.current.layout.map((e) => e.id)).toEqual([
      'pills-section', 'spending', 'concentration', 'goals', 'asset-value-chart',
    ]);
    expect(result.current.hidden('concentration')).toBe(true);
  });

  it('no saved layout: fresh defaults, no migration write needed', () => {
    const { result } = renderHook(() => useWidgetLayout(NEW_DEFAULTS));
    expect(result.current.layout.map((e) => e.id)).toEqual(NEW_DEFAULTS);
  });
});

describe('migrateUncustomizedLayout — any pristine generation', () => {
  // W13: the asset chart left the widget set (fixed secondary hero) — the
  // current default is the 5-id list below.
  const NEW_DEFAULTS = ['pills-section', 'spending', 'concentration', 'goals', 'trivia'];

  beforeEach(() => localStorage.clear());

  it('rebuilds the 4-id pre-chart pristine layout to the new defaults', () => {
    localStorage.setItem('dashboardWidgetLayout.v1', JSON.stringify(
      ['pills-section', 'spending', 'concentration', 'goals'].map((id) => ({ id, hidden: false })),
    ));
    migrateUncustomizedLayout(NEW_DEFAULTS);
    expect(JSON.parse(localStorage.getItem('dashboardWidgetLayout.v1')!)).toEqual(
      NEW_DEFAULTS.map((id) => ({ id, hidden: false })),
    );
  });

  it('rebuilds the 5-id post-chart pristine layout to the new defaults', () => {
    localStorage.setItem('dashboardWidgetLayout.v1', JSON.stringify(
      ['pills-section', 'asset-value-chart', 'spending', 'concentration', 'goals'].map((id) => ({ id, hidden: false })),
    ));
    migrateUncustomizedLayout(NEW_DEFAULTS);
    expect(JSON.parse(localStorage.getItem('dashboardWidgetLayout.v1')!)).toEqual(
      NEW_DEFAULTS.map((id) => ({ id, hidden: false })),
    );
  });

  it('rebuilds the 6-id post-trivia pristine layout (generation 3, W13) to the new defaults', () => {
    localStorage.setItem('dashboardWidgetLayout.v1', JSON.stringify(
      ['pills-section', 'asset-value-chart', 'spending', 'concentration', 'goals', 'trivia'].map((id) => ({ id, hidden: false })),
    ));
    migrateUncustomizedLayout(NEW_DEFAULTS);
    expect(JSON.parse(localStorage.getItem('dashboardWidgetLayout.v1')!)).toEqual(
      NEW_DEFAULTS.map((id) => ({ id, hidden: false })),
    );
  });

  it('leaves ANY customized layout alone (order changed / something hidden)', () => {
    const custom = [
      { id: 'spending', hidden: false },
      { id: 'pills-section', hidden: false },
      { id: 'asset-value-chart', hidden: true },
      { id: 'concentration', hidden: false },
      { id: 'goals', hidden: false },
    ];
    localStorage.setItem('dashboardWidgetLayout.v1', JSON.stringify(custom));
    migrateUncustomizedLayout(NEW_DEFAULTS);
    expect(JSON.parse(localStorage.getItem('dashboardWidgetLayout.v1')!)).toEqual(custom);
  });

  it('customized layout with the stale asset-value-chart id: the hook drops it via reconcile', () => {
    // A user who reordered pre-W13 keeps their order; the retired chart id
    // is dropped (not resurrected) and new ids append at the end.
    localStorage.setItem('dashboardWidgetLayout.v1', JSON.stringify([
      { id: 'spending', hidden: false },
      { id: 'asset-value-chart', hidden: false },
      { id: 'pills-section', hidden: false },
      { id: 'concentration', hidden: true },
      { id: 'goals', hidden: false },
      { id: 'trivia', hidden: false },
    ]));
    const { result } = renderHook(() => useWidgetLayout(NEW_DEFAULTS));
    expect(result.current.layout.map((e) => e.id)).toEqual([
      'spending', 'pills-section', 'concentration', 'goals', 'trivia',
    ]);
    expect(result.current.hidden('concentration')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// W4 smoke D1 — the widget layout is NAMESPACED while exploring, same class
// as the pill layout the smoke caught leaking (`dashboardWidgetLayout.v1`
// likewise appeared in the REAL profile after "Start my real setup"). The
// widget key has a second write path — `migrateUncustomizedLayout`, which
// REWRITES storage on mount — so both paths are pinned below.
// ---------------------------------------------------------------------------
describe('useWidgetLayout under explore mode (W4 pref ratchet)', () => {
  const EXPLORE_KEY = 'explore.dashboardWidgetLayout.v1';
  const NEW_DEFAULTS = ['pills-section', 'spending', 'concentration', 'goals', 'trivia'];

  beforeEach(() => localStorage.clear());
  afterEach(() => {
    clearExploreFlag();
    localStorage.clear();
  });

  it('writes the namespaced key while exploring, and the sweep reaps it', () => {
    setExploreFlag();
    const { result } = renderHook(() => useWidgetLayout(['w1', 'w2']));
    act(() => result.current.hide('w1'));

    expect(JSON.parse(localStorage.getItem(EXPLORE_KEY)!)).toEqual([
      { id: 'w1', hidden: true },
      { id: 'w2', hidden: false },
    ]);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    clearExplorePrefs();
    clearExploreFlag();
    expect(localStorage.getItem(EXPLORE_KEY)).toBeNull();
  });

  it('writes the bare key with the flag unset (the real profile is unprefixed)', () => {
    const { result } = renderHook(() => useWidgetLayout(['w1', 'w2']));
    act(() => result.current.hide('w1'));

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)[0]).toEqual({ id: 'w1', hidden: true });
    expect(localStorage.getItem(EXPLORE_KEY)).toBeNull();
  });

  it('the pristine-generation migration rewrites the explore key ONLY — never the real one', () => {
    // The nastiest half of this leak: migrateUncustomizedLayout WRITES on
    // mount. Reading the raw key from an explore boot would rewrite the real
    // profile's stored layout before the user ever touched Customize.
    const pristine = ['pills-section', 'spending', 'concentration', 'goals']
      .map((id) => ({ id, hidden: false }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pristine));
    localStorage.setItem(EXPLORE_KEY, JSON.stringify(pristine));

    setExploreFlag();
    migrateUncustomizedLayout(NEW_DEFAULTS);

    expect(JSON.parse(localStorage.getItem(EXPLORE_KEY)!)).toEqual(
      NEW_DEFAULTS.map((id) => ({ id, hidden: false })),
    );
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual(pristine);
  });
});
