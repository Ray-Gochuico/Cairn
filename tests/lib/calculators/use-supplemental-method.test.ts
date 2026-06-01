import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSupplementalMethod } from '@/lib/calculators/use-supplemental-method';

describe('useSupplementalMethod', () => {
  beforeEach(() => sessionStorage.clear());
  it('defaults to AGGREGATE', () => {
    const { result } = renderHook(() => useSupplementalMethod('bonus-tax'));
    expect(result.current[0]).toBe('AGGREGATE');
  });
  it('setting FLAT persists under calc-suppl-method:<cardId>', () => {
    const { result } = renderHook(() => useSupplementalMethod('bonus-tax'));
    act(() => result.current[1]('FLAT'));
    expect(result.current[0]).toBe('FLAT');
    expect(sessionStorage.getItem('calc-suppl-method:bonus-tax')).toBe('FLAT');
  });
  it('reads a persisted method on init', () => {
    sessionStorage.setItem('calc-suppl-method:commission-tax', 'FLAT');
    const { result } = renderHook(() => useSupplementalMethod('commission-tax'));
    expect(result.current[0]).toBe('FLAT');
  });
});
