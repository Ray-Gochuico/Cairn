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
