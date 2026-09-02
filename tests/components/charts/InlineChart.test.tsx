import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => (
    <div data-testid="rc-responsive">{children}</div>
  ),
  LineChart: ({ children }: { children: ReactNode }) => (
    <svg data-testid="rc-line-chart">{children}</svg>
  ),
  ComposedChart: ({ children, data }: { children: ReactNode; data?: unknown[] }) => (
    <svg data-testid="rc-composed-chart" data-rows={JSON.stringify(data ?? [])}>
      {children}
    </svg>
  ),
  Area: (p: Record<string, unknown>) => (
    <g
      data-testid={`rc-area-${String(p.dataKey)}`}
      data-stack={String(p.stackId ?? '')}
      data-fill={String(p.fill ?? '')}
      data-fill-opacity={String(p.fillOpacity ?? '')}
      data-stroke={String(p.stroke ?? '')}
      data-animation={String(p.isAnimationActive)}
      data-tooltip-type={String(p.tooltipType ?? '')}
      data-legend-type={String(p.legendType ?? '')}
    />
  ),
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => <g data-testid="rc-legend" />,
  Line: ({
    dataKey,
    stroke,
    strokeWidth,
    isAnimationActive,
  }: {
    dataKey: string;
    stroke?: string;
    strokeWidth?: number;
    isAnimationActive?: boolean;
  }) => (
    <g
      data-testid={`line-${dataKey}`}
      data-stroke={stroke ?? ''}
      data-strokewidth={String(strokeWidth ?? '')}
      data-isanimationactive={String(isAnimationActive)}
    />
  ),
  ReferenceDot: ({
    x,
    y,
    shape,
  }: {
    x: string | number;
    y: number;
    shape?: unknown;
  }) => (
    <g
      data-testid="ref-dot"
      data-x={String(x)}
      data-y={String(y)}
      data-hasshape={String(shape != null)}
    />
  ),
}));

import { InlineChart } from '@/components/charts/InlineChart';

const DATA = [
  { year: 'Year 1', mid: 100, low: 90 },
  { year: 'Year 2', mid: 250, low: 180 },
];

describe('InlineChart', () => {
  it('renders the label as a small muted div, not Card chrome', () => {
    const { container } = render(
      <InlineChart
        label="Balance over time"
        data={DATA}
        xKey="year"
        series={[{ dataKey: 'mid', label: 'Balance' }]}
      />,
    );
    const label = screen.getByText('Balance over time');
    expect(label.tagName).toBe('DIV');
    expect(label).toHaveClass('text-xs');
    expect(label).toHaveClass('text-muted-foreground');
    // No Card chrome anywhere in the output.
    expect(container.querySelector('.bg-card')).toBeNull();
  });

  it('renders one Line per series with isAnimationActive={false}', () => {
    render(
      <InlineChart
        data={DATA}
        xKey="year"
        series={[
          { dataKey: 'mid', label: 'Mid' },
          { dataKey: 'low', label: 'Low' },
        ]}
      />,
    );
    expect(screen.getByTestId('line-mid')).toHaveAttribute('data-isanimationactive', 'false');
    expect(screen.getByTestId('line-low')).toHaveAttribute('data-isanimationactive', 'false');
  });

  it('a hero series gets the blaze stroke at 2.5px', () => {
    render(
      <InlineChart
        data={DATA}
        xKey="year"
        series={[{ dataKey: 'mid', label: 'Balance', hero: true }]}
      />,
    );
    const line = screen.getByTestId('line-mid');
    expect(line).toHaveAttribute('data-stroke', 'hsl(var(--blaze))');
    expect(line).toHaveAttribute('data-strokewidth', '2.5');
  });

  it('renders a cairn terminal ReferenceDot at the last row x/y for the hero series only', () => {
    render(
      <InlineChart
        data={DATA}
        xKey="year"
        series={[
          { dataKey: 'mid', label: 'Balance', hero: true },
          { dataKey: 'low', label: 'Low' },
        ]}
      />,
    );
    const dots = screen.getAllByTestId('ref-dot');
    expect(dots).toHaveLength(1);
    expect(dots[0]).toHaveAttribute('data-x', 'Year 2');
    expect(dots[0]).toHaveAttribute('data-y', '250');
    expect(dots[0]).toHaveAttribute('data-hasshape', 'true');
  });

  it('renders no terminal dot without a hero series', () => {
    render(
      <InlineChart
        data={DATA}
        xKey="year"
        series={[{ dataKey: 'mid', label: 'Balance' }]}
      />,
    );
    expect(screen.queryByTestId('ref-dot')).toBeNull();
  });

  it('renders markers as ReferenceDots without the cairn shape', () => {
    render(
      <InlineChart
        data={DATA}
        xKey="year"
        series={[{ dataKey: 'mid', label: 'Balance' }]}
        markers={[{ x: 'Year 1', y: 100, color: '#4c78a8' }]}
      />,
    );
    const dots = screen.getAllByTestId('ref-dot');
    expect(dots).toHaveLength(1);
    expect(dots[0]).toHaveAttribute('data-x', 'Year 1');
    expect(dots[0]).toHaveAttribute('data-hasshape', 'false');
  });
});

const FAN_DATA = [
  { year: 0, fanFloor: 100, fan2575: 50, p50: 120 },
  { year: 1, fanFloor: 110, fan2575: 60, p50: 140 },
];
const P50_SERIES = [
  { dataKey: 'p50', label: 'Median (p50)', color: 'hsl(var(--foreground))', strokeWidth: 2.5 },
];

describe('InlineChart fan (W2)', () => {
  it('the root is a ComposedChart carrying the rows (Line/ReferenceDot rendering unchanged)', () => {
    render(
      <InlineChart data={DATA} xKey="year" series={[{ dataKey: 'mid', label: 'Balance' }]} />,
    );
    expect(screen.getByTestId('rc-composed-chart')).toBeInTheDocument();
    expect(screen.queryByTestId('rc-line-chart')).toBeNull();
    expect(screen.getByTestId('line-mid')).toBeInTheDocument();
  });

  it('renders no Area when fan is omitted', () => {
    render(<InlineChart data={FAN_DATA} xKey="year" series={P50_SERIES} />);
    expect(screen.queryByTestId('rc-area-fanFloor')).toBeNull();
    expect(screen.queryByTestId('rc-area-fan2575')).toBeNull();
  });

  it('fan renders floor + delta in one stack with the band token (D-P2 tooltip/legend opt-out)', () => {
    render(
      <InlineChart
        data={FAN_DATA}
        xKey="year"
        series={P50_SERIES}
        fan={{ floorKey: 'fanFloor', deltaKey: 'fan2575' }}
      />,
    );
    const floor = screen.getByTestId('rc-area-fanFloor');
    const delta = screen.getByTestId('rc-area-fan2575');
    expect(floor.getAttribute('data-stack')).toBe('fan');
    expect(delta.getAttribute('data-stack')).toBe('fan');
    expect(floor.getAttribute('data-fill-opacity')).toBe('0');
    expect(floor.getAttribute('data-stroke')).toBe('none');
    expect(delta.getAttribute('data-fill')).toBe('hsl(var(--chart-band))');
    expect(delta.getAttribute('data-fill-opacity')).toBe('0.28');
    expect(delta.getAttribute('data-stroke')).toBe('none');
    for (const el of [floor, delta]) {
      expect(el.getAttribute('data-animation')).toBe('false');
      // D-P2 / R3: a stacked delta is NOT a balance. The tooltip is the stratum
      // the basis-audit render sweep cannot see, so both Areas opt out of it
      // (and of the legend, which the hand-rolled HistoryFanLegend owns).
      expect(el.getAttribute('data-tooltip-type')).toBe('none');
      expect(el.getAttribute('data-legend-type')).toBe('none');
    }
    // Lines still render beside the fan:
    expect(screen.getByTestId('line-p50')).toBeInTheDocument();
  });
});
