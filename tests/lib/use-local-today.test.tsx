import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLocalToday } from '@/lib/use-local-today';

describe('useLocalToday (midnight rollover, Wave 8)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 7, 23, 59, 30)); // local 2026-07-07 23:59:30
  });
  afterEach(() => vi.useRealTimers());

  it('returns the local calendar day', () => {
    const { result } = renderHook(() => useLocalToday());
    expect(result.current).toBe('2026-07-07');
  });

  it('flips on the polling interval after midnight', () => {
    const { result } = renderHook(() => useLocalToday());
    act(() => {
      vi.advanceTimersByTime(2 * 60_000); // 00:01:30 next day; ≥1 interval tick
    });
    expect(result.current).toBe('2026-07-08');
  });

  it('flips immediately on visibilitychange (returning to a backgrounded tab)', () => {
    const { result } = renderHook(() => useLocalToday());
    act(() => {
      vi.setSystemTime(new Date(2026, 6, 8, 9, 0, 0));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current).toBe('2026-07-08');
  });

  it('same-day ticks do not churn re-renders (setState bails on equal value)', () => {
    vi.setSystemTime(new Date(2026, 6, 7, 10, 0, 0)); // mid-day: no flip possible soon
    let renders = 0;
    const { result } = renderHook(() => {
      renders++;
      return useLocalToday();
    });
    const after = renders;
    act(() => {
      vi.advanceTimersByTime(5 * 60_000); // five same-day interval ticks
    });
    expect(result.current).toBe('2026-07-07');
    expect(renders).toBe(after); // updater returned prev → React bailed, zero re-renders
  });

  it('cleans up its interval and listener on unmount', () => {
    const clearSpy = vi.spyOn(window, 'clearInterval');
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const { unmount } = renderHook(() => useLocalToday());
    unmount();
    expect(clearSpy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });
});
