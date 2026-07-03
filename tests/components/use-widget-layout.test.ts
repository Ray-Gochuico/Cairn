import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { migrateUncustomizedLayout, useWidgetLayout } from '@/components/dashboard/use-widget-layout';

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

describe('migrateUncustomizedLayout — either pristine generation', () => {
  const NEW_DEFAULTS = ['pills-section', 'asset-value-chart', 'spending', 'concentration', 'goals', 'trivia'];

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
});
