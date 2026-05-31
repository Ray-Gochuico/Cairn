import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Recharts doesn't paint sectors in jsdom's 0×0 ResponsiveContainer, so we
// mock it (the repo's donut-test idiom) and reflect each Cell's `stroke` prop
// into a data attribute we can assert on.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="rc-responsive">{children}</div>
  ),
  PieChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="rc-piechart">{children}</div>
  ),
  Pie: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="rc-pie">{children}</div>
  ),
  Cell: ({ stroke }: { stroke?: string }) => (
    <span data-testid="rc-cell" data-stroke={stroke ?? ''} />
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
});
