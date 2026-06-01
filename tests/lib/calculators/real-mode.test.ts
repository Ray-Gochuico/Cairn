import { describe, it, expect } from 'vitest';
import { toRealValue, toRealSeries } from '@/lib/calculators/real-mode';

describe('toRealValue', () => {
  it('year 0 is unchanged', () => {
    expect(toRealValue(100, 0.025, 0)).toBe(100);
  });
  it('deflates by (1+inflation)^years', () => {
    expect(toRealValue(100, 0.025, 1)).toBeCloseTo(97.561, 3);
    expect(toRealValue(1000, 0.03, 10)).toBeCloseTo(1000 / 1.03 ** 10, 6);
  });
});

describe('toRealSeries', () => {
  it("deflates only valueKeys, by each point's yearKey, leaving other keys", () => {
    const points = [
      { year: 0, moderate: 1000, target: 5000 },
      { year: 1, moderate: 1100, target: 5000 },
    ];
    const real = toRealSeries(points, 0.1, { valueKeys: ['moderate'], yearKey: 'year' });
    expect(real[0]).toEqual({ year: 0, moderate: 1000, target: 5000 }); // year 0 unchanged
    expect(real[1].moderate).toBeCloseTo(1100 / 1.1, 6);                 // deflated 1 year
    expect(real[1].target).toBe(5000);                                   // not a valueKey → untouched
    expect(real[1].year).toBe(1);                                        // yearKey untouched
  });
  it('keys deflation on yearKey, not array index ("Year N" label safe)', () => {
    const points = [{ label: 'Year 5', yearNum: 5, mid: 1000 }];
    const real = toRealSeries(points, 0.02, { valueKeys: ['mid'], yearKey: 'yearNum' });
    expect(real[0].mid).toBeCloseTo(1000 / 1.02 ** 5, 6);
  });
});
