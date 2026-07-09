import { describe, it, expect } from 'vitest';
import { xTicksFor, xTickLabel } from '@/lib/asset-value-chart';
import type { NetWorthChartRow } from '@/lib/net-worth-chart-data';

/** Weekly Saturdays covering `count` weeks back from 2026-07-04 (clock-free). */
function weeklyRows(count: number): NetWorthChartRow[] {
  const rows: NetWorthChartRow[] = [];
  const end = Date.UTC(2026, 6, 4); // Sat 2026-07-04
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(end - i * 7 * 86_400_000);
    rows.push({ bucketEnd: d.toISOString().slice(0, 10), netWorth: 100 } as NetWorthChartRow);
  }
  return rows;
}

describe('hero x-ticks (round-3 M5)', () => {
  const TODAY = '2026-07-08';

  it('1Y (52 weekly buckets → 12 month candidates) downsamples to ≤5 ticks', () => {
    const ticks = xTicksFor(weeklyRows(52), '1Y', TODAY);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks.length).toBeLessThanOrEqual(5);
  });

  it('3M keeps its ~3 month-first ticks untouched', () => {
    const ticks = xTicksFor(weeklyRows(13), '3M', TODAY);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks.length).toBeLessThanOrEqual(5);
  });

  it('the first month candidate is always kept (window start stays anchored)', () => {
    const rows = weeklyRows(52);
    // The un-downsampled candidate list starts at the first month-first
    // bucket; even-stride downsampling (i % step === 0) must keep index 0.
    const firstCandidate = rows.find((r) => r.bucketEnd <= TODAY)!.bucketEnd;
    const sparse = xTicksFor(rows, '1Y', TODAY);
    expect(sparse[0]).toBe(firstCandidate);
    expect(sparse[0] <= sparse[sparse.length - 1]).toBe(true);
  });

  it('future buckets are still clamped (spec §5.1 preserved)', () => {
    const rows = weeklyRows(52);
    for (const t of xTicksFor(rows, '1Y', '2026-03-01')) {
      expect(t <= '2026-03-01').toBe(true);
    }
  });

  it("≤1Y labels carry the year: 'Jan 2026', not bare 'Jan'", () => {
    expect(xTickLabel('2026-01-03', '1Y')).toBe('Jan 2026');
    expect(xTickLabel('2026-01-03', '3M')).toBe('Jan 2026');
  });

  it('5Y/ALL keep year-only labels', () => {
    expect(xTickLabel('2026-01-03', '5Y')).toBe('2026');
    expect(xTickLabel('2026-01-03', 'ALL')).toBe('2026');
  });
});
