import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STOCK_PCT,
  datasetReplayRows,
  flatPathEnd,
  replayWindow,
  yearEnd,
  type ReplayRow,
} from '@/lib/backtest/replay';

/** Synthetic pre-blended rows: years ascending from startYear. */
const mkRows = (startYear: number, returns: number[]): ReplayRow[] =>
  returns.map((realReturn, i) => ({ year: startYear + i, realReturn }));

describe('yearEnd cadence (D-W1-4 / DP-2)', () => {
  it('zero contribution is EXACTLY the annual factor (no monthly float drift)', () => {
    expect(yearEnd(100_000, -0.086241, 0)).toBe(100_000 * (1 - 0.086241));
  });

  it('closed form equals the 12-step month-end loop (hand pin: B 1000, r 5%, C 1200 → 2277.257753)', () => {
    const m = Math.pow(1.05, 1 / 12) - 1;
    let loop = 1000;
    for (let i = 0; i < 12; i++) loop = loop * (1 + m) + 100;
    const closed = yearEnd(1000, 0.05, 1200);
    expect(closed).toBeCloseTo(loop, 8);
    expect(closed).toBeCloseTo(2277.257753, 5);
  });

  it('r = 0 is the exact sum: B + C', () => {
    expect(yearEnd(1000, 0, 1200)).toBe(2200);
  });
});

describe('replayWindow metrics (D-W1-9)', () => {
  it('trough/end/recovery on a synthetic dip-and-recover path', () => {
    // 100k: −50% → 50k, +20% → 60k, +50% → 90k, +60% → 144k. Span = first two years.
    const r = replayWindow({
      startBalance: 100_000,
      annualContribution: 0,
      span: { startYear: 2000, endYear: 2001 },
      rows: mkRows(2000, [-0.5, 0.2, 0.5, 0.6]),
    });
    expect(r.yearEnds.map((y) => y.year)).toEqual([2000, 2001, 2002, 2003]);
    expect(r.troughYear).toBe(2000);
    expect(r.troughBalance).toBeCloseTo(50_000, 2);
    expect(r.windowEndBalance).toBeCloseTo(60_000, 2);
    expect(r.recoveredYear).toBe(2003); // first year-end ≥ start, searched past the span
  });

  it('recovery is the first year-end ≥ start AFTER the trough — never a pre-drawdown year', () => {
    // Review MAJOR 0/2: KEEP-mode contributions lift year 1 ABOVE the start
    // before the crash bites. A year the portfolio never left is not a
    // recovery; the honest answer is the first year-end ≥ start past the
    // trough. 100k: +10% → 110k (above start), −30% → 77k (the trough),
    // +50% → 115.5k (the real recovery).
    const r = replayWindow({
      startBalance: 100_000,
      annualContribution: 0,
      span: { startYear: 2000, endYear: 2001 },
      rows: mkRows(2000, [0.1, -0.3, 0.5]),
    });
    expect(r.troughYear).toBe(2001);
    expect(r.troughBalance).toBeCloseTo(77_000, 2);
    expect(r.recoveredYear).toBe(2002);
    expect(r.recoveredYear!).toBeGreaterThan(r.troughYear);
  });

  it('the DP-15 outpaced path is unchanged: trough ≥ start keeps the first-year-end answer', () => {
    // Every year-end sits at or above the start, so there is no drawdown to
    // recover from — the search stays the plain first-≥-start scan (the card
    // suppresses the row in KEEP mode, CP-15).
    const r = replayWindow({
      startBalance: 100_000,
      annualContribution: 0,
      span: { startYear: 2000, endYear: 2001 },
      rows: mkRows(2000, [0.05, 0.05]),
    });
    expect(r.troughBalance).toBeGreaterThanOrEqual(100_000);
    expect(r.recoveredYear).toBe(2000);
  });

  it('recovery is ≥ not > (recovered exactly at the starting value counts)', () => {
    // −50% then +100%: 50k → 100k exactly (zero-contribution path is exact factors).
    const r = replayWindow({
      startBalance: 100_000,
      annualContribution: 0,
      span: { startYear: 2000, endYear: 2000 },
      rows: mkRows(2000, [-0.5, 1.0]),
    });
    expect(r.recoveredYear).toBe(2001);
  });

  it('null recovery when no year-end reaches the start by dataset end', () => {
    const r = replayWindow({
      startBalance: 100_000,
      annualContribution: 0,
      span: { startYear: 2000, endYear: 2001 },
      rows: mkRows(2000, [-0.3, 0.1, 0.1]),
    });
    expect(r.recoveredYear).toBeNull();
  });

  it('trough ties break to the EARLIEST year (strict less-than scan)', () => {
    // Two equal minima inside the span: −20% then 0% keeps the same balance.
    const r = replayWindow({
      startBalance: 100_000,
      annualContribution: 0,
      span: { startYear: 2000, endYear: 2001 },
      rows: mkRows(2000, [-0.2, 0]),
    });
    expect(r.troughYear).toBe(2000);
    expect(r.troughBalance).toBeCloseTo(80_000, 2);
  });

  it('KEEP mode: contributions flow through every year INCLUDING the recovery tail', () => {
    // r = 0 everywhere isolates the contribution cadence: +12k/yr.
    const r = replayWindow({
      startBalance: 100_000,
      annualContribution: 12_000,
      span: { startYear: 2000, endYear: 2000 },
      rows: mkRows(2000, [0, 0, 0]),
    });
    expect(r.yearEnds.map((y) => y.balance)).toEqual([112_000, 124_000, 136_000]);
  });

  it('the carry never rounds: sub-cent precision survives across years', () => {
    const a = replayWindow({
      startBalance: 100_000,
      annualContribution: 0,
      span: { startYear: 2000, endYear: 2001 },
      rows: mkRows(2000, [0.123456, 0.234567]),
    });
    expect(a.windowEndBalance).toBeCloseTo(100_000 * 1.123456 * 1.234567, 6);
  });

  it('throws when the span is not covered by the rows (the card disables such chips; the module refuses)', () => {
    expect(() =>
      replayWindow({
        startBalance: 100_000,
        annualContribution: 0,
        span: { startYear: 1999, endYear: 2000 },
        rows: mkRows(2000, [0.1]),
      }),
    ).toThrow();
  });
});

describe('HISTORICAL ANCHORS — real dataset through datasetReplayRows (re-derive by hand before trusting)', () => {
  const replay = (startYear: number, endYear: number, stockPct: number) =>
    replayWindow({
      startBalance: 100_000,
      annualContribution: 0,
      span: { startYear, endYear },
      rows: datasetReplayRows(stockPct),
    });

  it('P1 dot-com 2000–02, 100% stocks: $60,858.41 end AND trough (−39.14%)', () => {
    const r = replay(2000, 2002, 1);
    expect(r.windowEndBalance).toBeCloseTo(60_858.41, 2);
    expect(r.troughBalance).toBeCloseTo(60_858.41, 2);
    expect(r.troughYear).toBe(2002);
  });

  it('P2 GFC 2008, 60/40: $84,504.99 — the bond-leg cushion via the REAL bond return', () => {
    const r = replay(2008, 2008, 0.6);
    expect(r.windowEndBalance).toBeCloseTo(84_504.99, 2);
  });

  it('P3 THE nominal-on-real anchor — 1973–74, 60/40: $66,517.39 real; a nominal bond leg would read ~$73,158.09', () => {
    const r = replay(1973, 1974, 0.6);
    expect(r.windowEndBalance).toBeCloseTo(66_517.39, 2);
    // The leak the anchor exists to catch: assert we are FAR from the wrong-basis figure.
    expect(Math.abs(r.windowEndBalance - 73_158.09)).toBeGreaterThan(6_000);
  });

  it('THE default-card anchor — 1929–31 KEEP, 75/25, $100k + $12k/yr: trough 1931, recovery 1932', () => {
    // Re-derived from the literal src/data/shiller.ts rows (blend =
    // 0.75·sp500RealReturn + 0.25·((1+treasury)/(1+implied)−1), implied =
    // (1+nominal)/(1+real)−1; cadence B(1+r) + (C/12)(r/m)):
    //   1929 $106,181.39 · 1930 $107,006.19 · 1931 $90,195.78 · 1932 $109,478.57
    // Year 1 sits ABOVE the $100k start (contributions outpace a −5.9% blend),
    // so the pre-review first-≥-start scan answered 1929 — two years BEFORE
    // the trough it is rendered beside. The honest answer is 1932.
    const r = replayWindow({
      startBalance: 100_000,
      annualContribution: 12_000,
      span: { startYear: 1929, endYear: 1931 },
      rows: datasetReplayRows(DEFAULT_STOCK_PCT),
    });
    expect(r.yearEnds[0].balance).toBeCloseTo(106_181.39, 2);
    expect(r.yearEnds[1].balance).toBeCloseTo(107_006.19, 2);
    expect(r.troughYear).toBe(1931);
    expect(r.troughBalance).toBeCloseTo(90_195.78, 2);
    expect(r.windowEndBalance).toBeCloseTo(90_195.78, 2);
    expect(r.recoveredYear).toBe(1932);
    expect(r.yearEnds.find((y) => y.year === 1932)!.balance).toBeCloseTo(109_478.57, 2);
  });

  it('datasetReplayRows covers the full 1871–2022 dataset in ascending order', () => {
    const rows = datasetReplayRows(DEFAULT_STOCK_PCT);
    expect(rows[0].year).toBe(1871);
    expect(rows[rows.length - 1].year).toBe(2022);
    expect(rows.length).toBe(152);
  });
});

describe('flatPathEnd (the D-W1-9 baseline, same cadence by construction)', () => {
  it('equals replayWindow over constant synthetic rows', () => {
    const viaReplay = replayWindow({
      startBalance: 100_000,
      annualContribution: 12_000,
      span: { startYear: 1, endYear: 3 },
      rows: mkRows(1, [0.03, 0.03, 0.03]),
    }).windowEndBalance;
    expect(flatPathEnd(100_000, 0.03, 12_000, 3)).toBeCloseTo(viaReplay, 8);
  });

  it('zero years returns the start balance untouched', () => {
    expect(flatPathEnd(100_000, 0.05, 12_000, 0)).toBe(100_000);
  });
});

describe('DEFAULT_STOCK_PCT (D-W1-6 single source)', () => {
  it('is 0.75 — the Backtest form default', () => {
    expect(DEFAULT_STOCK_PCT).toBe(0.75);
  });
});
