import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CHART_NEUTRAL, paletteColorAt } from '@/components/charts/palette';

// The center overlay + color decoration are plain DOM/logic; the donut SVG
// isn't under test in jsdom. Mirrors the repo's recharts-mock idiom.
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
  Cell: () => null,
  Tooltip: () => null,
}));

import { CategoryDonut, withCategoryColors } from '@/components/spending/CategoryDonut';

describe('CategoryDonut', () => {
  const slices = [
    { name: 'Groceries', value: 300, color: 'hsl(var(--chart-1))' },
    { name: 'Transit', value: 100, color: 'hsl(var(--chart-2))' },
  ];

  it('renders the center label + formatted total', () => {
    render(<CategoryDonut slices={slices} total={400} centerTestId="hero-center" />);
    const center = screen.getByTestId('hero-center');
    expect(center).toHaveTextContent('Total spending');
    expect(center).toHaveTextContent('$400');
  });

  it('withCategoryColors: overrides win, uncategorized gets the neutral token, others get palette colors', () => {
    const rows = withCategoryColors([
      { categoryId: 1, name: 'A', total: 5, color: '#abc', count: 1 },
      { categoryId: null, name: 'Uncategorized', total: 5, color: null, count: 1 },
      { categoryId: 2, name: 'B', total: 5, color: null, count: 1 },
    ] as never);
    expect(rows[0].chartColor).toBe('#abc');
    expect(rows[1].chartColor).toBe(CHART_NEUTRAL);
    expect(rows[2].chartColor).toBe(paletteColorAt(2));
  });
});
