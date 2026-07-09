import { describe, it, expect } from 'vitest';
import { fiChartSeries } from '@/lib/calculators/fi-chart-series';
import { CHART_PALETTE } from '@/components/charts/palette';

const threeDefaults = [
  { label: 'Conservative' },
  { label: 'Moderate' },
  { label: 'Optimistic' },
];

// Rows: Optimistic reaches 1M at year 2, Moderate at year 3, Conservative never.
const data = [
  { year: 0, Conservative: 100_000, Moderate: 100_000, Optimistic: 100_000, target: 1_000_000 },
  { year: 1, Conservative: 300_000, Moderate: 400_000, Optimistic: 600_000, target: 1_000_000 },
  { year: 2, Conservative: 500_000, Moderate: 800_000, Optimistic: 1_050_000, target: 1_000_000 },
  { year: 3, Conservative: 700_000, Moderate: 1_010_000, Optimistic: 1_600_000, target: 1_000_000 },
];

describe('fiChartSeries (Wave 11 T13)', () => {
  it('never assigns the palette red to a growth scenario and emphasizes the headline driver', () => {
    const { series } = fiChartSeries(threeDefaults, data, 1_000_000);
    const optimistic = series.find((s) => s.label.startsWith('Optimistic'))!;
    expect(optimistic.color).toBe(CHART_PALETTE[4]); // green, not [2] red
    expect(optimistic.color).not.toBe(CHART_PALETTE[2]);
    expect(series.find((s) => s.label.startsWith('Moderate'))!.strokeWidth).toBe(2.5);
    expect(series.find((s) => s.label.startsWith('Conservative'))!.strokeWidth).toBe(1.5);
  });

  it('emits one crossing marker per scenario that reaches the target, at the first crossing year', () => {
    const { series, markers } = fiChartSeries(threeDefaults, data, 1_000_000);
    // Optimistic first >= 1M at year 2; Moderate at year 3; Conservative never.
    const opt = series.find((s) => s.label === 'Optimistic')!;
    const mod = series.find((s) => s.label === 'Moderate')!;
    expect(markers).toHaveLength(2);
    expect(markers).toContainEqual({ x: 2, y: 1_000_000, color: opt.color });
    expect(markers).toContainEqual({ x: 3, y: 1_000_000, color: mod.color });
  });

  it('a scenario that never crosses emits no marker', () => {
    const { markers } = fiChartSeries(threeDefaults, data, 1_000_000);
    expect(markers.some((m) => m.x === 0)).toBe(false);
    // Conservative never reaches 1M in the fixture.
    expect(markers.length).toBe(2);
  });
});
