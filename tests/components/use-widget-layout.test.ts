import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useWidgetLayout } from '@/components/dashboard/use-widget-layout';

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
