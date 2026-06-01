import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Recharts' ResponsiveContainer measures its 0×0 parent in jsdom and emits no
// concrete SVG — mock the small set of primitives used in BacktestChart so we
// can assert which branches rendered. Element tags appear in the DOM with
// data-testid / data-key attributes mirroring their recharts role.
// This is Option A (pure Recharts) — NO canvas shims / NO tests/setup.ts edits
// required (per the committed perf-spike decision doc).
vi.mock('recharts', () => {
  const passthrough =
    (testId: string) =>
    ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': testId }, children);

  return {
    ResponsiveContainer: passthrough('rc-responsive'),
    LineChart: passthrough('rc-linechart'),
    ComposedChart: passthrough('rc-composed'),
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    Line: (props: {
      dataKey: string;
      stroke?: string;
      strokeOpacity?: number;
      strokeDasharray?: string;
      strokeWidth?: number;
    }) =>
      React.createElement('div', {
        className: 'recharts-line-curve',
        'data-key': props.dataKey,
        'data-testid': `rc-line-${props.dataKey}`,
        'data-stroke': props.stroke ?? '',
        'data-stroke-opacity': String(props.strokeOpacity ?? 1),
        'data-stroke-dasharray': props.strokeDasharray ?? '',
        'data-stroke-width': String(props.strokeWidth ?? 1),
      }),
    Area: (props: {
      dataKey: string;
      fill?: string;
      fillOpacity?: number;
      stackId?: string;
    }) =>
      React.createElement('div', {
        className: 'recharts-area-area',
        'data-key': props.dataKey,
        'data-testid': `rc-area-${props.dataKey}`,
        'data-fill': props.fill ?? '',
        'data-fill-opacity': String(props.fillOpacity ?? 1),
        'data-stack': props.stackId ?? '',
      }),
  };
});

// Import AFTER mocking recharts.
import BacktestChart, { type BacktestChartProps } from '@/components/backtest/BacktestChart';
import type { BacktestResult } from '@/lib/backtest/types';

// ── Fixture helpers ───────────────────────────────────────────────────────────
function makeResult(overrides: Partial<BacktestResult> = {}): BacktestResult {
  const horizonYears = 5;
  const annualBalances = Array.from({ length: horizonYears + 1 }, (_, i) =>
    Math.max(0, 1_000_000 - i * 50_000),
  );

  const outcomes = [
    { startYear: 1990, annualBalances, endingBalance: annualBalances[horizonYears], tier: 'met' as const, depletedYear: null },
    { startYear: 1995, annualBalances: annualBalances.map((v) => v * 0.9), endingBalance: annualBalances[horizonYears] * 0.9, tier: 'below' as const, depletedYear: null },
    { startYear: 2000, annualBalances: annualBalances.map((_, i) => Math.max(0, 800_000 - i * 200_000)), endingBalance: 0, tier: 'depleted' as const, depletedYear: 4 },
  ];

  const p50 = annualBalances.map((v) => v * 0.95);
  const p10 = annualBalances.map((v) => v * 0.6);
  const p25 = annualBalances.map((v) => v * 0.75);
  const p75 = annualBalances.map((v) => v * 1.1);
  const p90 = annualBalances.map((v) => v * 1.2);

  return {
    outcomes,
    startYears: { first: 1990, last: 2000, count: 3 },
    goalMetCount: 1,
    survivedCount: 2,
    tierCounts: { met: 1, below: 1, depleted: 1 },
    belowGoal: [
      { startYear: 1995, endingBalance: annualBalances[horizonYears] * 0.9, tier: 'below' },
      { startYear: 2000, endingBalance: 0, tier: 'depleted' },
    ],
    endings: {
      worst: { value: 0, startYear: 2000, depletedYear: 4 },
      median: p50[horizonYears],
      best: { value: annualBalances[horizonYears], startYear: 1990 },
    },
    percentilesByYear: { p10, p25, p50, p75, p90 },
    ...overrides,
  };
}

const defaultProps: BacktestChartProps = {
  result: makeResult(),
  goalAmount: 1_000_000,
  worstStartYear: 2000,
};

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('BacktestChart — top-level structure', () => {
  it('renders with data-testid="backtest-chart"', () => {
    render(<BacktestChart {...defaultProps} />);
    expect(screen.getByTestId('backtest-chart')).toBeInTheDocument();
  });

  it('defaults to Lines mode (data-mode="lines")', () => {
    render(<BacktestChart {...defaultProps} />);
    expect(screen.getByTestId('backtest-chart')).toHaveAttribute('data-mode', 'lines');
  });

  it('renders the Lines / Bands mode toggle buttons', () => {
    render(<BacktestChart {...defaultProps} />);
    expect(screen.getByTestId('backtest-mode-lines')).toBeInTheDocument();
    expect(screen.getByTestId('backtest-mode-bands')).toBeInTheDocument();
  });

  it('Lines button has aria-pressed=true in default (lines) mode', () => {
    render(<BacktestChart {...defaultProps} />);
    expect(screen.getByTestId('backtest-mode-lines')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('backtest-mode-bands')).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('BacktestChart — Lines mode', () => {
  it('renders the LineChart wrapper', () => {
    render(<BacktestChart {...defaultProps} />);
    expect(screen.getByTestId('rc-linechart')).toBeInTheDocument();
  });

  it('renders a Line per outcome start year', () => {
    const result = makeResult();
    render(<BacktestChart {...defaultProps} result={result} />);
    for (const o of result.outcomes) {
      expect(screen.getByTestId(`rc-line-y${o.startYear}`)).toBeInTheDocument();
    }
  });

  it('renders the median (p50) line', () => {
    render(<BacktestChart {...defaultProps} />);
    expect(screen.getByTestId('rc-line-p50')).toBeInTheDocument();
  });

  it('worst start year line uses chart-danger token stroke', () => {
    render(<BacktestChart {...defaultProps} worstStartYear={2000} />);
    const worstLine = screen.getByTestId('rc-line-y2000');
    expect(worstLine.getAttribute('data-stroke')).toContain('--chart-danger');
  });

  it('worst start year line is dashed', () => {
    render(<BacktestChart {...defaultProps} worstStartYear={2000} />);
    const worstLine = screen.getByTestId('rc-line-y2000');
    expect(worstLine.getAttribute('data-stroke-dasharray')).not.toBe('');
  });

  it('below-tier lines use chart-warning token stroke', () => {
    render(<BacktestChart {...defaultProps} />);
    // startYear=1995 has tier='below'
    const belowLine = screen.getByTestId('rc-line-y1995');
    expect(belowLine.getAttribute('data-stroke')).toContain('--chart-warning');
  });

  it('met-tier lines use the CHART_PALETTE[0] blue stroke', () => {
    render(<BacktestChart {...defaultProps} />);
    // startYear=1990 has tier='met'
    const metLine = screen.getByTestId('rc-line-y1990');
    expect(metLine.getAttribute('data-stroke')).toBe('#4c78a8');
  });

  it('met-tier lines have low strokeOpacity (recede via opacity)', () => {
    render(<BacktestChart {...defaultProps} />);
    const metLine = screen.getByTestId('rc-line-y1990');
    // opacity=0.14 as specified
    expect(parseFloat(metLine.getAttribute('data-stroke-opacity') ?? '1')).toBeLessThan(0.5);
  });

  it('does NOT render any recharts-area-area elements in Lines mode', () => {
    const { container } = render(<BacktestChart {...defaultProps} />);
    expect(container.querySelectorAll('.recharts-area-area').length).toBe(0);
  });

  it('shows the Lines legend with the dash cue description', () => {
    render(<BacktestChart {...defaultProps} />);
    const legend = screen.getByTestId('backtest-legend-lines');
    expect(legend).toBeInTheDocument();
    expect(legend).toHaveTextContent('Depleted (dashed)');
    expect(legend).toHaveTextContent('Met goal');
    expect(legend).toHaveTextContent('Below goal, survived');
    expect(legend).toHaveTextContent('Median');
  });

  it('shows the Lines mode caption text', () => {
    render(<BacktestChart {...defaultProps} />);
    const caption = screen.getByTestId('backtest-caption');
    expect(caption).toHaveTextContent(/each faint line is one historical starting year/i);
    expect(caption).toHaveTextContent(/dashed lines ran out before the horizon/i);
  });
});

describe('BacktestChart — Bands mode (after toggle)', () => {
  it('switches to Bands mode when the Bands button is clicked', async () => {
    const user = userEvent.setup();
    render(<BacktestChart {...defaultProps} />);
    await user.click(screen.getByTestId('backtest-mode-bands'));
    expect(screen.getByTestId('backtest-chart')).toHaveAttribute('data-mode', 'bands');
    expect(screen.getByTestId('backtest-mode-bands')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('backtest-mode-lines')).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders the ComposedChart wrapper in Bands mode', async () => {
    const user = userEvent.setup();
    render(<BacktestChart {...defaultProps} />);
    await user.click(screen.getByTestId('backtest-mode-bands'));
    expect(screen.getByTestId('rc-composed')).toBeInTheDocument();
  });

  it('renders all four band Area series in Bands mode', async () => {
    const user = userEvent.setup();
    render(<BacktestChart {...defaultProps} />);
    await user.click(screen.getByTestId('backtest-mode-bands'));
    // Floor (p10), then the three delta bands
    expect(screen.getByTestId('rc-area-p10')).toBeInTheDocument();
    expect(screen.getByTestId('rc-area-band1025')).toBeInTheDocument();
    expect(screen.getByTestId('rc-area-band2575')).toBeInTheDocument();
    expect(screen.getByTestId('rc-area-band7590')).toBeInTheDocument();
  });

  it('all Band areas share the same stackId="fan"', async () => {
    const user = userEvent.setup();
    render(<BacktestChart {...defaultProps} />);
    await user.click(screen.getByTestId('backtest-mode-bands'));
    const bandKeys = ['p10', 'band1025', 'band2575', 'band7590'];
    for (const key of bandKeys) {
      expect(screen.getByTestId(`rc-area-${key}`)).toHaveAttribute('data-stack', 'fan');
    }
  });

  it('band2575 (inner) has higher fillOpacity than outer bands', async () => {
    const user = userEvent.setup();
    render(<BacktestChart {...defaultProps} />);
    await user.click(screen.getByTestId('backtest-mode-bands'));
    const inner = parseFloat(
      screen.getByTestId('rc-area-band2575').getAttribute('data-fill-opacity') ?? '0',
    );
    const outer1025 = parseFloat(
      screen.getByTestId('rc-area-band1025').getAttribute('data-fill-opacity') ?? '0',
    );
    const outer7590 = parseFloat(
      screen.getByTestId('rc-area-band7590').getAttribute('data-fill-opacity') ?? '0',
    );
    expect(inner).toBeGreaterThan(outer1025);
    expect(inner).toBeGreaterThan(outer7590);
  });

  it('renders the median (p50) Line in Bands mode', async () => {
    const user = userEvent.setup();
    render(<BacktestChart {...defaultProps} />);
    await user.click(screen.getByTestId('backtest-mode-bands'));
    expect(screen.getByTestId('rc-line-p50')).toBeInTheDocument();
  });

  it('does NOT render per-start-year Lines in Bands mode', async () => {
    const user = userEvent.setup();
    const result = makeResult();
    render(<BacktestChart {...defaultProps} result={result} />);
    await user.click(screen.getByTestId('backtest-mode-bands'));
    for (const o of result.outcomes) {
      expect(screen.queryByTestId(`rc-line-y${o.startYear}`)).not.toBeInTheDocument();
    }
  });

  it('shows the Bands legend', async () => {
    const user = userEvent.setup();
    render(<BacktestChart {...defaultProps} />);
    await user.click(screen.getByTestId('backtest-mode-bands'));
    expect(screen.getByTestId('backtest-legend-bands')).toBeInTheDocument();
    expect(screen.queryByTestId('backtest-legend-lines')).not.toBeInTheDocument();
  });

  it('shows the Bands mode caption text', async () => {
    const user = userEvent.setup();
    render(<BacktestChart {...defaultProps} />);
    await user.click(screen.getByTestId('backtest-mode-bands'));
    const caption = screen.getByTestId('backtest-caption');
    expect(caption).toHaveTextContent(/shaded fan shows where outcomes clustered/i);
    expect(caption).toHaveTextContent(/switch to Lines to see which specific years failed/i);
  });
});

describe('BacktestChart — toggle round-trip', () => {
  it('switching Lines → Bands → Lines restores Lines mode', async () => {
    const user = userEvent.setup();
    render(<BacktestChart {...defaultProps} />);
    await user.click(screen.getByTestId('backtest-mode-bands'));
    expect(screen.getByTestId('backtest-chart')).toHaveAttribute('data-mode', 'bands');
    await user.click(screen.getByTestId('backtest-mode-lines'));
    expect(screen.getByTestId('backtest-chart')).toHaveAttribute('data-mode', 'lines');
    // Per-start-year lines back
    expect(screen.getByTestId('rc-line-y1990')).toBeInTheDocument();
  });
});
