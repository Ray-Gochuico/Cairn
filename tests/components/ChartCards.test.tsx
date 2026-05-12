import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import LineChartCard from '@/components/charts/LineChartCard';
import DonutChartCard from '@/components/charts/DonutChartCard';
import BarChartCard from '@/components/charts/BarChartCard';

// Recharts' ResponsiveContainer measures its parent in jsdom (which reports 0x0),
// so the inner SVG won't always render. We wrap each chart in a fixed-size
// container and assert on the Card wrapper (CardTitle text) — sufficient to
// verify the component mounts without throwing.
function Frame({ children }: { children: React.ReactNode }) {
  return <div style={{ width: 600, height: 300 }}>{children}</div>;
}

describe('Chart cards', () => {
  it('LineChartCard mounts with one series', () => {
    const { getByText } = render(
      <Frame>
        <LineChartCard
          title="Net Worth"
          subtitle="Last 12 months"
          data={[
            { month: '2024-01', value: 100 },
            { month: '2024-02', value: 110 },
          ]}
          xKey="month"
          series={[{ dataKey: 'value', label: 'Value' }]}
        />
      </Frame>
    );
    expect(getByText('Net Worth')).toBeTruthy();
    expect(getByText('Last 12 months')).toBeTruthy();
  });

  it('DonutChartCard mounts with multiple slices', () => {
    const { getByText } = render(
      <Frame>
        <DonutChartCard
          title="Allocation"
          data={[
            { name: 'Stocks', value: 70 },
            { name: 'Bonds', value: 30 },
          ]}
        />
      </Frame>
    );
    expect(getByText('Allocation')).toBeTruthy();
  });

  it('BarChartCard mounts horizontally with one series', () => {
    const { getByText } = render(
      <Frame>
        <BarChartCard
          title="Contributions"
          data={[
            { month: '2024-01', amount: 1000 },
            { month: '2024-02', amount: 1200 },
          ]}
          xKey="month"
          series={[{ dataKey: 'amount', label: 'Amount' }]}
        />
      </Frame>
    );
    expect(getByText('Contributions')).toBeTruthy();
  });

  it('BarChartCard mounts in vertical layout', () => {
    const { getByText } = render(
      <Frame>
        <BarChartCard
          title="By Asset Class"
          data={[
            { class: 'US Equity', value: 5000 },
            { class: 'Intl Equity', value: 2000 },
          ]}
          xKey="class"
          series={[{ dataKey: 'value', label: 'Value' }]}
          layout="vertical"
        />
      </Frame>
    );
    expect(getByText('By Asset Class')).toBeTruthy();
  });
});
