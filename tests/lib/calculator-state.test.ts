import { renderHook, act } from '@testing-library/react';
import { useCalculatorState } from '@/lib/calculator-state';

beforeEach(() => sessionStorage.clear());

describe('useCalculatorState', () => {
  it('starts from the provided real-data defaults', () => {
    const { result } = renderHook(() => useCalculatorState('coast-fi', { years: 20, rate: 0.07 }));
    expect(result.current.values).toEqual({ years: 20, rate: 0.07 });
    expect(result.current.isOverridden).toBe(false);
  });

  it('setValue overrides one field, persists it, and flags overridden', () => {
    const { result } = renderHook(() => useCalculatorState('coast-fi', { years: 20, rate: 0.07 }));
    act(() => result.current.setValue('years', 12));
    expect(result.current.values.years).toBe(12);
    expect(result.current.isOverridden).toBe(true);
    expect(JSON.parse(sessionStorage.getItem('calc-state:coast-fi')!)).toEqual({ years: 12 });
  });

  it('rehydrates persisted overrides over fresh defaults (defaults may have changed)', () => {
    sessionStorage.setItem('calc-state:coast-fi', JSON.stringify({ years: 12 }));
    const { result } = renderHook(() => useCalculatorState('coast-fi', { years: 25, rate: 0.05 }));
    expect(result.current.values).toEqual({ years: 12, rate: 0.05 });
  });

  it('reset clears overrides and restores current defaults', () => {
    const { result } = renderHook(() => useCalculatorState('coast-fi', { years: 20, rate: 0.07 }));
    act(() => result.current.setValue('years', 12));
    act(() => result.current.reset());
    expect(result.current.values).toEqual({ years: 20, rate: 0.07 });
    expect(result.current.isOverridden).toBe(false);
    expect(sessionStorage.getItem('calc-state:coast-fi')).toBeNull();
  });

  it('reloads overrides when cardId changes', () => {
    sessionStorage.setItem('calc-state:card-a', JSON.stringify({ years: 5 }));
    sessionStorage.setItem('calc-state:card-b', JSON.stringify({ years: 99 }));
    const { result, rerender } = renderHook(
      ({ id }) => useCalculatorState(id, { years: 20, rate: 0.07 }),
      { initialProps: { id: 'card-a' } },
    );
    expect(result.current.values.years).toBe(5);
    rerender({ id: 'card-b' });
    expect(result.current.values.years).toBe(99);
  });

  it('ignores corrupt sessionStorage and starts from defaults', () => {
    sessionStorage.setItem('calc-state:coast-fi', 'not-json');
    const { result } = renderHook(() => useCalculatorState('coast-fi', { years: 20, rate: 0.07 }));
    expect(result.current.values).toEqual({ years: 20, rate: 0.07 });
  });

  it('exposes overriddenKeys — the per-field dirty source (Wave 17)', () => {
    const { result } = renderHook(() => useCalculatorState('wm-test', { a: 1, b: 2 }));
    expect([...result.current.overriddenKeys]).toEqual([]);
    act(() => result.current.setValue('b', 9));
    expect(result.current.overriddenKeys.has('b')).toBe(true);
    expect(result.current.overriddenKeys.has('a')).toBe(false);
    act(() => result.current.reset());
    expect(result.current.overriddenKeys.size).toBe(0);
  });
});
