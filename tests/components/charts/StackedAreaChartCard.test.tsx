import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import StackedAreaChartCard from '@/components/charts/StackedAreaChartCard';

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="rc-responsive">{children}</div>
  ),
  AreaChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="rc-areachart">{children}</div>
  ),
  Area: (props: { dataKey: string; stackId?: string; name?: string }) => (
    <div
      data-testid={`rc-area-${props.dataKey}`}
      data-stackid={props.stackId ?? ''}
      data-name={props.name ?? ''}
    />
  ),
  CartesianGrid: () => null,
  XAxis: ({ tickFormatter }: { tickFormatter?: (v: unknown) => string }) => (
    <div data-testid="rc-xaxis" data-sample={tickFormatter ? tickFormatter('2026-01') : 'raw'} />
  ),
  YAxis: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

const SERIES = [
  { dataKey: 'MORTGAGE', label: 'Mortgage' },
  { dataKey: 'AUTO', label: 'Auto' },
];
const DATA = [
  { month: '2026-01', MORTGAGE: 300000, AUTO: 20000 },
  { month: '2026-02', MORTGAGE: 299000, AUTO: 19500 },
];

describe('StackedAreaChartCard (Wave 11 T12)', () => {
  it('renders one stacked Area per series, all sharing a stackId', () => {
    render(<StackedAreaChartCard title="Debt" data={DATA} xKey="month" series={SERIES} />);
    const mortgage = screen.getByTestId('rc-area-MORTGAGE');
    const auto = screen.getByTestId('rc-area-AUTO');
    expect(mortgage.dataset.stackid).toBe('stack');
    expect(auto.dataset.stackid).toBe('stack');
    expect(mortgage.dataset.name).toBe('Mortgage');
  });

  it('applies the x tick formatter', () => {
    render(
      <StackedAreaChartCard
        title="Debt"
        data={DATA}
        xKey="month"
        series={SERIES}
        xTickFormatter={(m) => `X${String(m)}`}
      />,
    );
    expect(screen.getByTestId('rc-xaxis').dataset.sample).toBe('X2026-01');
  });

  it('shows the empty message and no chart when all values are 0', () => {
    render(
      <StackedAreaChartCard
        title="Debt"
        data={[{ month: '2026-01', MORTGAGE: 0, AUTO: 0 }]}
        xKey="month"
        series={SERIES}
        emptyMessage="No debt"
      />,
    );
    expect(screen.getByText('No debt')).toBeInTheDocument();
    expect(screen.queryByTestId('rc-areachart')).not.toBeInTheDocument();
  });
});
