import { describe, it, expect } from 'vitest';
import { defaultScenarioColor, BASELINE_COLOR, NON_BASELINE_PALETTE } from '@/lib/whatif/scenario-colors';

describe('defaultScenarioColor', () => {
  it('returns the baseline color for sortOrder=0', () => {
    expect(defaultScenarioColor(0, true)).toBe(BASELINE_COLOR);
  });

  it('cycles the non-baseline palette for non-baseline scenarios', () => {
    expect(defaultScenarioColor(0, false)).toBe(NON_BASELINE_PALETTE[0]);
    expect(defaultScenarioColor(1, false)).toBe(NON_BASELINE_PALETTE[1]);
    const last = NON_BASELINE_PALETTE.length - 1;
    expect(defaultScenarioColor(last, false)).toBe(NON_BASELINE_PALETTE[last]);
    expect(defaultScenarioColor(last + 1, false)).toBe(NON_BASELINE_PALETTE[0]);
  });

  it('exposes a palette of at least 6 distinct colors', () => {
    expect(NON_BASELINE_PALETTE.length).toBeGreaterThanOrEqual(6);
    expect(new Set(NON_BASELINE_PALETTE).size).toBe(NON_BASELINE_PALETTE.length);
  });

  it('every palette entry is a hex color', () => {
    for (const c of [BASELINE_COLOR, ...NON_BASELINE_PALETTE]) {
      expect(c).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('first non-baseline color is the hue-opposed orange, pale blue is last (W10 design)', () => {
    expect(NON_BASELINE_PALETTE[0]).toBe('#ef8b5a');
    expect(NON_BASELINE_PALETTE[NON_BASELINE_PALETTE.length - 1]).toBe('#a8c0fb');
  });
});
