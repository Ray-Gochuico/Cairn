import { describe, it, expect } from 'vitest';
import { validateAccountTargetPct } from '@/lib/holdings-validation';

describe('validateAccountTargetPct', () => {
  it('passes when sum is < 100% in a non-margin account', () => {
    const result = validateAccountTargetPct(
      [{ targetAllocationPct: 0.6 }, { targetAllocationPct: 0.3 }],
      { allowMargin: false },
    );
    expect(result.ok).toBe(true);
  });

  it('passes exactly at 100%', () => {
    const result = validateAccountTargetPct(
      [{ targetAllocationPct: 0.5 }, { targetAllocationPct: 0.5 }],
      { allowMargin: false },
    );
    expect(result.ok).toBe(true);
  });

  it('fails over 100% in a non-margin account', () => {
    const result = validateAccountTargetPct(
      [{ targetAllocationPct: 0.5 }, { targetAllocationPct: 0.6 }],
      { allowMargin: false },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.sum).toBeCloseTo(1.1, 4);
      expect(result.cap).toBe(1.0);
      expect(result.message).toMatch(/110/);
    }
  });

  it('passes over 100% when allowMargin is true', () => {
    const result = validateAccountTargetPct(
      [{ targetAllocationPct: 0.8 }, { targetAllocationPct: 0.7 }],
      { allowMargin: true },
    );
    expect(result.ok).toBe(true);
  });

  it('ignores null targetAllocationPct entries', () => {
    const result = validateAccountTargetPct(
      [{ targetAllocationPct: null }, { targetAllocationPct: 0.5 }],
      { allowMargin: false },
    );
    expect(result.ok).toBe(true);
  });

  it('handles empty holdings array', () => {
    const result = validateAccountTargetPct([], { allowMargin: false });
    expect(result.ok).toBe(true);
  });
});
