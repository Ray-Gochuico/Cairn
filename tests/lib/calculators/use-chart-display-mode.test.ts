import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChartDisplayMode } from '@/lib/calculators/use-chart-display-mode';

describe('useChartDisplayMode', () => {
  beforeEach(() => sessionStorage.clear());

  it('defaults to NOMINAL', () => {
    const { result } = renderHook(() => useChartDisplayMode('fi'));
    expect(result.current[0]).toBe('NOMINAL');
  });

  it('setting REAL persists under calc-display-mode:<cardId>', () => {
    const { result } = renderHook(() => useChartDisplayMode('fi'));
    act(() => result.current[1]('REAL'));
    expect(result.current[0]).toBe('REAL');
    expect(sessionStorage.getItem('calc-display-mode:fi')).toBe('REAL');
  });

  it('reads a persisted mode on init', () => {
    sessionStorage.setItem('calc-display-mode:coast-fi', 'REAL');
    const { result } = renderHook(() => useChartDisplayMode('coast-fi'));
    expect(result.current[0]).toBe('REAL');
  });
});
