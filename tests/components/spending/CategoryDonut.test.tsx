import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

  describe('a11y summary + sr-only listing (round-2 B2)', () => {
    const slices = [
      { name: 'Groceries', value: 300, color: '#111111' },
      { name: 'Dining', value: 80, color: '#222222' },
      { name: 'Transit', value: 15, color: '#333333' },
      { name: 'Fees', value: 5, color: '#444444' },
    ];

    it('exposes a role="img" one-sentence summary: top 3 by value + remainder count', () => {
      render(<CategoryDonut slices={slices} total={400} />);
      const img = screen.getByRole('img');
      expect(img).toHaveAccessibleName(
        'Spending by category: Groceries 75.0%, Dining 20.0%, Transit 3.8%, +1 more',
      );
    });

    it('renders an sr-only per-category list with value + share', () => {
      render(<CategoryDonut slices={slices} total={400} />);
      const list = screen.getByRole('list', { name: /spending by category/i });
      expect(list).toHaveClass('sr-only');
      const items = within(list).getAllByRole('listitem');
      expect(items).toHaveLength(4);
      expect(items[0]).toHaveTextContent('Groceries — $300 (75.0%)');
    });

    it('zero-total renders the bare title as the summary and no NaN shares', () => {
      render(<CategoryDonut slices={[]} total={0} />);
      expect(screen.getByRole('img')).toHaveAccessibleName('Spending by category');
      expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    });
  });
});
