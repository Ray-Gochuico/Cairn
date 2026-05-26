import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDonutSelection } from '@/components/charts/useDonutSelection';

const KEY = 'donut.test.hidden';

describe('useDonutSelection', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts with everything selected when storage is empty', () => {
    const { result } = renderHook(() => useDonutSelection(KEY, ['a', 'b', 'c']));
    expect([...result.current.selected].sort()).toEqual(['a', 'b', 'c']);
    expect(result.current.allShown).toBe(true);
  });

  it('hydrates from a stored HIDDEN set', () => {
    localStorage.setItem(KEY, JSON.stringify(['b']));
    const { result } = renderHook(() => useDonutSelection(KEY, ['a', 'b', 'c']));
    expect([...result.current.selected].sort()).toEqual(['a', 'c']);
    expect(result.current.allShown).toBe(false);
  });

  it('toggle hides a previously-visible key and persists', () => {
    const { result } = renderHook(() => useDonutSelection(KEY, ['a', 'b', 'c']));
    act(() => result.current.toggle('b'));
    expect([...result.current.selected].sort()).toEqual(['a', 'c']);
    expect(JSON.parse(localStorage.getItem(KEY) ?? '[]')).toEqual(['b']);
  });

  it('toggle un-hides a previously-hidden key and persists', () => {
    localStorage.setItem(KEY, JSON.stringify(['b']));
    const { result } = renderHook(() => useDonutSelection(KEY, ['a', 'b', 'c']));
    act(() => result.current.toggle('b'));
    expect([...result.current.selected].sort()).toEqual(['a', 'b', 'c']);
    expect(JSON.parse(localStorage.getItem(KEY) ?? '[]')).toEqual([]);
  });

  it('showAll clears the hidden set', () => {
    localStorage.setItem(KEY, JSON.stringify(['a', 'b']));
    const { result } = renderHook(() => useDonutSelection(KEY, ['a', 'b', 'c']));
    act(() => result.current.showAll());
    expect([...result.current.selected].sort()).toEqual(['a', 'b', 'c']);
    expect(JSON.parse(localStorage.getItem(KEY) ?? '[]')).toEqual([]);
  });

  it('hideAll sets the hidden set to every current allKey', () => {
    const { result } = renderHook(() => useDonutSelection(KEY, ['a', 'b', 'c']));
    act(() => result.current.hideAll());
    expect(result.current.selected.size).toBe(0);
    expect(JSON.parse(localStorage.getItem(KEY) ?? '[]').sort()).toEqual(['a', 'b', 'c']);
  });

  it('prunes stale ids before subtraction (does not accidentally hide new entities)', () => {
    // Stale id 'X' is in storage but not in allKeys. New entity 'd' is in
    // allKeys but not in storage. After hydration, 'd' should be visible.
    localStorage.setItem(KEY, JSON.stringify(['b', 'X']));
    const { result } = renderHook(() => useDonutSelection(KEY, ['a', 'b', 'c', 'd']));
    expect([...result.current.selected].sort()).toEqual(['a', 'c', 'd']);
  });

  it('new entity defaults to visible after a hideAll', () => {
    const { result, rerender } = renderHook(
      ({ allKeys }: { allKeys: string[] }) => useDonutSelection(KEY, allKeys),
      { initialProps: { allKeys: ['a', 'b'] } },
    );
    act(() => result.current.hideAll());
    rerender({ allKeys: ['a', 'b', 'c'] });  // simulate a new entity 'c' appearing
    expect([...result.current.selected]).toEqual(['c']);
  });

  it('survives a JSON parse error in storage by treating storage as empty', () => {
    localStorage.setItem(KEY, '{not json}');
    const { result } = renderHook(() => useDonutSelection(KEY, ['a', 'b']));
    expect([...result.current.selected].sort()).toEqual(['a', 'b']);
  });
});
