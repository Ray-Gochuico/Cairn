import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useTickersStore } from '@/stores/tickers-store';
import { useFundSectorsStore } from '@/stores/fund-sectors-store';
import type { ConcentrationReport } from '@/lib/concentration';
import type { FundSector, Ticker } from '@/types/schema';

// Recharts in jsdom doesn't render real wedges; mock the Pie so we can
// click named slices. See DonutChartCard.test.tsx for the same pattern.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="rc-responsive">{children}</div>
  ),
  PieChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="rc-piechart">{children}</div>
  ),
  Pie: ({
    data,
    onClick,
    children,
  }: {
    data: Array<{ name: string; value: number; color?: string }>;
    onClick?: (entry: unknown) => void;
    children?: React.ReactNode;
  }) => (
    <div data-testid="rc-pie">
      {data.map((d) => (
        <button
          type="button"
          key={d.name}
          data-testid={`slice-${d.name}`}
          data-color={d.color ?? ''}
          onClick={onClick ? () => onClick(d) : undefined}
        >
          {d.name}:{d.value}
        </button>
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
    perAssetClass: [],
    totalLeverage: 0,
    warnings: [],
  },
};
vi.mock('@/lib/use-concentration', () => ({
  useConcentration: () => reportRef.current,
}));

import { SectorDonut } from '@/components/charts/SectorDonut';

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

function setReport(
  perTicker: Array<{ ticker: string; effectiveExposure: number }>,
  tickerExposures?: Array<{ ticker: string; effectiveExposure: number }>,
) {
  // Default tickerExposures = perTicker so older tests (which only pass
  // perTicker) keep behaving correctly. New tests pass both to model the
  // production gap where perTicker is post-look-through (AAPL/MSFT/Misc)
  // but tickerExposures keeps the fund ticker (VTI/FXAIX) intact.
  const exposures = tickerExposures ?? perTicker;
  reportRef.current = {
    perTicker: perTicker.map((p) => ({ ...p, pctOfPortfolio: 0 })),
    tickerExposures: exposures.map((p) => ({ ...p })),
    perAssetClass: [],
    totalLeverage: 0,
    warnings: [],
  };
}

function setTickers(tickers: Ticker[]) {
  useTickersStore.setState({ tickers, isLoading: false, error: null });
}

function setFundSectors(fundSectors: FundSector[]) {
  useFundSectorsStore.setState({ fundSectors, isLoading: false, error: null });
}

beforeEach(() => {
  reportRef.current = {
    perTicker: [],
    tickerExposures: [],
    perAssetClass: [],
    totalLeverage: 0,
    warnings: [],
  };
  useTickersStore.setState({ tickers: [], isLoading: false, error: null });
  // Override the async load() so the mount effect doesn't try to hit the
  // database. Component tests set the state directly via setFundSectors.
  useFundSectorsStore.setState({
    fundSectors: [],
    isLoading: false,
    error: null,
    load: async () => undefined,
  });
});

describe('SectorDonut — sector view (default)', () => {
  it('renders the empty state when there are no holdings', () => {
    render(<SectorDonut />);
    expect(screen.getByText('Sector exposure')).toBeTruthy();
    expect(screen.getByText('After fund look-through')).toBeTruthy();
  });

  it('renders one wedge per resolved sector', () => {
    setTickers([
      makeTicker({ ticker: 'AAPL', sector: 'Technology', industry: 'Consumer Electronics' }),
      makeTicker({ ticker: 'MSFT', sector: 'Technology', industry: 'Software—Infrastructure' }),
      makeTicker({ ticker: 'JPM', sector: 'Financials', industry: 'Banks—Diversified' }),
    ]);
    setReport([
      { ticker: 'AAPL', effectiveExposure: 1000 },
      { ticker: 'MSFT', effectiveExposure: 500 },
      { ticker: 'JPM', effectiveExposure: 750 },
    ]);
    render(<SectorDonut />);
    expect(screen.getByTestId('slice-Technology')).toBeTruthy();
    expect(screen.getByTestId('slice-Financials')).toBeTruthy();
    expect(screen.getByText(/click a sector to drill in/)).toBeTruthy();
  });

  it('falls tickers without sector classification into Unclassified', () => {
    setTickers([
      makeTicker({ ticker: 'VTI', assetClass: 'US_TOTAL_MARKET' }),
    ]);
    setReport([{ ticker: 'VTI', effectiveExposure: 5000 }]);
    render(<SectorDonut />);
    expect(screen.getByTestId('slice-Unclassified')).toBeTruthy();
  });

  it('routes fixed-income ETFs to the Fixed Income pseudo-sector', () => {
    setTickers([
      makeTicker({ ticker: 'BND', assetClass: 'US_BONDS' }),
    ]);
    setReport([{ ticker: 'BND', effectiveExposure: 2000 }]);
    render(<SectorDonut />);
    expect(screen.getByTestId('slice-Fixed Income')).toBeTruthy();
  });
});

describe('SectorDonut — drill into industry view', () => {
  beforeEach(() => {
    setTickers([
      makeTicker({ ticker: 'AAPL', sector: 'Technology', industry: 'Consumer Electronics' }),
      makeTicker({ ticker: 'MSFT', sector: 'Technology', industry: 'Software—Infrastructure' }),
      makeTicker({ ticker: 'NVDA', sector: 'Technology', industry: 'Semiconductors' }),
      makeTicker({ ticker: 'JPM', sector: 'Financials', industry: 'Banks—Diversified' }),
    ]);
    setReport([
      { ticker: 'AAPL', effectiveExposure: 1000 },
      { ticker: 'MSFT', effectiveExposure: 800 },
      { ticker: 'NVDA', effectiveExposure: 1200 },
      { ticker: 'JPM', effectiveExposure: 750 },
    ]);
  });

  it('switches to the industry view when a sector wedge is clicked', () => {
    render(<SectorDonut />);
    fireEvent.click(screen.getByTestId('slice-Technology'));
    expect(screen.getByText('Industries — Technology')).toBeTruthy();
    expect(screen.getByTestId('slice-Consumer Electronics')).toBeTruthy();
    expect(screen.getByTestId('slice-Software—Infrastructure')).toBeTruthy();
    expect(screen.getByTestId('slice-Semiconductors')).toBeTruthy();
    // Financials wedge from the prior view is gone
    expect(screen.queryByTestId('slice-Financials')).toBeNull();
  });

  it('shows a "Back to sectors" button while drilled in', () => {
    render(<SectorDonut />);
    fireEvent.click(screen.getByTestId('slice-Technology'));
    const back = screen.getByRole('button', { name: /back to sectors/i });
    expect(back).toBeTruthy();
  });

  it('returns to the sector view when "Back to sectors" is clicked', () => {
    render(<SectorDonut />);
    fireEvent.click(screen.getByTestId('slice-Technology'));
    fireEvent.click(screen.getByRole('button', { name: /back to sectors/i }));
    expect(screen.getByText('Sector exposure')).toBeTruthy();
    expect(screen.getByTestId('slice-Technology')).toBeTruthy();
    expect(screen.getByTestId('slice-Financials')).toBeTruthy();
  });

  it('does not drill again when a wedge is clicked in industry view', () => {
    render(<SectorDonut />);
    fireEvent.click(screen.getByTestId('slice-Technology'));
    // Click an industry wedge — should be a no-op (no onClick wired).
    fireEvent.click(screen.getByTestId('slice-Semiconductors'));
    // Still in Technology industry view, not switched to anything else.
    expect(screen.getByText('Industries — Technology')).toBeTruthy();
  });
});

describe('SectorDonut — drill-view self-heals when the selected sector empties', () => {
  it('collapses back to the sector view if all holdings in the drill sector are removed', () => {
    setTickers([
      makeTicker({ ticker: 'AAPL', sector: 'Technology', industry: 'Consumer Electronics' }),
      makeTicker({ ticker: 'JPM', sector: 'Financials', industry: 'Banks—Diversified' }),
    ]);
    setReport([
      { ticker: 'AAPL', effectiveExposure: 1000 },
      { ticker: 'JPM', effectiveExposure: 500 },
    ]);
    const { rerender } = render(<SectorDonut />);
    fireEvent.click(screen.getByTestId('slice-Technology'));
    expect(screen.getByText('Industries — Technology')).toBeTruthy();

    // Simulate AAPL being sold: Technology now has no holdings.
    setReport([{ ticker: 'JPM', effectiveExposure: 500 }]);
    rerender(<SectorDonut />);
    // Reset effect fires → sector view, Financials only.
    expect(screen.getByText('Sector exposure')).toBeTruthy();
    expect(screen.getByTestId('slice-Financials')).toBeTruthy();
  });
});

describe('SectorDonut — fund sector look-through', () => {
  it('distributes a fund exposure across its sector weightings instead of bucketing into Unclassified', () => {
    // VTI is a US_TOTAL_MARKET fund whose pseudo-sector is "Unclassified".
    // With fund sector weights it should split across the real sectors.
    setTickers([
      makeTicker({ ticker: 'VTI', assetClass: 'US_TOTAL_MARKET' }),
    ]);
    setReport([{ ticker: 'VTI', effectiveExposure: 10_000 }]);
    setFundSectors([
      { fundTicker: 'VTI', sector: 'Technology', weight: 0.30, asOfDate: '2026-01-01' },
      { fundTicker: 'VTI', sector: 'Healthcare', weight: 0.20, asOfDate: '2026-01-01' },
      { fundTicker: 'VTI', sector: 'Financial Services', weight: 0.15, asOfDate: '2026-01-01' },
      { fundTicker: 'VTI', sector: 'Consumer Cyclical', weight: 0.35, asOfDate: '2026-01-01' },
    ]);

    render(<SectorDonut />);

    expect(screen.getByTestId('slice-Technology')).toBeTruthy();
    expect(screen.getByTestId('slice-Healthcare')).toBeTruthy();
    expect(screen.getByTestId('slice-Financial Services')).toBeTruthy();
    expect(screen.getByTestId('slice-Consumer Cyclical')).toBeTruthy();
    expect(screen.queryByTestId('slice-Unclassified')).toBeNull();
  });

  it('falls back to Unclassified for a fund with no sector data', () => {
    setTickers([
      makeTicker({ ticker: 'VTI', assetClass: 'US_TOTAL_MARKET' }),
    ]);
    setReport([{ ticker: 'VTI', effectiveExposure: 10_000 }]);
    // No fund sectors loaded — pseudo-sector path takes over.
    setFundSectors([]);

    render(<SectorDonut />);

    expect(screen.getByTestId('slice-Unclassified')).toBeTruthy();
  });

  it('REGRESSION: production-shaped report (perTicker post-look-through) still distributes via fund_sectors', () => {
    // Mirrors the live-app bug: useConcentration() replaces VTI/FXAIX with
    // their top-10 underlyings + Misc in perTicker. Earlier versions of the
    // donut consumed perTicker directly and so couldn't see the fund tickers
    // anymore — fund_sectors never got applied and the donut collapsed into
    // a single "Unclassified"+"Misc" bucket. The fix is to consume the
    // pre-look-through tickerExposures field which keeps the fund ticker
    // intact.
    setTickers([
      makeTicker({ ticker: 'VTI', assetClass: 'US_TOTAL_MARKET' }),
      makeTicker({ ticker: 'FXAIX', assetClass: 'US_LARGE_CAP' }),
      // Underlyings the top-N look-through expanded VTI/FXAIX into.
      makeTicker({ ticker: 'NVDA', sector: 'Technology', industry: 'Semiconductors' }),
      makeTicker({ ticker: 'AAPL', sector: 'Technology', industry: 'Consumer Electronics' }),
      makeTicker({ ticker: 'MSFT', sector: 'Technology', industry: 'Software—Infrastructure' }),
      makeTicker({ ticker: 'AMZN', sector: 'Consumer Cyclical', industry: 'Internet Retail' }),
    ]);
    setReport(
      // perTicker — post-look-through, what the live app actually has
      [
        { ticker: 'Misc', effectiveExposure: 32_223 },
        { ticker: 'NVDA', effectiveExposure: 3_427 },
        { ticker: 'AAPL', effectiveExposure: 2_982 },
        { ticker: 'MSFT', effectiveExposure: 2_242 },
        { ticker: 'AMZN', effectiveExposure: 1_810 },
      ],
      // tickerExposures — pre-look-through, what we ACTUALLY want the donut to use
      [
        { ticker: 'VTI', effectiveExposure: 30_000 },
        { ticker: 'FXAIX', effectiveExposure: 20_000 },
      ],
    );
    setFundSectors([
      { fundTicker: 'VTI', sector: 'Technology', weight: 0.28, asOfDate: '2026-01-01' },
      { fundTicker: 'VTI', sector: 'Financial Services', weight: 0.14, asOfDate: '2026-01-01' },
      { fundTicker: 'VTI', sector: 'Consumer Cyclical', weight: 0.11, asOfDate: '2026-01-01' },
      { fundTicker: 'VTI', sector: 'Healthcare', weight: 0.13, asOfDate: '2026-01-01' },
      { fundTicker: 'VTI', sector: 'Industrials', weight: 0.10, asOfDate: '2026-01-01' },
      { fundTicker: 'VTI', sector: 'Communication Services', weight: 0.08, asOfDate: '2026-01-01' },
      { fundTicker: 'VTI', sector: 'Consumer Defensive', weight: 0.06, asOfDate: '2026-01-01' },
      { fundTicker: 'VTI', sector: 'Energy', weight: 0.04, asOfDate: '2026-01-01' },
      { fundTicker: 'VTI', sector: 'Utilities', weight: 0.03, asOfDate: '2026-01-01' },
      { fundTicker: 'VTI', sector: 'Real Estate', weight: 0.02, asOfDate: '2026-01-01' },
      { fundTicker: 'VTI', sector: 'Basic Materials', weight: 0.01, asOfDate: '2026-01-01' },
      { fundTicker: 'FXAIX', sector: 'Technology', weight: 0.32, asOfDate: '2026-01-01' },
      { fundTicker: 'FXAIX', sector: 'Financial Services', weight: 0.14, asOfDate: '2026-01-01' },
      { fundTicker: 'FXAIX', sector: 'Consumer Cyclical', weight: 0.10, asOfDate: '2026-01-01' },
      { fundTicker: 'FXAIX', sector: 'Healthcare', weight: 0.13, asOfDate: '2026-01-01' },
      { fundTicker: 'FXAIX', sector: 'Industrials', weight: 0.10, asOfDate: '2026-01-01' },
      { fundTicker: 'FXAIX', sector: 'Communication Services', weight: 0.08, asOfDate: '2026-01-01' },
      { fundTicker: 'FXAIX', sector: 'Consumer Defensive', weight: 0.06, asOfDate: '2026-01-01' },
      { fundTicker: 'FXAIX', sector: 'Energy', weight: 0.03, asOfDate: '2026-01-01' },
      { fundTicker: 'FXAIX', sector: 'Utilities', weight: 0.02, asOfDate: '2026-01-01' },
      { fundTicker: 'FXAIX', sector: 'Real Estate', weight: 0.01, asOfDate: '2026-01-01' },
      { fundTicker: 'FXAIX', sector: 'Basic Materials', weight: 0.01, asOfDate: '2026-01-01' },
    ]);

    render(<SectorDonut />);

    // The eleven GICS sectors must each get a slice.
    expect(screen.getByTestId('slice-Technology')).toBeTruthy();
    expect(screen.getByTestId('slice-Financial Services')).toBeTruthy();
    expect(screen.getByTestId('slice-Consumer Cyclical')).toBeTruthy();
    expect(screen.getByTestId('slice-Healthcare')).toBeTruthy();
    expect(screen.getByTestId('slice-Industrials')).toBeTruthy();
    expect(screen.getByTestId('slice-Communication Services')).toBeTruthy();
    expect(screen.getByTestId('slice-Consumer Defensive')).toBeTruthy();
    expect(screen.getByTestId('slice-Energy')).toBeTruthy();
    expect(screen.getByTestId('slice-Utilities')).toBeTruthy();
    expect(screen.getByTestId('slice-Real Estate')).toBeTruthy();
    expect(screen.getByTestId('slice-Basic Materials')).toBeTruthy();
    // Misc must NOT bleed through — perTicker's Misc bucket should not appear
    // since the donut consumes tickerExposures, not perTicker.
    expect(screen.queryByTestId('slice-Misc')).toBeNull();
    // Same for AAPL/NVDA etc. — those are post-look-through artifacts that
    // belong to the per-company donut, not the sector donut.
    expect(screen.queryByTestId('slice-NVDA')).toBeNull();
    expect(screen.queryByTestId('slice-AAPL')).toBeNull();
    // Unclassified must not dominate — funds had full coverage.
    expect(screen.queryByTestId('slice-Unclassified')).toBeNull();
  });
});

describe('SectorDonut — colors', () => {
  it('uses the SECTOR_COLORS palette for sector wedges', () => {
    setTickers([
      makeTicker({ ticker: 'AAPL', sector: 'Technology', industry: 'Consumer Electronics' }),
    ]);
    setReport([{ ticker: 'AAPL', effectiveExposure: 1000 }]);
    render(<SectorDonut />);
    const wedge = screen.getByTestId('slice-Technology');
    expect(wedge.dataset.color).toBe('#3b82f6');
  });

  it('uses shaded variants of the sector color for industry wedges', () => {
    setTickers([
      makeTicker({ ticker: 'AAPL', sector: 'Technology', industry: 'Consumer Electronics' }),
      makeTicker({ ticker: 'MSFT', sector: 'Technology', industry: 'Software—Infrastructure' }),
    ]);
    setReport([
      { ticker: 'AAPL', effectiveExposure: 1000 },
      { ticker: 'MSFT', effectiveExposure: 800 },
    ]);
    render(<SectorDonut />);
    fireEvent.click(screen.getByTestId('slice-Technology'));
    const w1 = screen.getByTestId('slice-Consumer Electronics');
    const w2 = screen.getByTestId('slice-Software—Infrastructure');
    expect(w1.dataset.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(w2.dataset.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(w1.dataset.color).not.toBe(w2.dataset.color);
  });
});
