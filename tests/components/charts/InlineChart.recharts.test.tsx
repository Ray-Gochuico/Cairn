/**
 * W2 review fix (MAJOR 0 + 1) — the ONE InlineChart test that renders REAL
 * recharts.
 *
 * Every other chart test in the repo mocks the whole library, so D-P2's
 * `legendType="none"` was pinned as a PROP and never as BEHAVIOUR. In recharts
 * 3.8.1 the `entry.type === 'none'` skip lives only in DefaultLegendContent;
 * a custom `content={<ChartLegend />}` receives the unfiltered payload, so the
 * fan's internal dataKeys ('fanFloor', 'fan2575') rendered as legend copy on
 * the PathToFi History chart, beside a duplicated 'Median (p50)'.
 *
 * Only ResponsiveContainer is stubbed: jsdom has no layout, so the real
 * container measures 0×0 and the chart never paints. Everything else —
 * ComposedChart, Legend, Area, Line and the house ChartLegend — is real.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement }) =>
      React.cloneElement(children, { width: 600, height: 220 }),
  };
});

import { InlineChart } from '@/components/charts/InlineChart';
import { HistoryFanLegend } from '@/components/calculators/HistoryFanLegend';
import { HISTORY_FAN_KEYS } from '@/lib/calculators/basis-view';
import { CHART_NEUTRAL } from '@/components/charts/palette';

/** PathToFi's History wiring, verbatim in shape (PathToFiCard HISTORY_SERIES). */
const PATH_TO_FI_HISTORY_SERIES = [
  {
    dataKey: 'target',
    label: 'Target',
    color: CHART_NEUTRAL,
    strokeDasharray: '2 2',
    strokeWidth: 1.5,
  },
  { dataKey: 'p50', label: 'Median (p50)', color: 'hsl(var(--foreground))', strokeWidth: 2.5 },
];

/** CompoundInterestCard's History wiring (one line series). */
const COMPOUND_HISTORY_SERIES = [
  { dataKey: 'p50', label: 'Median (p50)', color: 'hsl(var(--foreground))', strokeWidth: 2.5 },
];

const ROWS = [0, 1, 2, 3, 4].map((k) => ({
  year: k,
  fanFloor: 100_000 + k * 5_000,
  fan2575: 20_000,
  p50: 110_000 + k * 6_000,
  target: 600_000,
}));

/** Every legend region on the page: recharts' own wrapper + the hand-rolled one. */
function legendRegions(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      '.recharts-legend-wrapper, [data-testid="history-fan-legend"]',
    ),
  );
}

function rechartsLegendItems(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>('.recharts-legend-wrapper li'),
  ).map((li) => li.textContent ?? '');
}

describe('InlineChart against REAL recharts — the fan never reaches a legend', () => {
  it('PathToFi History composition renders ONE legend, and it names no fan dataKey', () => {
    const { container } = render(
      <>
        <InlineChart
          label="Path to FI — history (today's $)"
          testId="probe-chart"
          data={ROWS}
          xKey="year"
          series={PATH_TO_FI_HISTORY_SERIES}
          fan={HISTORY_FAN_KEYS}
        />
        <HistoryFanLegend series={PATH_TO_FI_HISTORY_SERIES} />
      </>,
    );
    // recharts must not mount its own legend beside the hand-rolled one (D-P3).
    expect(rechartsLegendItems(container)).toEqual([]);
    expect(legendRegions(container)).toHaveLength(1);

    const legend = container.querySelector<HTMLElement>('[data-testid="history-fan-legend"]')!;
    const text = legend.textContent ?? '';
    expect(text).not.toContain('fanFloor');
    expect(text).not.toContain('fan2575');
    // CH-9 band + median, then the chart's remaining line series (D-P3).
    expect(
      Array.from(legend.querySelectorAll(':scope > span')).map((s) => s.textContent?.trim()),
    ).toEqual(['25th–75th percentile', 'Median (p50)', 'Target']);
  });

  it('Compound History composition: one legend, band + median only (no line duplicate)', () => {
    const { container } = render(
      <>
        <InlineChart
          label="Balance over time — history (today's $)"
          testId="probe-chart"
          data={ROWS}
          xKey="year"
          series={COMPOUND_HISTORY_SERIES}
          fan={HISTORY_FAN_KEYS}
        />
        <HistoryFanLegend series={COMPOUND_HISTORY_SERIES} />
      </>,
    );
    expect(rechartsLegendItems(container)).toEqual([]);
    expect(legendRegions(container)).toHaveLength(1);
    const legend = container.querySelector<HTMLElement>('[data-testid="history-fan-legend"]')!;
    expect(
      Array.from(legend.querySelectorAll(':scope > span')).map((s) => s.textContent?.trim()),
    ).toEqual(['25th–75th percentile', 'Median (p50)']);
  });

  it('control: a fan-less multi-series chart keeps its recharts legend (labels, not keys)', () => {
    const { container } = render(
      <InlineChart
        testId="probe-chart"
        data={ROWS}
        xKey="year"
        series={PATH_TO_FI_HISTORY_SERIES}
      />,
    );
    expect(rechartsLegendItems(container).sort()).toEqual(['Median (p50)', 'Target']);
  });
});
