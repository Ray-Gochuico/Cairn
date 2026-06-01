/**
 * a11y T7 finding 4 — LineChartCard strokeDasharray opt-in.
 *
 * WCAG 1.4.1: information must not be conveyed by colour alone. The line chart
 * series in FI/CoastFI/CompoundInterest/EquityValue distinguish trajectories
 * by colour only. Fix: add an optional `strokeDasharray` to LineChartSeries
 * (default undefined → solid). Consumers opt in by setting the field; existing
 * consumers (NetWorth, non-calculator charts) are unaffected (no opt-in = solid).
 *
 * Strategy: test the LineChartCard TYPE interface directly — the contract is
 * that `strokeDasharray` is optional on `LineChartSeries`. We also render the
 * component with/without the prop to confirm no TS errors and no runtime throws.
 * The recharts <Line> doesn't render an SVG `stroke-dasharray` in jsdom
 * (ResponsiveContainer measures at 0x0), so we assert TypeScript-level contract
 * via the exported interface + mount-without-throw assertions.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import LineChartCard, { type LineChartSeries } from '@/components/charts/LineChartCard';

function Frame({ children }: { children: React.ReactNode }) {
  return <div style={{ width: 600, height: 300 }}>{children}</div>;
}

const BASE_DATA = [{ x: 0, a: 1, b: 2 }, { x: 1, a: 3, b: 4 }];

describe('LineChartCard — strokeDasharray opt-in (a11y T7 finding 4)', () => {
  it('LineChartSeries type accepts an optional strokeDasharray field', () => {
    // TypeScript compile-time check: both forms must be valid.
    const solid: LineChartSeries = { dataKey: 'a', label: 'A' };
    const dashed: LineChartSeries = { dataKey: 'b', label: 'B', strokeDasharray: '5 5' };
    const dotted: LineChartSeries = { dataKey: 'c', label: 'C', strokeDasharray: '2 2' };

    // Runtime check: the property is defined as expected.
    expect(solid.strokeDasharray).toBeUndefined();
    expect(dashed.strokeDasharray).toBe('5 5');
    expect(dotted.strokeDasharray).toBe('2 2');
  });

  it('mounts without error when series have no strokeDasharray (backward compat)', () => {
    const { getByText } = render(
      <Frame>
        <LineChartCard
          title="Solid Series"
          data={BASE_DATA}
          xKey="x"
          series={[{ dataKey: 'a', label: 'A' }]}
        />
      </Frame>,
    );
    expect(getByText('Solid Series')).toBeTruthy();
  });

  it('mounts without error when some series opt into strokeDasharray', () => {
    const { getByText } = render(
      <Frame>
        <LineChartCard
          title="Mixed Dash"
          data={BASE_DATA}
          xKey="x"
          series={[
            { dataKey: 'a', label: 'Solid' },
            { dataKey: 'b', label: 'Dashed', strokeDasharray: '5 5' },
          ]}
        />
      </Frame>,
    );
    expect(getByText('Mixed Dash')).toBeTruthy();
  });

  it('mounts without error when all series opt into distinct dash patterns', () => {
    const { getByText } = render(
      <Frame>
        <LineChartCard
          title="All Dashed"
          data={[{ x: 0, a: 1, b: 2, c: 3 }]}
          xKey="x"
          series={[
            { dataKey: 'a', label: 'A' },
            { dataKey: 'b', label: 'B', strokeDasharray: '5 5' },
            { dataKey: 'c', label: 'C', strokeDasharray: '2 2' },
          ]}
        />
      </Frame>,
    );
    expect(getByText('All Dashed')).toBeTruthy();
  });

  it('series-level strokeDasharray is distinct from the CartesianGrid strokeDasharray', () => {
    // The series strokeDasharray (per-series opt-in) must be on LineChartSeries,
    // NOT on the grid. Verify the series interface shape is correct.
    const seriesWithDash: LineChartSeries = { dataKey: 'x', label: 'X', strokeDasharray: '5 5' };
    expect(seriesWithDash).toHaveProperty('strokeDasharray', '5 5');
    expect(seriesWithDash).toHaveProperty('dataKey', 'x');
    expect(seriesWithDash).toHaveProperty('label', 'X');
  });
});
