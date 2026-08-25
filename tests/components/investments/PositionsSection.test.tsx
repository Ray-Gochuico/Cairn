import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import PositionsSection from '@/components/investments/PositionsSection';
import { buildPositions, type PriceCacheRow, type TickerPositionInfo } from '@/lib/positions';
import type { Holding } from '@/types/schema';

const h = (id: number, accountId: number, ticker: string, shareCount: number, costBasis: number | null): Holding =>
  ({ id, accountId, ticker, shareCount, targetAllocationPct: null, costBasis } as Holding);
const p = (ticker: string, date: string, price: number): PriceCacheRow =>
  ({ ticker, date, price, fetched_at: `${date} 20:10:00` });
const info = (
  name: string | null,
  low: number | null,
  high: number | null,
  change: number | null = null,
  prevClose: number | null = null,
): TickerPositionInfo => ({
  name,
  fiftyTwoWeekLow: low,
  fiftyTwoWeekHigh: high,
  regularMarketChange: change,
  regularMarketPreviousClose: prevClose,
});

const INFO = new Map<string, TickerPositionInfo>([
  ['VTI', info('Vanguard Total Stock Market ETF', 200, 250)],
]);

function renderSection(positions: ReturnType<typeof buildPositions>) {
  return render(<PositionsSection positions={positions} />);
}

describe('PositionsSection', () => {
  const accounts = [{ id: 1, name: 'Brokerage' }];
  const holdings = [h(11, 1, 'VTI', 10, 2100), h(12, 1, 'BND', 20, null), h(13, 1, 'ABC', 5, 100)];
  const prices = [p('VTI', '2026-08-07', 240), p('VTI', '2026-08-08', 245.5), p('BND', '2026-08-08', 72.1)];

  it('renders heading, both captions, and the account table (CP-1/3/4/11)', () => {
    renderSection(buildPositions(accounts, holdings, INFO, prices));
    expect(screen.getByText('Positions')).toBeInTheDocument();
    expect(screen.getByText(/last-fetched prices × shares/)).toBeInTheDocument();
    expect(screen.getByTestId('positions-as-of')).toHaveTextContent(
      /^Prices as of .+ — updated only when you refresh\.$/, // exact instant is TZ-dependent; format pinned, value not
    );
    expect(screen.getByRole('table', { name: 'Positions — Brokerage' })).toBeInTheDocument();
  });

  it('two-line symbol cell with name; single-line without (CP column rule)', () => {
    renderSection(buildPositions(accounts, holdings, INFO, prices));
    const vti = screen.getByTestId('position-row-11');
    expect(within(vti).getByText('VTI')).toBeInTheDocument();
    expect(within(vti).getByText('Vanguard Total Stock Market ETF')).toBeInTheDocument();
    const bnd = screen.getByTestId('position-row-12');
    expect(within(bnd).queryByText(/Vanguard/)).toBeNull();
  });

  it('hand-computed money strings on the priced row (D-PT10 grain)', () => {
    renderSection(buildPositions(accounts, holdings, INFO, prices));
    const vti = screen.getByTestId('position-row-11');
    expect(vti).toHaveTextContent('$245.50');            // last price, cents
    expect(vti).toHaveTextContent('+$55.00');            // (245.50 − 240.00) × 10
    expect(vti).toHaveTextContent('(+2.3%)');            // 5.5 / 240
    expect(vti).toHaveTextContent('+$355.00');           // 2,455 − 2,100
    expect(vti).toHaveTextContent('(+16.9%)');           // 355 / 2,100
    expect(vti).toHaveTextContent('$2,455');             // whole-dollar value
    expect(vti).toHaveTextContent('63.0%');              // 2,455 / 3,897
    expect(vti).toHaveTextContent('$2,100');             // basis total
    expect(vti).toHaveTextContent('$210.00 / share');    // per-share basis, cents + mockup unit
  });

  it('52-week bar on the priced row: labels + clamped marker position (D-PT3)', () => {
    renderSection(buildPositions(accounts, holdings, INFO, prices));
    const vti = screen.getByTestId('position-row-11');
    expect(vti).toHaveTextContent('$200.00');            // fetched low label
    expect(vti).toHaveTextContent('$250.00');            // fetched high label
    const marker = screen.getByTestId('week52-marker-11');
    expect(parseFloat(marker.style.left)).toBeCloseTo(91, 1); // (245.5 − 200) / 50
  });

  it('dash rules: unpriced row with no fetched range shows 6 dashes but keeps entered data', () => {
    renderSection(buildPositions(accounts, holdings, INFO, prices));
    const abc = screen.getByTestId('position-row-13');
    // Last price, Since refresh, Total G/L, Current value, % of account, 52-week
    expect(within(abc).getAllByText('—')).toHaveLength(6);
    expect(abc).toHaveTextContent('$100');   // basis still renders
    expect(abc).toHaveTextContent('$20.00 / share'); // per-share + mockup unit
  });

  it('fetched range renders even on an unpriced row — labels without a marker (D-PT3)', () => {
    const bare = buildPositions(
      [{ id: 1, name: 'E' }], [h(61, 1, 'NOPX', 2, null)],
      new Map([['NOPX', info(null, 10, 20)]]), [],
    );
    renderSection(bare);
    const row = screen.getByTestId('position-row-61');
    expect(row).toHaveTextContent('$10.00');
    expect(row).toHaveTextContent('$20.00');
    expect(screen.queryByTestId('week52-marker-61')).toBeNull();
  });

  it('account-total row: label, delta sum, value sum, excludes suffix (CP-5/6, D-PT4)', () => {
    renderSection(buildPositions(accounts, holdings, INFO, prices));
    const total = screen.getByTestId('positions-total-1');
    expect(total).toHaveTextContent('Account total');
    expect(total).toHaveTextContent('+$55.00');
    expect(total).toHaveTextContent('$3,897');
    expect(total).toHaveTextContent('— excludes 1 without a price');
  });

  it('loss renders with TRUE MINUS on both parts', () => {
    const loss = buildPositions([{ id: 1, name: 'B' }], [h(31, 1, 'VTI', 10, 2600)], INFO, prices);
    renderSection(loss);
    // gain = 2,455 − 2,600 = −145; pct = 145 / 2,600 = 5.6%
    expect(screen.getByTestId('position-row-31')).toHaveTextContent('−$145.00');
    expect(screen.getByTestId('position-row-31')).toHaveTextContent('(−5.6%)');
  });

  it('fractional quantity renders toFixed(3); marker math holds off-fixture (D-PT10)', () => {
    const rng = buildPositions(
      [{ id: 1, name: 'C' }], [h(41, 1, 'RNG', 1.5, null)],
      new Map([['RNG', info(null, 61.1, 78.9)]]),
      [p('RNG', '2026-08-08', 72.1)],
    );
    renderSection(rng);
    const row = screen.getByTestId('position-row-41');
    expect(row).toHaveTextContent('$61.10');
    expect(row).toHaveTextContent('$78.90');
    expect(row).toHaveTextContent('1.500');
    const marker = screen.getByTestId('week52-marker-41');
    expect(parseFloat(marker.style.left)).toBeCloseTo(61.8, 1); // (72.1 − 61.1) / 17.8
  });

  it('zero cached prices anywhere → CP-8 as-of line (resolved-empty)', () => {
    renderSection(buildPositions([{ id: 1, name: 'D' }], [h(51, 1, 'XYZ', 3, null)], new Map(), []));
    expect(screen.getByTestId('positions-as-of')).toHaveTextContent(
      'No cached prices yet — prices fill in when you refresh market data.',
    );
  });

  it('price rows not yet loaded (null) → NO as-of caption at all; rows still render dashed (m3)', () => {
    renderSection(buildPositions([{ id: 1, name: 'D' }], [h(51, 1, 'XYZ', 3, null)], new Map(), null));
    // The false "No cached prices yet" flash is the bug — until the SELECT
    // resolves we don't know, so neither CP-3 nor CP-8 may render.
    expect(screen.queryByTestId('positions-as-of')).toBeNull();
    // Only the caption is gated: the rows render (dashed) during the frame.
    expect(screen.getByTestId('position-row-51')).toBeInTheDocument();
  });

  it('no visible holdings → CP-7 empty state, no captions', () => {
    renderSection(buildPositions([], [], new Map(), []));
    expect(screen.getByText('No holdings with values yet.')).toBeInTheDocument();
    expect(screen.queryByTestId('positions-as-of')).toBeNull();
  });

  it('all-unpriced account total renders the excludes suffix ALONE — no leading dash (m1)', () => {
    renderSection(buildPositions([{ id: 1, name: 'F' }], [h(71, 1, 'XYZ', 3, 50)], new Map(), []));
    const total = screen.getByTestId('positions-total-1');
    const cells = within(total).getAllByRole('cell');
    // Row layout: label · (empty) · since-refresh · (empty) · value · (colspan)
    const valueCell = cells[4];
    expect(valueCell.textContent?.replace(/\s+/g, ' ').trim()).toBe('— excludes 1 without a price');
  });

  it('null total with zero unpriced rows renders the dash alone (m1 branch total)', () => {
    // Not constructible via buildPositions (null total implies unpriced rows
    // exist) — hand-built to total the branches per the m1 ruling.
    render(
      <PositionsSection
        positions={{
          pricesResolved: true,
          asOfUtc: null,
          accounts: [
            {
              accountId: 9,
              accountName: 'Z',
              rows: [],
              totalValue: null,
              totalSinceRefresh: null,
              unpricedCount: 0,
            },
          ],
        }}
      />,
    );
    const total = screen.getByTestId('positions-total-9');
    const cells = within(total).getAllByRole('cell');
    expect(cells[4].textContent?.replace(/\s+/g, ' ').trim()).toBe('—');
  });
});
