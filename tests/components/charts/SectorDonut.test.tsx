import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  localStorage.clear();
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
    render(<MemoryRouter><SectorDonut /></MemoryRouter>);
    expect(screen.getByText('Sector exposure')).toBeTruthy();
    expect(screen.getByText('After fund look-through')).toBeTruthy();
  });

  it('shows Monthly-ritual guidance copy and mounts no empty pie when there are no holdings', () => {
    render(<MemoryRouter><SectorDonut /></MemoryRouter>);
    expect(
      screen.getByText(
        /No holding values yet — confirm an account snapshot \(Monthly ritual\) to see exposure\./,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('rc-pie')).toBeNull();
  });

  it('still renders the share-% legend on a populated portfolio (protected view)', () => {
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
    render(<MemoryRouter><SectorDonut /></MemoryRouter>);
    // Technology 1500 of 2250 → 66.7% share readout in the legend.
    expect(screen.getByText(/66\.7%/)).toBeInTheDocument();
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
    render(<MemoryRouter><SectorDonut /></MemoryRouter>);
    expect(screen.getByTestId('slice-Technology')).toBeTruthy();
    expect(screen.getByTestId('slice-Financials')).toBeTruthy();
    expect(screen.getByText(/click a sector to drill in/)).toBeTruthy();
  });

  it('falls tickers without sector classification into Unclassified', () => {
    setTickers([
      makeTicker({ ticker: 'VTI', assetClass: 'US_TOTAL_MARKET' }),
    ]);
    setReport([{ ticker: 'VTI', effectiveExposure: 5000 }]);
    render(<MemoryRouter><SectorDonut /></MemoryRouter>);
    expect(screen.getByTestId('slice-Unclassified')).toBeTruthy();
  });

  it('routes fixed-income ETFs to the Fixed Income pseudo-sector', () => {
    setTickers([
      makeTicker({ ticker: 'BND', assetClass: 'US_BONDS' }),
    ]);
    setReport([{ ticker: 'BND', effectiveExposure: 2000 }]);
    render(<MemoryRouter><SectorDonut /></MemoryRouter>);
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
    render(<MemoryRouter><SectorDonut /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('slice-Technology'));
    expect(screen.getByText('Industries — Technology')).toBeTruthy();
    expect(screen.getByTestId('slice-Consumer Electronics')).toBeTruthy();
    expect(screen.getByTestId('slice-Software—Infrastructure')).toBeTruthy();
    expect(screen.getByTestId('slice-Semiconductors')).toBeTruthy();
    // Financials wedge from the prior view is gone
    expect(screen.queryByTestId('slice-Financials')).toBeNull();
  });

  it('shows a "Back to sectors" button while drilled in', () => {
    render(<MemoryRouter><SectorDonut /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('slice-Technology'));
    const back = screen.getByRole('button', { name: /back to sectors/i });
    expect(back).toBeTruthy();
  });

  it('returns to the sector view when "Back to sectors" is clicked', () => {
    render(<MemoryRouter><SectorDonut /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('slice-Technology'));
    fireEvent.click(screen.getByRole('button', { name: /back to sectors/i }));
    expect(screen.getByText('Sector exposure')).toBeTruthy();
    expect(screen.getByTestId('slice-Technology')).toBeTruthy();
    expect(screen.getByTestId('slice-Financials')).toBeTruthy();
  });

  it('industry legend shares are share-of-SECTOR (complete partition), not share-of-portfolio', () => {
    // Technology = 1200 + 1000 + 800 = 3000 of a 3750 portfolio. Drilled-in
    // industries are a COMPLETE partition of the sector, so the honest
    // denominator is the sector total: Semiconductors 40.0% (1200/3000),
    // NOT 32.0% (1200/3750). Pins the deliberate shareTotal={undefined} in
    // drill-in view — a future "pass shareTotal unconditionally" cleanup
    // must go red here.
    render(<MemoryRouter><SectorDonut /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('slice-Technology'));
    expect(screen.getByText(/\$1,200 · 40\.0%/)).toBeInTheDocument();
    expect(screen.getByText(/\$1,000 · 33\.3%/)).toBeInTheDocument();
    expect(screen.getByText(/\$800 · 26\.7%/)).toBeInTheDocument();
    expect(screen.queryByText(/32\.0%|21\.3%/)).toBeNull();
  });

  it('does not drill again when a wedge is clicked in industry view', () => {
    render(<MemoryRouter><SectorDonut /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('slice-Technology'));
    // Click an industry wedge — should be a no-op (no onClick wired).
    fireEvent.click(screen.getByTestId('slice-Semiconductors'));
    // Still in Technology industry view, not switched to anything else.
    expect(screen.getByText('Industries — Technology')).toBeTruthy();
  });

  it('drill-in focuses the Back button; back restores focus to the drilled legend button (round-2 B4)', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><SectorDonut /></MemoryRouter>);
    // Drill in via the LEGEND button (DonutChartCard's keyboard twin of the
    // wedge) — unambiguous, unlike the mocked slice buttons.
    const legend = await screen.findByRole('list', { name: /chart legend/i });
    const legendButton = within(legend).getByRole('button', { name: /technology/i });
    await user.click(legendButton);
    const back = await screen.findByRole('button', { name: /back to sectors/i });
    await waitFor(() => expect(back).toHaveFocus());
    await user.click(back);
    // Focus lands on the first interactive twin of the drilled sector (in
    // production DOM that's the legend row button — real recharts wedges are
    // SVG paths; the jsdom recharts mock also renders slice buttons, so
    // assert by focused-button text rather than a specific node).
    await waitFor(() => {
      const focused = document.activeElement as HTMLElement | null;
      expect(focused?.tagName).toBe('BUTTON');
      expect(focused?.textContent ?? '').toMatch(/technology/i);
    });
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
    const { rerender } = render(<MemoryRouter><SectorDonut /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('slice-Technology'));
    expect(screen.getByText('Industries — Technology')).toBeTruthy();

    // Simulate AAPL being sold: Technology now has no holdings.
    setReport([{ ticker: 'JPM', effectiveExposure: 500 }]);
    rerender(<MemoryRouter><SectorDonut /></MemoryRouter>);
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

    render(<MemoryRouter><SectorDonut /></MemoryRouter>);

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

    render(<MemoryRouter><SectorDonut /></MemoryRouter>);

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

    render(<MemoryRouter><SectorDonut /></MemoryRouter>);

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
    render(<MemoryRouter><SectorDonut /></MemoryRouter>);
    const wedge = screen.getByTestId('slice-Technology');
    expect(wedge.dataset.color).toBe('#3b82f6');
  });

  it('REGRESSION: assigns colors to every sector Yahoo returns (Morningstar labels)', () => {
    // Yahoo's topHoldings.sectorWeightings and assetProfile.sector both
    // use Morningstar labels ("Financial Services", "Healthcare",
    // "Consumer Cyclical", "Basic Materials", "Consumer Defensive") —
    // NOT the GICS labels the palette used to be keyed on. Without aliases
    // these sectors would all fall through to the neutral gray, leaving
    // the donut visually undifferentiated.
    setTickers([
      makeTicker({ ticker: 'VTI', assetClass: 'US_TOTAL_MARKET' }),
    ]);
    setReport([{ ticker: 'VTI', effectiveExposure: 10_000 }]);
    setFundSectors([
      { fundTicker: 'VTI', sector: 'Technology', weight: 0.10, asOfDate: '2026-01-01' },
      { fundTicker: 'VTI', sector: 'Financial Services', weight: 0.10, asOfDate: '2026-01-01' },
      { fundTicker: 'VTI', sector: 'Healthcare', weight: 0.10, asOfDate: '2026-01-01' },
      { fundTicker: 'VTI', sector: 'Consumer Cyclical', weight: 0.10, asOfDate: '2026-01-01' },
      { fundTicker: 'VTI', sector: 'Communication Services', weight: 0.10, asOfDate: '2026-01-01' },
      { fundTicker: 'VTI', sector: 'Industrials', weight: 0.10, asOfDate: '2026-01-01' },
      { fundTicker: 'VTI', sector: 'Consumer Defensive', weight: 0.10, asOfDate: '2026-01-01' },
      { fundTicker: 'VTI', sector: 'Energy', weight: 0.10, asOfDate: '2026-01-01' },
      { fundTicker: 'VTI', sector: 'Utilities', weight: 0.05, asOfDate: '2026-01-01' },
      { fundTicker: 'VTI', sector: 'Basic Materials', weight: 0.05, asOfDate: '2026-01-01' },
      { fundTicker: 'VTI', sector: 'Real Estate', weight: 0.10, asOfDate: '2026-01-01' },
    ]);
    render(<MemoryRouter><SectorDonut /></MemoryRouter>);

    // Every wedge must have a 6-digit hex AND must not be the neutral gray
    // (the fallback for unknown sectors). Both signals together catch a
    // future regression where one Yahoo label loses its palette entry.
    const NEUTRAL = '#94a3b8'; // mirrors CHART_NEUTRAL
    for (const sector of [
      'Technology', 'Financial Services', 'Healthcare', 'Consumer Cyclical',
      'Communication Services', 'Industrials', 'Consumer Defensive', 'Energy',
      'Utilities', 'Basic Materials', 'Real Estate',
    ]) {
      const wedge = screen.getByTestId(`slice-${sector}`);
      expect(wedge.dataset.color).toMatch(/^#[0-9a-f]{6}$/i);
      expect(wedge.dataset.color, `sector "${sector}" fell through to neutral`).not.toBe(NEUTRAL);
    }
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
    render(<MemoryRouter><SectorDonut /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('slice-Technology'));
    const w1 = screen.getByTestId('slice-Consumer Electronics');
    const w2 = screen.getByTestId('slice-Software—Infrastructure');
    expect(w1.dataset.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(w2.dataset.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(w1.dataset.color).not.toBe(w2.dataset.color);
  });
});

describe('SectorDonut — entity picker', () => {
  function seedTwoSectors() {
    setTickers([
      makeTicker({ ticker: 'AAPL', sector: 'Technology', industry: 'Consumer Electronics' }),
      makeTicker({ ticker: 'MSFT', sector: 'Technology', industry: 'Software—Infrastructure' }),
      makeTicker({ ticker: 'JPM', sector: 'Financial Services', industry: 'Banks—Diversified' }),
    ]);
    setReport([
      { ticker: 'AAPL', effectiveExposure: 1000 },
      { ticker: 'MSFT', effectiveExposure: 500 },
      { ticker: 'JPM', effectiveExposure: 750 },
    ]);
  }

  it('renders an Entities picker button with the sector count', () => {
    seedTwoSectors();
    render(<MemoryRouter><SectorDonut /></MemoryRouter>);
    expect(
      screen.getByRole('button', { name: /Included · 2 of 2/ }),
    ).toBeInTheDocument();
  });

  it('hiding a sector removes its wedge from the donut', async () => {
    seedTwoSectors();
    render(<MemoryRouter><SectorDonut /></MemoryRouter>);
    expect(screen.getByTestId('slice-Technology')).toBeInTheDocument();
    expect(screen.getByTestId('slice-Financial Services')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Included ·/ }));
    await user.click(screen.getByRole('checkbox', { name: /Financial Services/ }));

    expect(screen.queryByTestId('slice-Financial Services')).not.toBeInTheDocument();
    expect(screen.getByTestId('slice-Technology')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Included · 1 of 2/ }),
    ).toBeInTheDocument();
  });

  it('hides the picker button while drilled into an industry view', () => {
    seedTwoSectors();
    render(<MemoryRouter><SectorDonut /></MemoryRouter>);
    // Picker is visible in sector view
    expect(screen.getByRole('button', { name: /Included ·/ })).toBeInTheDocument();
    // Drill into Technology
    fireEvent.click(screen.getByTestId('slice-Technology'));
    expect(screen.getByText('Industries — Technology')).toBeInTheDocument();
    // Picker should be hidden — the picker operates on sectors only.
    expect(screen.queryByRole('button', { name: /Included ·/ })).toBeNull();
  });

  it('picker reappears when returning to sector view via "Back to sectors"', () => {
    seedTwoSectors();
    render(<MemoryRouter><SectorDonut /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('slice-Technology'));
    expect(screen.queryByRole('button', { name: /Included ·/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /back to sectors/i }));
    expect(
      screen.getByRole('button', { name: /Included · 2 of 2/ }),
    ).toBeInTheDocument();
  });

  it('sector share % stays anchored to the full portfolio when a sector is hidden', async () => {
    // Technology 1500, Financial Services 750 → full total 2250. Hide
    // Financial Services: Technology's legend share must still read 66.7%
    // (1500/2250), NOT 100.0%.
    seedTwoSectors();
    render(<MemoryRouter><SectorDonut /></MemoryRouter>);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Included ·/ }));
    await user.click(screen.getByRole('checkbox', { name: /Financial Services/ }));
    expect(screen.getByText(/\$1,500 · 66\.7%/)).toBeInTheDocument();
    expect(screen.queryByText(/100\.0%/)).not.toBeInTheDocument();
  });

  it('picker lives in the card header, not an absolute overlay', () => {
    seedTwoSectors();
    render(<MemoryRouter><SectorDonut /></MemoryRouter>);
    const trigger = screen.getByRole('button', { name: /Included ·/ });
    expect(trigger.closest('[class*="absolute"]')).toBeNull();
  });

  it('persists hidden sector across remount', async () => {
    seedTwoSectors();
    const { unmount } = render(<MemoryRouter><SectorDonut /></MemoryRouter>);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Included ·/ }));
    await user.click(screen.getByRole('checkbox', { name: /Financial Services/ }));
    expect(screen.queryByTestId('slice-Financial Services')).not.toBeInTheDocument();
    unmount();

    render(<MemoryRouter><SectorDonut /></MemoryRouter>);
    expect(screen.queryByTestId('slice-Financial Services')).not.toBeInTheDocument();
    expect(screen.getByTestId('slice-Technology')).toBeInTheDocument();
  });
});

describe('SectorDonut — fund-exposure remainder slice (wave-9 M8, protected view, additive)', () => {
  it('industry drill-in shows the unmapped fund exposure as an explicit slice', async () => {
    // Fund-only portfolio: the Technology wedge is 100% fund look-through.
    // Pre-fix, drilling in rendered nothing (silent no-op — the empty-slices
    // self-heal bounced straight back to the sector view).
    setTickers([makeTicker({ ticker: 'VTI', assetClass: 'US_TOTAL_MARKET' })]);
    setFundSectors([
      { id: 1, fundTicker: 'VTI', sector: 'Technology', weight: 0.6, asOf: '2026-07-01' } as never,
      { id: 2, fundTicker: 'VTI', sector: 'Financials', weight: 0.4, asOf: '2026-07-01' } as never,
    ]);
    setReport([{ ticker: 'VTI', effectiveExposure: 10_000 }]);
    render(<MemoryRouter><SectorDonut /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('slice-Technology'));
    const slice = await screen.findByTestId('slice-Fund exposure (no industry breakdown)');
    // The slice carries the WHOLE wedge value for a fund-only portfolio.
    expect(slice.textContent).toContain('6000');
  });

  it('a mixed sector reconciles: remainder = wedge − drilled industries', async () => {
    setTickers([
      makeTicker({ ticker: 'AAPL', sector: 'Technology', industry: 'Consumer Electronics' }),
      makeTicker({ ticker: 'VTI', assetClass: 'US_TOTAL_MARKET' }),
    ]);
    setFundSectors([
      { id: 1, fundTicker: 'VTI', sector: 'Technology', weight: 0.5, asOf: '2026-07-01' } as never,
      { id: 2, fundTicker: 'VTI', sector: 'Financials', weight: 0.5, asOf: '2026-07-01' } as never,
    ]);
    // Post-look-through perTicker keeps AAPL; tickerExposures keeps VTI whole.
    setReport(
      [
        { ticker: 'AAPL', effectiveExposure: 1_000 },
        { ticker: 'VTI', effectiveExposure: 4_000 },
      ],
      [
        { ticker: 'AAPL', effectiveExposure: 1_000 },
        { ticker: 'VTI', effectiveExposure: 4_000 },
      ],
    );
    render(<MemoryRouter><SectorDonut /></MemoryRouter>);
    // Technology wedge = 1,000 (AAPL) + 4,000 × 0.5 (VTI) = 3,000.
    fireEvent.click(screen.getByTestId('slice-Technology'));
    expect(screen.getByTestId('slice-Consumer Electronics').textContent).toContain('1000');
    const remainder = await screen.findByTestId('slice-Fund exposure (no industry breakdown)');
    expect(remainder.textContent).toContain('2000');
  });
});
