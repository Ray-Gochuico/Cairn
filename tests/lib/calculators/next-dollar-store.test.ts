import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useNextDollarStore } from '@/lib/calculators/next-dollar-store';

describe('useNextDollarStore (Wave 18 D5)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    useNextDollarStore.setState({ amount: null });
  });

  it('set → every subscriber sees the value; sessionStorage round-trips', () => {
    const a = renderHook(() => useNextDollarStore((s) => s.amount));
    const b = renderHook(() => useNextDollarStore((s) => s.amount));
    act(() => useNextDollarStore.getState().setAmount(300));
    expect(a.result.current).toBe(300);
    expect(b.result.current).toBe(300);
    expect(sessionStorage.getItem('calc-shared:next-dollar')).toBe('300');
  });

  it('setAmount(null) clears the stored value', () => {
    act(() => useNextDollarStore.getState().setAmount(300));
    act(() => useNextDollarStore.getState().setAmount(null));
    expect(useNextDollarStore.getState().amount).toBeNull();
    expect(sessionStorage.getItem('calc-shared:next-dollar')).toBeNull();
  });

  it('malformed / negative stored values read as null', async () => {
    sessionStorage.setItem('calc-shared:next-dollar', 'garbage');
    const { readInitialForTests } = await import('@/lib/calculators/next-dollar-store');
    expect(readInitialForTests()).toBeNull();
    sessionStorage.setItem('calc-shared:next-dollar', '-5');
    expect(readInitialForTests()).toBeNull();
    sessionStorage.setItem('calc-shared:next-dollar', '250');
    expect(readInitialForTests()).toBe(250);
  });
});
