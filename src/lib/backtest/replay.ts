import { loadShillerAnnual } from '@/data/shiller-schema';
import { blendedRealReturn } from './data';

/**
 * W1 (D-W1-6 / DP-3): the Backtest form's default stock mix — THE single
 * shared constant. `Backtest.tsx`'s config seed imports this; the stress
 * card's rail seeds from it when no valid last-run record exists.
 */
export const DEFAULT_STOCK_PCT = 0.75;

/** A calendar year's PRE-BLENDED real return (today's-dollars basis). */
export interface ReplayRow {
  year: number;
  realReturn: number;
}

/**
 * W1 (D-W1-3 / DP-1): maps every dataset year through `blendedRealReturn` —
 * THE reuse point. The bond leg's deflation to real (the nominal-on-real
 * guard) lives in data.ts and is inherited here, never reimplemented. The
 * pure replay core below consumes these rows (or synthetic ones in tests).
 */
export function datasetReplayRows(stockPct: number): ReplayRow[] {
  return loadShillerAnnual().map((r) => ({
    year: r.year,
    realReturn: blendedRealReturn(r.year, stockPct),
  }));
}

/**
 * One calendar year at the pinned cadence (D-W1-4 / DP-2): monthly rate
 * m = (1+r)^(1/12) − 1 over 12 steps, annualContribution/12 added at each
 * step's END. This closed form IS that loop (geometric series):
 *   B(1+r) + (C/12)·(r/m)
 * C = 0 → exactly B(1+r), so a zero-contribution replay equals the exact
 * product of annual factors; r = 0 → B + C (m would be 0). The carry never
 * rounds — display layers round.
 */
export function yearEnd(balance: number, realReturn: number, annualContribution: number): number {
  if (annualContribution === 0) return balance * (1 + realReturn);
  if (realReturn === 0) return balance + annualContribution;
  const m = Math.pow(1 + realReturn, 1 / 12) - 1;
  return balance * (1 + realReturn) + (annualContribution / 12) * (realReturn / m);
}

export interface ReplayWindowInput {
  startBalance: number;
  /** KEEP mode: flows through EVERY replayed year including the recovery tail; 0 = portfolio-only. */
  annualContribution: number;
  span: { startYear: number; endYear: number };
  /** Ascending contiguous years covering span.startYear..(dataset end). */
  rows: ReadonlyArray<ReplayRow>;
}

export interface ReplayYearEnd {
  year: number;
  balance: number;
}

export interface ReplayWindowResult {
  /** span.startYear through the last row's year (the recovery search range). */
  yearEnds: ReplayYearEnd[];
  /** Deepest year-end WITHIN the named span; ties break to the earliest year. */
  troughYear: number;
  troughBalance: number;
  /** Year-end balance at span.endYear. */
  windowEndBalance: number;
  /**
   * First year-end ≥ startBalance AFTER the trough year, through dataset end;
   * null = never. When the trough never falls below the start (the DP-15
   * outpaced state) the plain first-≥-start scan stands.
   */
  recoveredYear: number | null;
}

/**
 * W1 stress replay (D-W1-9): pure, date-free — calendar years are data keys,
 * not clock reads. Replays from span.startYear through the LAST provided row
 * (the recovery search may run years past the span). Throws when the rows do
 * not cover the span — the card layer disables such windows (CP-24) before
 * ever calling this.
 */
export function replayWindow(input: ReplayWindowInput): ReplayWindowResult {
  const { startBalance, annualContribution, span, rows } = input;
  const replayRows = rows.filter((r) => r.year >= span.startYear);
  if (replayRows.length === 0 || replayRows[0].year !== span.startYear) {
    throw new Error(`Replay rows do not cover span start ${span.startYear}`);
  }
  const lastYear = replayRows[replayRows.length - 1].year;
  if (span.endYear > lastYear) {
    throw new Error(`Replay rows end at ${lastYear}, before span end ${span.endYear}`);
  }

  let balance = startBalance; // the carry — never rounded (D-W1-4)
  const yearEnds: ReplayYearEnd[] = [];
  for (const row of replayRows) {
    balance = yearEnd(balance, row.realReturn, annualContribution);
    yearEnds.push({ year: row.year, balance });
  }

  let troughYear = span.startYear;
  let troughBalance = Number.POSITIVE_INFINITY;
  for (const ye of yearEnds) {
    if (ye.year > span.endYear) break;
    if (ye.balance < troughBalance) {
      // strict < ⇒ ties break to the earliest year
      troughBalance = ye.balance;
      troughYear = ye.year;
    }
  }

  const windowEndBalance = yearEnds.find((y) => y.year === span.endYear)!.balance;
  // Review MAJOR 0/2: a recovery is a return to the starting value AFTER the
  // loss. Searching from the span start let a KEEP-mode year 1 whose
  // contributions outpaced a moderate first-year loss report "recovered" two
  // years BEFORE the trough it is rendered beside (the card's default state
  // did exactly that). Search past the trough whenever the portfolio actually
  // fell below its start; the DP-15 outpaced case (trough ≥ start — no
  // drawdown to recover from, and the card replaces that row with CP-15)
  // keeps the plain scan.
  const recovered =
    troughBalance < startBalance
      ? yearEnds.find((y) => y.year > troughYear && y.balance >= startBalance) // ≥, not > (pinned)
      : yearEnds.find((y) => y.balance >= startBalance);
  return {
    yearEnds,
    troughYear,
    troughBalance,
    windowEndBalance,
    recoveredYear: recovered?.year ?? null,
  };
}

/**
 * The D-W1-9 "your assumed path" baseline: the SAME yearly cadence compounded
 * at a constant (already-real) rate for n years. Sharing `yearEnd` means the
 * comparison row can never diverge from the replay's arithmetic.
 */
export function flatPathEnd(
  startBalance: number,
  realRate: number,
  annualContribution: number,
  years: number,
): number {
  let balance = startBalance;
  for (let i = 0; i < years; i++) balance = yearEnd(balance, realRate, annualContribution);
  return balance;
}
