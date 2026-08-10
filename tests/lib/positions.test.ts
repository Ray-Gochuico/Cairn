import { describe, it, expect } from 'vitest';
import type { Holding } from '@/types/schema';
import { buildPositions, type PriceCacheRow, type TickerPositionInfo } from '@/lib/positions';

function h(id: number, accountId: number, ticker: string, shareCount: number, costBasis: number | null): Holding {
  return { id, accountId, ticker, shareCount, targetAllocationPct: null, costBasis } as Holding;
}
function p(ticker: string, date: string, price: number): PriceCacheRow {
  return { ticker, date, price, fetched_at: `${date} 20:10:00` };
}
function info(name: string | null, low: number | null, high: number | null): TickerPositionInfo {
  return { name, fiftyTwoWeekLow: low, fiftyTwoWeekHigh: high };
}

const INFO = new Map<string, TickerPositionInfo>([
  ['VTI', info('Vanguard Total Stock Market ETF', 200, 250)],
]);

describe('buildPositions — market values, deltas, % of account, totals', () => {
  // One account, three holdings: priced-with-two-dates, priced-with-one-date, unpriced.
  const accounts = [{ id: 1, name: 'Brokerage' }, { id: 2, name: 'Empty Acct' }];
  const holdings = [
    h(11, 1, 'VTI', 10, 2000),  // two cached dates + basis + fetched 52-week fields
    h(12, 1, 'BND', 20, null),  // one cached date, null basis, no ticker info
    h(13, 1, 'ABC', 5, 100),    // no cached price at all
  ];
  const prices = [p('VTI', '2026-08-07', 240), p('VTI', '2026-08-08', 245.5), p('BND', '2026-08-08', 72.1)];
  const result = buildPositions(accounts, holdings, INFO, prices);
  const acct = result.accounts[0];
  const [vti, bnd, abc] = acct.rows;

  it('skips accounts with no holdings and keeps input account order', () => {
    expect(result.accounts).toHaveLength(1);
    expect(acct.accountId).toBe(1);
    expect(acct.accountName).toBe('Brokerage');
  });

  it('sorts priced rows by value desc, unpriced last', () => {
    expect(acct.rows.map((r) => r.ticker)).toEqual(['VTI', 'BND', 'ABC']);
  });

  it('VTI: market value, since-refresh from the last two cached dates, total gain vs basis', () => {
    expect(vti.key).toBe('11');
    expect(vti.name).toBe('Vanguard Total Stock Market ETF');
    expect(vti.lastPrice).toBe(245.5);
    expect(vti.lastPriceDate).toBe('2026-08-08');
    expect(vti.currentValue).toBeCloseTo(2455, 6);               // 245.50 × 10
    expect(vti.sinceRefreshValue).toBeCloseTo(55, 6);            // (245.50 − 240.00) × 10
    expect(vti.sinceRefreshPct).toBeCloseTo(0.0229167, 6);       // 5.5 / 240
    expect(vti.totalGainValue).toBeCloseTo(455, 6);              // 2,455 − 2,000
    expect(vti.totalGainPct).toBeCloseTo(0.2275, 6);             // 455 / 2,000
    expect(vti.costBasisPerShare).toBeCloseTo(200, 6);           // 2,000 / 10
  });

  it('VTI: fetched 52-week fields pass through with a clamped marker', () => {
    expect(vti.week52Low).toBe(200);
    expect(vti.week52High).toBe(250);
    expect(vti.week52MarkerPct).toBeCloseTo(0.91, 6);            // (245.5 − 200) / 50
  });

  it('BND: one cached date → since-refresh null; null basis → gain + per-share null; no info → 52w null', () => {
    expect(bnd.lastPrice).toBe(72.1);
    expect(bnd.currentValue).toBeCloseTo(1442, 6);               // 72.10 × 20
    expect(bnd.sinceRefreshValue).toBeNull();
    expect(bnd.sinceRefreshPct).toBeNull();
    expect(bnd.totalGainValue).toBeNull();
    expect(bnd.costBasisPerShare).toBeNull();
    expect(bnd.week52Low).toBeNull();
    expect(bnd.week52MarkerPct).toBeNull();
  });

  it('ABC (no cached price): every price-derived field null; entered data kept', () => {
    expect(abc.lastPrice).toBeNull();
    expect(abc.currentValue).toBeNull();
    expect(abc.sinceRefreshValue).toBeNull();
    expect(abc.totalGainValue).toBeNull();
    expect(abc.pctOfAccount).toBeNull();
    expect(abc.quantity).toBe(5);
    expect(abc.costBasis).toBe(100);
    expect(abc.costBasisPerShare).toBeCloseTo(20, 6);
  });

  it('% of account uses the priced-only denominator', () => {
    // priced total = 2,455 + 1,442 = 3,897
    expect(vti.pctOfAccount).toBeCloseTo(0.6299718, 6);          // 2,455 / 3,897
    expect(bnd.pctOfAccount).toBeCloseTo(0.3700282, 6);          // 1,442 / 3,897
  });

  it('account totals: priced sum, delta sum over rows that have one, unpriced count', () => {
    expect(acct.totalValue).toBeCloseTo(3897, 6);
    expect(acct.totalSinceRefresh).toBeCloseTo(55, 6);           // only VTI has a delta
    expect(acct.unpricedCount).toBe(1);
  });

  it('asOfUtc is the lexical max fetched_at across held tickers', () => {
    expect(result.asOfUtc).toBe('2026-08-08 20:10:00');
  });
});

describe('buildPositions — multi-account, no cross-account aggregation', () => {
  const accounts = [{ id: 1, name: 'Brokerage' }, { id: 2, name: 'Roth IRA' }];
  const holdings = [h(21, 1, 'VTI', 10, null), h(22, 2, 'VTI', 4, null), h(23, 2, 'BND', 20, null)];
  const prices = [p('VTI', '2026-08-07', 240), p('VTI', '2026-08-08', 245.5), p('BND', '2026-08-08', 72.1)];
  const result = buildPositions(accounts, holdings, new Map(), prices);

  it('keeps VTI as a separate row in each account (no lot merging)', () => {
    expect(result.accounts.map((a) => a.accountId)).toEqual([1, 2]);
    expect(result.accounts[0].rows.map((r) => r.ticker)).toEqual(['VTI']);
    // Acct 2 sorts by value desc: BND 1,442 > VTI 982 (245.50 × 4)
    expect(result.accounts[1].rows.map((r) => r.ticker)).toEqual(['BND', 'VTI']);
  });

  it('per-account denominators and delta sums', () => {
    const roth = result.accounts[1];
    const [rBnd, rVti] = roth.rows;
    expect(rVti.currentValue).toBeCloseTo(982, 6);
    expect(rVti.pctOfAccount).toBeCloseTo(0.4051155, 6);         // 982 / 2,424
    expect(rBnd.pctOfAccount).toBeCloseTo(0.5948845, 6);         // 1,442 / 2,424
    expect(roth.totalValue).toBeCloseTo(2424, 6);
    expect(roth.totalSinceRefresh).toBeCloseTo(22, 6);           // (245.50 − 240.00) × 4; BND has one date
  });
});

describe('buildPositions — 52-week fetched-field rules (D-P4 revised)', () => {
  const build = (tickerInfo: Map<string, TickerPositionInfo>, prices: PriceCacheRow[]) =>
    buildPositions([{ id: 1, name: 'A' }], [h(1, 1, 'T', 1, null)], tickerInfo, prices).accounts[0].rows[0];

  it('either field null → all three outputs null (spec rule)', () => {
    const row = build(new Map([['T', info(null, 60, null)]]), [p('T', '2026-08-08', 70)]);
    expect(row.week52Low).toBeNull();
    expect(row.week52High).toBeNull();
    expect(row.week52MarkerPct).toBeNull();
  });

  it('marker clamps above the fetched high (stale-range honesty)', () => {
    const row = build(new Map([['T', info(null, 200, 240)]]), [p('T', '2026-08-08', 245.5)]);
    expect(row.week52MarkerPct).toBe(1);
  });

  it('marker clamps below the fetched low', () => {
    const row = build(new Map([['T', info(null, 250, 260)]]), [p('T', '2026-08-08', 245.5)]);
    expect(row.week52MarkerPct).toBe(0);
  });

  it('degenerate low === high → marker 0.5', () => {
    const row = build(new Map([['T', info(null, 245.5, 245.5)]]), [p('T', '2026-08-08', 245.5)]);
    expect(row.week52MarkerPct).toBe(0.5);
  });

  it('fields present but row UNPRICED → labels pass through, marker null (D-PT3)', () => {
    const row = build(new Map([['T', info(null, 10, 20)]]), []);
    expect(row.week52Low).toBe(10);
    expect(row.week52High).toBe(20);
    expect(row.week52MarkerPct).toBeNull();
  });
});

describe('buildPositions — honest edges', () => {
  it('all rows unpriced → totalValue null (never $0), totalSinceRefresh null', () => {
    const r = buildPositions([{ id: 1, name: 'A' }], [h(1, 1, 'XYZ', 3, 50)], new Map(), []);
    expect(r.accounts[0].totalValue).toBeNull();
    expect(r.accounts[0].totalSinceRefresh).toBeNull();
    expect(r.accounts[0].unpricedCount).toBe(1);
    expect(r.asOfUtc).toBeNull();
  });

  it('stale single price (any age) still prices the row — the caption carries the honesty (D-P6)', () => {
    const r = buildPositions(
      [{ id: 1, name: 'A' }], [h(1, 1, 'STALE', 2, null)], new Map(),
      [p('STALE', '2024-06-01', 50)],
    );
    const row = r.accounts[0].rows[0];
    expect(row.lastPrice).toBe(50);
    expect(row.lastPriceDate).toBe('2024-06-01');
    expect(row.currentValue).toBeCloseTo(100, 6);
    expect(row.sinceRefreshValue).toBeNull();
  });

  it('zero shares → value 0 (priced), per-share basis null (no divide-by-zero)', () => {
    const r = buildPositions(
      [{ id: 1, name: 'A' }], [h(1, 1, 'VTI', 0, 500)], new Map(),
      [p('VTI', '2026-08-08', 245.5)],
    );
    const row = r.accounts[0].rows[0];
    expect(row.currentValue).toBe(0);
    expect(row.costBasisPerShare).toBeNull();
  });

  it('no holdings → empty result', () => {
    const r = buildPositions([{ id: 1, name: 'A' }], [], new Map(), []);
    expect(r.accounts).toEqual([]);
    expect(r.asOfUtc).toBeNull();
  });
});

describe('buildPositions — not-yet-loaded vs resolved-empty price rows (m3)', () => {
  it('null price rows (SELECT not yet resolved) → pricesResolved false; rows still build unpriced', () => {
    const r = buildPositions([{ id: 1, name: 'A' }], [h(1, 1, 'VTI', 10, null)], new Map(), null);
    expect(r.pricesResolved).toBe(false);
    expect(r.accounts).toHaveLength(1);
    expect(r.accounts[0].rows[0].lastPrice).toBeNull();
    expect(r.accounts[0].rows[0].quantity).toBe(10);
    expect(r.asOfUtc).toBeNull();
  });

  it('empty array (resolved-empty) → pricesResolved true', () => {
    const r = buildPositions([{ id: 1, name: 'A' }], [h(1, 1, 'VTI', 10, null)], new Map(), []);
    expect(r.pricesResolved).toBe(true);
  });

  it('populated rows → pricesResolved true', () => {
    const r = buildPositions(
      [{ id: 1, name: 'A' }], [h(1, 1, 'VTI', 10, null)], new Map(),
      [p('VTI', '2026-08-08', 245.5)],
    );
    expect(r.pricesResolved).toBe(true);
  });
});
