import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSelectedEarner } from '@/lib/calculators/use-selected-earner';

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
});
