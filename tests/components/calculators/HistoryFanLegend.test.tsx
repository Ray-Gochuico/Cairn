/**
 * W2 review fix (MAJOR 0/1, part c): with the recharts Legend suppressed
 * wherever a fan is drawn (D-P3 — the hand-rolled legend OWNS the History
 * chart's legend), HistoryFanLegend has to carry the chart's remaining line
 * series too, or PathToFi's 'Target' line would lose its key. Label and colour
 * come from the SAME series config the chart is handed — no new copy.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HistoryFanLegend } from '@/components/calculators/HistoryFanLegend';
import { FAN_LEGEND_BAND, FAN_LEGEND_MEDIAN } from '@/lib/calculators/history-fan-copy';
import { CHART_NEUTRAL } from '@/components/charts/palette';

const TARGET_SERIES = {
  dataKey: 'target',
  label: 'Target',
  color: CHART_NEUTRAL,
  strokeDasharray: '2 2',
  strokeWidth: 1.5,
};
const MEDIAN_SERIES = {
  dataKey: 'p50',
  label: FAN_LEGEND_MEDIAN,
  color: 'hsl(var(--foreground))',
  strokeWidth: 2.5,
};

const entries = () =>
  Array.from(
    screen.getByTestId('history-fan-legend').querySelectorAll(':scope > span'),
  ).map((s) => s.textContent?.trim());

describe('HistoryFanLegend (CH-9 + the chart line series)', () => {
  it('with no series: the CH-9 band and median only', () => {
    render(<HistoryFanLegend />);
    expect(entries()).toEqual([FAN_LEGEND_BAND, FAN_LEGEND_MEDIAN]);
  });

  it("PathToFi's two series ⇒ band, median, then Target — the median is never doubled", () => {
    render(<HistoryFanLegend series={[TARGET_SERIES, MEDIAN_SERIES]} />);
    expect(entries()).toEqual([FAN_LEGEND_BAND, FAN_LEGEND_MEDIAN, 'Target']);
  });

  it("Compound's single median series adds nothing", () => {
    render(<HistoryFanLegend series={[MEDIAN_SERIES]} />);
    expect(entries()).toEqual([FAN_LEGEND_BAND, FAN_LEGEND_MEDIAN]);
  });

  it("STOP mode's descriptive target label rides through unchanged", () => {
    render(
      <HistoryFanLegend
        series={[{ ...TARGET_SERIES, label: 'Required at retirement' }, MEDIAN_SERIES]}
      />,
    );
    expect(entries()).toEqual([FAN_LEGEND_BAND, FAN_LEGEND_MEDIAN, 'Required at retirement']);
  });

  it('the line key takes its stroke and dash from the series config, not a local literal', () => {
    render(<HistoryFanLegend series={[TARGET_SERIES, MEDIAN_SERIES]} />);
    const line = screen
      .getByTestId('history-fan-legend')
      .querySelector('svg[data-series="target"] line')!;
    expect(line.getAttribute('stroke')).toBe(CHART_NEUTRAL);
    expect(line.getAttribute('stroke-dasharray')).toBe('2 2');
  });
});
