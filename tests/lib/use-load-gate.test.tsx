import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLoadGate } from '@/lib/use-load-gate';

describe('useLoadGate', () => {
  it('calls load exactly once on mount and settles when nothing is loading', () => {
    const load = vi.fn();
    const { result, rerender } = renderHook(
      ({ loading }) => useLoadGate([loading], [null], load),
      { initialProps: { loading: false } },
    );
    expect(load).toHaveBeenCalledTimes(1);
    expect(result.current.settled).toBe(true);
    rerender({ loading: false });
    expect(load).toHaveBeenCalledTimes(1); // mount-only, not per-render
  });

  it('is NOT settled while any consumed slice is loading', () => {
    const { result } = renderHook(() => useLoadGate([false, true], [null, null], () => {}));
    expect(result.current.settled).toBe(false);
  });

  it('LATCHES: once settled, a slice flipping back to loading cannot un-settle (boot-loop gotcha)', () => {
    const { result, rerender } = renderHook(
      ({ loading }) => useLoadGate([loading], [null], () => {}),
      { initialProps: { loading: true } },
    );
    expect(result.current.settled).toBe(false);
    rerender({ loading: false });
    expect(result.current.settled).toBe(true);
    rerender({ loading: true }); // descendant re-load / retry in flight
    expect(result.current.settled).toBe(true);
  });

  it('settles on ERROR too (isLoading false + error set) so the banner can render', () => {
    const { result } = renderHook(() => useLoadGate([false], ['DB gone'], () => {}));
    expect(result.current.settled).toBe(true);
    expect(result.current.errors).toEqual(['DB gone']);
  });

  it('retry re-runs the LATEST load without re-arming the mount effect', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(
      ({ load }) => useLoadGate([false], [null], load),
      { initialProps: { load: first } },
    );
    rerender({ load: second });
    act(() => result.current.retry());
    expect(first).toHaveBeenCalledTimes(1); // the mount call only
    expect(second).toHaveBeenCalledTimes(1); // the retry
  });
});
