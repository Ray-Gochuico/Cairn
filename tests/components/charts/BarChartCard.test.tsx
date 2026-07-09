import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import BarChartCard from '@/components/charts/BarChartCard';

// Mock recharts so bar chart renders to inspectable DOM in jsdom.
// XAxis and YAxis capture their props so we can assert interval / formatter wiring.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="rc-responsive">{children}</div>
  ),
  BarChart: ({ children, data }: { children: React.ReactNode; data: unknown }) => (
    <div data-testid="rc-barchart" data-rows={JSON.stringify(data)}>
      {children}
    </div>
  ),
  Bar: ({ dataKey, name, stackId, fill }: { dataKey: string; name: string; stackId?: string; fill: string }) => (
    <div
      data-testid={`bar-${dataKey}`}
      data-name={name}
      data-stackid={stackId ?? ''}
      data-fill={fill}
    />
  ),
  CartesianGrid: () => null,
  XAxis: ({
    interval,
    tickFormatter,
  }: {
    interval?: number | string;
    tickFormatter?: (value: unknown) => string;
  }) => (
    <div
      data-testid="rc-xaxis"
      data-interval={interval !== undefined ? String(interval) : 'default'}
      data-has-formatter={tickFormatter ? 'yes' : 'no'}
      // Emit a sample formatted value so we can assert the formatter output
      data-sample-tick={tickFormatter ? tickFormatter('2026-01') : 'raw'}
    />
  ),
  YAxis: ({
    tickFormatter,
  }: {
    tickFormatter?: (value: number) => string;
  }) => (
    <div
      data-testid="rc-yaxis"
      data-has-formatter={tickFormatter ? 'yes' : 'no'}
      // Emit formatted values for $0 (zero), $500 (sub-$1k), $2000 (over $1k)
      data-fmt-zero={tickFormatter ? tickFormatter(0) : 'raw'}
      data-fmt-sub1k={tickFormatter ? tickFormatter(500) : 'raw'}
      data-fmt-over1k={tickFormatter ? tickFormatter(2000) : 'raw'}
    />
  ),
  Tooltip: () => null,
  Legend: () => null,
}));

const SERIES = [{ dataKey: 'value', label: 'Value' }];

function makeData(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    month: `2026-${String(i + 1).padStart(2, '0')}`,
    value: (i + 1) * 100,
  }));
}

describe('BarChartCard', () => {
  describe('xAxisInterval prop', () => {
    it('defaults to recharts default (no interval prop) when xAxisInterval is not set', () => {
      render(
        <BarChartCard
          title="Test"
          data={makeData(12)}
          xKey="month"
          series={SERIES}
        />,
      );
      const xAxis = screen.getByTestId('rc-xaxis');
      // Without the prop, we pass no interval — recharts uses its own default
      expect(xAxis.dataset.interval).toBe('default');
    });

    it('passes xAxisInterval=0 through to XAxis so all 12 ticks are shown', () => {
      render(
        <BarChartCard
          title="Test"
          data={makeData(12)}
          xKey="month"
          series={SERIES}
          xAxisInterval={0}
        />,
      );
      const xAxis = screen.getByTestId('rc-xaxis');
      expect(xAxis.dataset.interval).toBe('0');
    });

    it('passes xAxisInterval=1 through to XAxis', () => {
      render(
        <BarChartCard
          title="Test"
          data={makeData(12)}
          xKey="month"
          series={SERIES}
          xAxisInterval={1}
        />,
      );
      const xAxis = screen.getByTestId('rc-xaxis');
      expect(xAxis.dataset.interval).toBe('1');
    });
  });

  describe('xTickFormatter prop', () => {
    it('does not set a tick formatter on XAxis when xTickFormatter is not provided', () => {
      render(
        <BarChartCard
          title="Test"
          data={makeData(3)}
          xKey="month"
          series={SERIES}
        />,
      );
      const xAxis = screen.getByTestId('rc-xaxis');
      expect(xAxis.dataset.hasFormatter).toBe('no');
    });

    it('passes xTickFormatter through to XAxis tickFormatter', () => {
      const fmt = (v: unknown) => String(v).slice(5, 7) + '/26'; // e.g. "01/26"
      render(
        <BarChartCard
          title="Test"
          data={makeData(3)}
          xKey="month"
          series={SERIES}
          xTickFormatter={fmt}
        />,
      );
      const xAxis = screen.getByTestId('rc-xaxis');
      expect(xAxis.dataset.hasFormatter).toBe('yes');
      // The mock emits xTickFormatter('2026-01') as data-sample-tick
      expect(xAxis.dataset.sampleTick).toBe('01/26');
    });
  });

  describe('emptyMessage (Wave 11 T11)', () => {
    it('shows the message and does NOT mount the chart when every value is 0', () => {
      const zeros = [
        { month: '2026-01', value: 0 },
        { month: '2026-02', value: 0 },
      ];
      render(
        <BarChartCard
          title="Contributions"
          data={zeros}
          xKey="month"
          series={SERIES}
          emptyMessage="No contributions yet"
        />,
      );
      expect(screen.getByText('No contributions yet')).toBeInTheDocument();
      expect(screen.queryByTestId('rc-barchart')).not.toBeInTheDocument();
    });

    it('renders the chart (no message) when there is real data', () => {
      render(
        <BarChartCard
          title="Contributions"
          data={makeData(3)}
          xKey="month"
          series={SERIES}
          emptyMessage="No contributions yet"
        />,
      );
      expect(screen.queryByText('No contributions yet')).not.toBeInTheDocument();
      expect(screen.getByTestId('rc-barchart')).toBeInTheDocument();
    });
  });
});
