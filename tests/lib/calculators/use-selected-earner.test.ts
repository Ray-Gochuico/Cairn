import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSelectedEarner, clearEarnerPicks } from '@/lib/calculators/use-selected-earner';

describe('useSelectedEarner', () => {
  beforeEach(() => sessionStorage.clear());

  it('defaults to the passed default id', () => {
    const { result } = renderHook(() => useSelectedEarner('bonus-tax', 1, [1, 2]));
    expect(result.current[0]).toBe(1);
  });

  it('persists the selection to sessionStorage under calc-earner:<cardId>', () => {
    const { result } = renderHook(() => useSelectedEarner('bonus-tax', 1, [1, 2]));
    act(() => result.current[1](2));
    expect(result.current[0]).toBe(2);
    expect(sessionStorage.getItem('calc-earner:bonus-tax')).toBe('2');
  });

  it('reads a persisted selection on init', () => {
    sessionStorage.setItem('calc-earner:overtime', '2');
    const { result } = renderHook(() => useSelectedEarner('overtime', 1, [1, 2]));
    expect(result.current[0]).toBe(2);
  });

  it('falls back to the default when the stored id is no longer eligible', () => {
    sessionStorage.setItem('calc-earner:bonus-tax', '7');
    const { result } = renderHook(() => useSelectedEarner('bonus-tax', 1, [1, 2]));
    expect(result.current[0]).toBe(1);
  });

  it('set(null) clears the stored choice (Combined state with a null default)', () => {
    sessionStorage.setItem('calc-earner:paycheck', '2');
    const { result } = renderHook(() => useSelectedEarner('paycheck', null, [1, 2]));
    expect(result.current[0]).toBe(2);
    act(() => result.current[1](null));
    expect(result.current[0]).toBeNull();
    expect(sessionStorage.getItem('calc-earner:paycheck')).toBeNull();
  });

  it('Wave B D-B9: explicitCombined stores the sentinel — Combined survives a person defaultId', () => {
    const { result } = renderHook(() =>
      useSelectedEarner('paycheck', 1 /* page scope P1 */, [1, 2], { explicitCombined: true }),
    );
    act(() => result.current[1](null)); // the user picks Combined
    expect(sessionStorage.getItem('calc-earner:paycheck')).toBe('combined');
    expect(result.current[0]).toBeNull(); // Combined, NOT the defaultId
  });

  it('Wave B D-B9: without the flag, set(null) still removes the key (legacy contract)', () => {
    const { result } = renderHook(() => useSelectedEarner('overtime', 2, [1, 2]));
    act(() => result.current[1](1));
    act(() => result.current[1](null));
    expect(sessionStorage.getItem('calc-earner:overtime')).toBeNull();
    expect(result.current[0]).toBe(2); // back to defaultId
  });

  it('Wave B D-B9: clearEarnerPicks resets a MOUNTED hook to its default via the epoch', () => {
    const { result } = renderHook(() => useSelectedEarner('paycheck', null, [1, 2]));
    act(() => result.current[1](2));
    expect(result.current[0]).toBe(2);
    act(() => clearEarnerPicks());
    expect(result.current[0]).toBeNull(); // stored pick gone, default wins
  });
});
