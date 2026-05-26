import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useTickersStore } from '@/stores/tickers-store';
import type { ConcentrationReport } from '@/lib/concentration';
import type { Ticker } from '@/types/schema';

// Recharts in jsdom doesn't render real wedges; mock the Pie so we can
// assert on slice contents. Mirrors the pattern in SectorDonut.test.tsx.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="rc-responsive">{children}</div>
  ),
  PieChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="rc-piechart">{children}</div>
  ),
  Pie: ({
    data,
    children,
  }: {
    data: Array<{ name: string; value: number; color?: string }>;
    children?: React.ReactNode;
  }) => (
    <div data-testid="rc-pie">
      {data.map((d) => (
        <span
          key={d.name}
          data-testid={`slice-${d.name}`}
          data-value={d.value}
          data-color={d.color ?? ''}
        >
          {d.name}:{d.value}
        </span>
      ))}
      {children}
    </div>
  ),
  Cell: () => null,
  Tooltip: () => null,
  Legend: () => null,
}));

// Drive the donut off a controllable concentration report — bypasses
// the entire stores/holdings/snapshots/funds pipeline.
const reportRef: { current: ConcentrationReport } = {
  current: {
    perTicker: [],
    tickerExposures: [],
    perAssetClass: [],
    totalLeverage: 0,
    warnings: [],
  },
};
vi.mock('@/lib/use-concentration', () => ({
  useConcentration: () => reportRef.current,
}));

import { PerTickerDonut } from '@/components/charts/PerTickerDonut';

function makeTicker(overrides: Partial<Ticker> & Pick<Ticker, 'ticker'>): Ticker {
  return {
    ticker: overrides.ticker,
    name: overrides.name ?? null,
    assetClass: overrides.assetClass ?? 'SINGLE_STOCK',
    leverageFactor: overrides.leverageFactor ?? 1,
    direction: overrides.direction ?? 'LONG',
    userAdded: overrides.userAdded ?? false,
    accentColor: overrides.accentColor ?? null,
    sector: overrides.sector ?? null,
    industry: overrides.industry ?? null,
  };
}

function setReport(perTicker: Array<{ ticker: string; effectiveExposure: number }>) {
  reportRef.current = {
    perTicker: perTicker.map((p) => ({ ...p, pctOfPortfolio: 0 })),
    tickerExposures: perTicker.map((p) => ({ ...p })),
    perAssetClass: [],
    totalLeverage: 0,
    warnings: [],
  };
}

function setTickers(tickers: Ticker[]) {
  useTickersStore.setState({ tickers, isLoading: false, error: null });
}

beforeEach(() => {
  localStorage.clear();
  reportRef.current = {
    perTicker: [],
    tickerExposures: [],
    perAssetClass: [],
    totalLeverage: 0,
    warnings: [],
  };
  useTickersStore.setState({ tickers: [], isLoading: false, error: null });
});

describe('PerTickerDonut', () => {
  function seedThreeTickers() {
    setTickers([
      makeTicker({ ticker: 'AAPL' }),
      makeTicker({ ticker: 'MSFT' }),
      makeTicker({ ticker: 'JPM' }),
    ]);
    setReport([
      { ticker: 'AAPL', effectiveExposure: 1000 },
      { ticker: 'MSFT', effectiveExposure: 500 },
      { ticker: 'JPM', effectiveExposure: 750 },
    ]);
  }

  it('renders one slice per ticker', () => {
    seedThreeTickers();
    render(<PerTickerDonut />);
    expect(screen.getByTestId('slice-AAPL')).toBeInTheDocument();
    expect(screen.getByTestId('slice-MSFT')).toBeInTheDocument();
    expect(screen.getByTestId('slice-JPM')).toBeInTheDocument();
  });

  it('renders an Entities picker button with the count of visible tickers', () => {
    seedThreeTickers();
    render(<PerTickerDonut />);
    expect(
      screen.getByRole('button', { name: /entities \(3\/3\)/i }),
    ).toBeInTheDocument();
  });

  it('hiding a ticker removes its slice from the donut', async () => {
    seedThreeTickers();
    render(<PerTickerDonut />);
    expect(screen.getByTestId('slice-MSFT')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /entities/i }));
    await user.click(screen.getByLabelText(/MSFT/));

    expect(screen.queryByTestId('slice-MSFT')).not.toBeInTheDocument();
    expect(screen.getByTestId('slice-AAPL')).toBeInTheDocument();
    expect(screen.getByTestId('slice-JPM')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /entities \(2\/3\)/i }),
    ).toBeInTheDocument();
  });

  it('persists hidden ticker across remount', async () => {
    seedThreeTickers();
    const { unmount } = render(<PerTickerDonut />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /entities/i }));
    await user.click(screen.getByLabelText(/MSFT/));
    expect(screen.queryByTestId('slice-MSFT')).not.toBeInTheDocument();
    unmount();

    render(<PerTickerDonut />);
    expect(screen.queryByTestId('slice-MSFT')).not.toBeInTheDocument();
    expect(screen.getByTestId('slice-AAPL')).toBeInTheDocument();
  });

  it('does not render the picker button when there are no tickers', () => {
    render(<PerTickerDonut />);
    expect(screen.queryByRole('button', { name: /entities/i })).toBeNull();
  });
});
