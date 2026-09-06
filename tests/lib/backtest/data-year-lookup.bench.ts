// @vitest-environment node
import { bench, describe } from 'vitest';
import { loadShillerAnnual } from '@/data/shiller-schema';
import { blendedRealReturn, blendedRealReturnForRow } from '@/lib/backtest/data';

/**
 * W-I D-I10 — the before/after for the year→row index, both shapes side by
 * side so the comparison reproduces at any commit:
 *   A: the v1.6.0 shape — a linear .find() per year, kept HERE as the reference;
 *   B: blendedRealReturn as shipped.
 * Run: npx vitest bench tests/lib/backtest/data-year-lookup.bench.ts
 * Not a .test. file — `npm test` never runs it; tinybench ships inside vitest.
 */
const rows = loadShillerAnnual();
const years = rows.map((r) => r.year);
const STOCK = 0.75;
const HORIZON = 30;
const starts = years.filter((y) => y + HORIZON - 1 <= years[years.length - 1]);

function linear(year: number): number {
  const row = rows.find((r) => r.year === year);
  if (!row) throw new Error(`No Shiller data for year ${year}`);
  return blendedRealReturnForRow(row, STOCK);
}
const keep = (n: number) => {
  if (!Number.isFinite(n)) throw new Error('non-finite accumulator');
};

describe(`stress-replay shape: every dataset year once (${years.length} lookups)`, () => {
  bench('A: linear .find() per year (v1.6.0)', () => {
    let acc = 0;
    for (const y of years) acc += linear(y);
    keep(acc);
  });
  bench('B: blendedRealReturn (Map, W-I)', () => {
    let acc = 0;
    for (const y of years) acc += blendedRealReturn(y, STOCK);
    keep(acc);
  });
});

describe(`backtest shape: every ${HORIZON}-year start × ${HORIZON} years (${starts.length * HORIZON} lookups)`, () => {
  bench('A: linear .find() per year (v1.6.0)', () => {
    let acc = 0;
    for (const s of starts) for (let k = 0; k < HORIZON; k++) acc += linear(s + k);
    keep(acc);
  });
  bench('B: blendedRealReturn (Map, W-I)', () => {
    let acc = 0;
    for (const s of starts) for (let k = 0; k < HORIZON; k++) acc += blendedRealReturn(s + k, STOCK);
    keep(acc);
  });
});
