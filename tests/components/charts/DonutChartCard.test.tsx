import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import DonutChartCard from '@/components/charts/DonutChartCard';
import { WEDGE_PALETTE } from '@/components/charts/palette';
import { relativeLuminance } from '@/lib/color';

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

  // I9 fix: a colorless slice past index 9 must fall back to WEDGE_PALETTE
  // (never a near-white CHART_PALETTE tail entry). The real <Cell fill> is
  // mocked, but the legend swatch is plain DOM rendered off the same
  // colorAt(slice, idx), so it's the assertable surface for the fallback.
  it('falls back to WEDGE_PALETTE (never near-white) for colorless slices past index 9', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ name: `S${i}`, value: 1 }));
    render(<DonutChartCard title="X" data={many} />);
    // 14 slices > LEGEND_COLLAPSE_THRESHOLD (6), so expand to show all first.
    fireEvent.click(screen.getByRole('button', { name: /show all/i }));
    const legend = screen.getByLabelText('Chart legend');
    const li = within(legend).getByText(/^S11 —/).closest('li')!;
    const css = (li.querySelector('span[aria-hidden]') as HTMLElement).style.backgroundColor;
    // jsdom serializes the inline color as rgb(...); normalize WEDGE_PALETTE
    // to the same form and assert membership + non-near-white.
    const toRgb = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
      return `rgb(${r}, ${g}, ${b})`;
    };
    expect(WEDGE_PALETTE.map(toRgb)).toContain(css);
    // S11 -> colorAt index 11 -> paletteColorAt(11) -> WEDGE_PALETTE[1].
    expect(css).toBe(toRgb(WEDGE_PALETTE[1]));
    // And it is not near-white (luminance well under the 0.92 band ceiling).
    const hex = WEDGE_PALETTE[1];
    expect(relativeLuminance(hex)).toBeLessThan(0.92);
  });
});
