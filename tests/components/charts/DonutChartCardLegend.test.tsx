import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The legend is plain DOM rendered by DonutChartCard itself (not recharts),
// so this mock only has to render without throwing — the donut SVG isn't
// under test here. Mirrors the repo's recharts-mock idiom.
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
  Legend: () => null,
}));

import DonutChartCard from '@/components/charts/DonutChartCard';

const slices = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ name: `S${i}`, value: 1 }));

describe('DonutChartCard legend collapse (B1)', () => {
  it('renders no legend at all when data is empty', () => {
    render(<DonutChartCard title="t" data={[]} />);
    expect(screen.queryByLabelText('Chart legend')).toBeNull();
  });

  it('at exactly 6 items shows all 6 and no toggle', () => {
    render(<DonutChartCard title="t" data={slices(6)} />);
    const legend = screen.getByLabelText('Chart legend');
    expect(within(legend).getAllByRole('listitem')).toHaveLength(6);
    expect(within(legend).getByText(/^S5 —/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /show all/i })).toBeNull();
  });

  it('at 7 items shows the first 5 plus a "Show all (7)" toggle', () => {
    render(<DonutChartCard title="t" data={slices(7)} />);
    const legend = screen.getByLabelText('Chart legend');
    expect(within(legend).getAllByRole('listitem')).toHaveLength(5);
    expect(within(legend).getByText(/^S4 —/)).toBeTruthy();
    expect(within(legend).queryByText(/^S5 —/)).toBeNull();
    const toggle = screen.getByRole('button', { name: 'Show all (7)' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('expanding reveals all 7 items and flips the toggle to "Show less"', async () => {
    const user = userEvent.setup();
    render(<DonutChartCard title="t" data={slices(7)} />);
    await user.click(screen.getByRole('button', { name: 'Show all (7)' }));
    const legend = screen.getByLabelText('Chart legend');
    expect(within(legend).getAllByRole('listitem')).toHaveLength(7);
    expect(within(legend).getByText(/^S6 —/)).toBeTruthy();
    const toggle = screen.getByRole('button', { name: 'Show less' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('collapsing returns to the first 5 and restores "Show all (7)"', async () => {
    const user = userEvent.setup();
    render(<DonutChartCard title="t" data={slices(7)} />);
    await user.click(screen.getByRole('button', { name: 'Show all (7)' }));
    await user.click(screen.getByRole('button', { name: 'Show less' }));
    const legend = screen.getByLabelText('Chart legend');
    expect(within(legend).getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'Show all (7)' })).toBeTruthy();
  });

  it('resets expanded→false when data shrinks back to ≤6', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<DonutChartCard title="t" data={slices(7)} />);
    await user.click(screen.getByRole('button', { name: 'Show all (7)' }));
    expect(screen.getByRole('button', { name: 'Show less' })).toBeTruthy();
    // Data drops to 6 → toggle disappears and all 6 show (no stale expanded).
    rerender(<DonutChartCard title="t" data={slices(6)} />);
    expect(screen.queryByRole('button', { name: /show (all|less)/i })).toBeNull();
    const legend = screen.getByLabelText('Chart legend');
    expect(within(legend).getAllByRole('listitem')).toHaveLength(6);
    // And re-growing past threshold starts collapsed again, not expanded.
    rerender(<DonutChartCard title="t" data={slices(7)} />);
    expect(screen.getByRole('button', { name: 'Show all (7)' })).toBeTruthy();
    expect(within(screen.getByLabelText('Chart legend')).getAllByRole('listitem')).toHaveLength(5);
  });
});

describe('legend value + share % (protected-views upgrade)', () => {
  const valueSlices = [
    { name: 'AAPL', value: 400 },
    { name: 'MSFT', value: 100 },
  ];

  it('renders value and share per legend row, formatted via valueFormatter', () => {
    render(
      <DonutChartCard title="T" data={valueSlices} valueFormatter={(v) => `$${v}`} />,
    );
    expect(screen.getByText(/\$400 · 80\.0%/)).toBeInTheDocument();
    expect(screen.getByText(/\$100 · 20\.0%/)).toBeInTheDocument();
  });

  it('anchors share to shareTotal when provided (hidden slices do not re-normalize)', () => {
    render(
      <DonutChartCard title="T" data={valueSlices} valueFormatter={(v) => `$${v}`} shareTotal={1000} />,
    );
    // 400/1000 and 100/1000 — NOT 400/500.
    expect(screen.getByText(/\$400 · 40\.0%/)).toBeInTheDocument();
    expect(screen.getByText(/\$100 · 10\.0%/)).toBeInTheDocument();
  });

  it('exposes the chart as role="img" with a top-slices summary label', () => {
    render(<DonutChartCard title="Sector exposure" data={valueSlices} shareTotal={1000} />);
    const img = screen.getByRole('img');
    expect(img).toHaveAccessibleName('Sector exposure: AAPL 40.0%, MSFT 10.0%');
  });

  it('legend rows are buttons wired to onClickSlice when provided; plain text otherwise', async () => {
    const onClickSlice = vi.fn();
    const { unmount } = render(
      <DonutChartCard title="T" data={valueSlices} onClickSlice={onClickSlice} />,
    );
    await userEvent.click(screen.getByRole('button', { name: /AAPL/ }));
    expect(onClickSlice).toHaveBeenCalledWith('AAPL');
    unmount();
    render(<DonutChartCard title="T" data={valueSlices} />);
    expect(screen.queryByRole('button', { name: /AAPL/ })).not.toBeInTheDocument();
  });
});
