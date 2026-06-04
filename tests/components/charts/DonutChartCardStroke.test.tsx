import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Recharts doesn't paint sectors in jsdom's 0×0 ResponsiveContainer, so we
// mock it (the repo's donut-test idiom) and reflect the Pie's minAngle and
// each Cell's stroke/strokeWidth props into data attributes we can assert on.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="rc-responsive">{children}</div>
  ),
  PieChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="rc-piechart">{children}</div>
  ),
  Pie: ({
    minAngle,
    children,
  }: {
    minAngle?: number;
    children?: React.ReactNode;
  }) => (
    <div data-testid="rc-pie" data-min-angle={minAngle ?? ''}>
      {children}
    </div>
  ),
  Cell: ({ stroke, strokeWidth }: { stroke?: string; strokeWidth?: number }) => (
    <span
      data-testid="rc-cell"
      data-stroke={stroke ?? ''}
      data-stroke-width={strokeWidth ?? ''}
    />
  ),
  Tooltip: () => null,
  Legend: () => null,
}));

import DonutChartCard from '@/components/charts/DonutChartCard';

describe('DonutChartCard wedge stroke (W4)', () => {
  it('passes stroke="hsl(var(--card))" to every Cell so wedge borders follow the card bg', () => {
    render(
      <DonutChartCard
        title="t"
        data={[
          { name: 'A', value: 60 },
          { name: 'B', value: 40 },
        ]}
      />,
    );
    const cells = screen.getAllByTestId('rc-cell');
    expect(cells).toHaveLength(2);
    cells.forEach((c) => {
      expect(c.getAttribute('data-stroke')).toBe('hsl(var(--card))');
    });
  });

  it('sets minAngle={2} on the Pie so thin wedges stay visible (B2)', () => {
    render(
      <DonutChartCard
        title="t"
        data={[
          { name: 'A', value: 99 },
          { name: 'B', value: 1 },
        ]}
      />,
    );
    expect(screen.getByTestId('rc-pie').getAttribute('data-min-angle')).toBe('2');
  });

  it('keeps the --card stroke as a 1px hairline (strokeWidth={1}) on every Cell (B2)', () => {
    render(
      <DonutChartCard
        title="t"
        data={[
          { name: 'A', value: 60 },
          { name: 'B', value: 40 },
        ]}
      />,
    );
    const cells = screen.getAllByTestId('rc-cell');
    expect(cells).toHaveLength(2);
    cells.forEach((c) => {
      expect(c.getAttribute('data-stroke-width')).toBe('1');
    });
  });
});
