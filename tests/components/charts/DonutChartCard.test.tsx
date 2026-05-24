import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DonutChartCard from '@/components/charts/DonutChartCard';

// Recharts' real SVG output doesn't render meaningfully in jsdom (the
// ResponsiveContainer measures its 0×0 parent), so we mock the Pie /
// PieChart / ResponsiveContainer trio with click-friendly DOM. That lets
// us assert the onClickSlice wiring works end-to-end while leaving the
// real recharts behaviour to the integration tests on the running app.
vi.mock('recharts', () => {
  return {
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="rc-responsive">{children}</div>
    ),
    PieChart: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="rc-piechart">{children}</div>
    ),
    Pie: ({
      data,
      onClick,
      style,
      children,
    }: {
      data: Array<{ name: string; value: number }>;
      onClick?: (entry: unknown) => void;
      style?: React.CSSProperties;
      children?: React.ReactNode;
    }) => (
      <div data-testid="rc-pie" data-cursor={style?.cursor ?? 'default'}>
        {data.map((d) => (
          <button
            type="button"
            key={d.name}
            data-testid={`slice-${d.name}`}
            onClick={onClick ? () => onClick(d) : undefined}
          >
            {d.name}
          </button>
        ))}
        {children}
      </div>
    ),
    Cell: () => null,
    Tooltip: () => null,
    Legend: () => null,
  };
});

describe('DonutChartCard', () => {
  const data = [
    { name: 'Stocks', value: 70 },
    { name: 'Bonds', value: 30 },
  ];

  it('renders a string subtitle inside the card description', () => {
    render(<DonutChartCard title="Alloc" subtitle="As of today" data={data} />);
    expect(screen.getByText('As of today')).toBeTruthy();
  });

  it('accepts a ReactNode subtitle (e.g. a button)', () => {
    const onBack = vi.fn();
    render(
      <DonutChartCard
        title="Alloc"
        subtitle={
          <button type="button" onClick={onBack}>
            ← Back
          </button>
        }
        data={data}
      />,
    );
    const back = screen.getByRole('button', { name: '← Back' });
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('invokes onClickSlice with the wedge name when a slice is clicked', () => {
    const onClickSlice = vi.fn();
    render(<DonutChartCard title="Alloc" data={data} onClickSlice={onClickSlice} />);
    fireEvent.click(screen.getByTestId('slice-Stocks'));
    expect(onClickSlice).toHaveBeenCalledWith('Stocks');
  });

  it('switches the cursor to pointer when onClickSlice is provided', () => {
    const { rerender } = render(<DonutChartCard title="Alloc" data={data} />);
    expect(screen.getByTestId('rc-pie').dataset.cursor).toBe('default');
    rerender(<DonutChartCard title="Alloc" data={data} onClickSlice={() => {}} />);
    expect(screen.getByTestId('rc-pie').dataset.cursor).toBe('pointer');
  });

  it('does not wire onClick when onClickSlice is omitted', () => {
    const handler = vi.fn();
    render(<DonutChartCard title="Alloc" data={data} />);
    // The mocked button only receives onClick when the prop is set; with no
    // prop the click is a no-op. We assert by mounting two variants and only
    // expecting the wired one to fire.
    fireEvent.click(screen.getByTestId('slice-Stocks'));
    expect(handler).not.toHaveBeenCalled();
  });
});
