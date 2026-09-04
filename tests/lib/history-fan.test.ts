import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  HISTORY_FAN_MIN_SEQUENCES,
  HISTORY_STOCK_PCT,
  historyFan,
  type HistoryFanResult,
} from '@/lib/history-fan';
import { blendedRealReturn } from '@/lib/backtest/data';
import { loadShillerAnnual } from '@/data/shiller-schema';
import type { ShillerAnnualRow } from '@/data/shiller';

/** Fixture row builder: sp500Nominal = sp500Real ⇒ implied inflation 0 ⇒ the
 *  bond leg deflates to itself ⇒ blend === r at ANY stockPct. */
const fx = (year: number, r: number): ShillerAnnualRow => ({
  year,
  sp500NominalReturn: r,
  sp500RealReturn: r,
  tenYearTreasuryReturn: r,
  cpi: 100,
});
// Spec §Testing fixture: 2001 +10%, 2002 −10%, 2003 +20%, 2004 0%, 2005 +5%, 2006 −5%.
const FIXTURE: ShillerAnnualRow[] = [
  fx(2001, 0.1),
  fx(2002, -0.1),
  fx(2003, 0.2),
  fx(2004, 0),
  fx(2005, 0.05),
  fx(2006, -0.05),
];
const BASE = { pv: 1000, annualContribution: 100, horizonYears: 3, target: 1400, rows: FIXTURE };

const EMPTY_SHAPE = {
  m: 0,
  startYears: null,
  byYear: { p25: [], p50: [], p75: [] },
  holds: null,
};

describe('historyFan — fixture census (hand-computed in the spec)', () => {
  // Worked paths (transcribed from the spec, not derived):
  // s2001 → 1200, 1180, 1516 · s2002 → 1000, 1300, 1400
  // s2003 → 1300, 1400, 1570 · s2004 → 1100, 1255, 1292.25
  it('enumerates all overlapping windows: m=4, starts 2001–2004', () => {
    const r = historyFan(BASE);
    expect(r.m).toBe(4);
    expect(r.startYears).toEqual({ first: 2001, last: 2004 });
  });
  it('year-3 percentiles: linear interp then round', () => {
    const r = historyFan(BASE);
    expect(r.byYear.p25[3]).toBe(1373);
    expect(r.byYear.p50[3]).toBe(1458);
    expect(r.byYear.p75[3]).toBe(1530);
  });
  it('year-1 median and the degenerate year-0 anchor', () => {
    const r = historyFan(BASE);
    expect(r.byYear.p50[1]).toBe(1150);
    expect(r.byYear.p25[0]).toBe(1000);
    expect(r.byYear.p50[0]).toBe(1000);
    expect(r.byYear.p75[0]).toBe(1000);
    expect(r.byYear.p50).toHaveLength(4); // H+1 rows
  });
  it('holds: path-wise, exact-equality touch counts, count=3', () => {
    // s2002 counts on the exact year-3 touch (=1400); s2003 on year 2; s2004 never.
    const r = historyFan(BASE);
    expect(r.holds).toEqual({ count: 3, target: 1400 });
  });
  it('monotonicity: p25 ≤ p50 ≤ p75 pointwise', () => {
    const r = historyFan(BASE);
    for (let k = 0; k <= 3; k++) {
      expect(r.byYear.p25[k]).toBeLessThanOrEqual(r.byYear.p50[k]);
      expect(r.byYear.p50[k]).toBeLessThanOrEqual(r.byYear.p75[k]);
    }
  });
  it('raising the target never raises the count (1517 ⇒ only s2003)', () => {
    expect(historyFan({ ...BASE, target: 1517 }).holds).toEqual({ count: 1, target: 1517 });
  });
  it('target absent or ≤ 0 ⇒ holds null', () => {
    expect(historyFan({ ...BASE, target: undefined }).holds).toBeNull();
    expect(historyFan({ ...BASE, target: 0 }).holds).toBeNull();
    expect(historyFan({ ...BASE, target: -5 }).holds).toBeNull();
  });
  it('pv ≥ target ⇒ every stretch holds at year 0', () => {
    expect(historyFan({ ...BASE, target: 500 }).holds).toEqual({ count: 4, target: 500 });
  });
  /* W2 review fix (MAJOR 2): the pin above cannot see the year-0 clause of
     D-UB9 — on BASE every path is ≥ 500 at year 1 too, so a k=1…H recurrence
     satisfies it. Here pv === target and the contribution is 0 at H = 1, so
     2002 (900) and 2006 (950) hold ONLY at year 0: skipping k = 0 gives 4. */
  it('year 0 is a holding year: pv === target with H=1 ⇒ all 6 stretches hold', () => {
    expect(
      historyFan({ ...BASE, annualContribution: 0, horizonYears: 1, target: 1000 }).holds,
    ).toEqual({ count: 6, target: 1000 });
  });
});

describe('historyFan — engine/UI policy split (spec m1)', () => {
  it('H beyond coverage ⇒ the empty shape', () => {
    expect(historyFan({ ...BASE, horizonYears: 7 })).toMatchObject(EMPTY_SHAPE);
  });
  it('horizonYears < 1 ⇒ the empty shape', () => {
    expect(historyFan({ ...BASE, horizonYears: 0 })).toMatchObject(EMPTY_SHAPE);
  });
  it('non-integer horizonYears ⇒ the empty shape (D-P1)', () => {
    expect(historyFan({ ...BASE, horizonYears: 2.5 })).toMatchObject(EMPTY_SHAPE);
  });
  it('below-M_MIN still computes fully — the threshold is a UI rule only', () => {
    const r = historyFan({ ...BASE, horizonYears: 5 }); // m = 2 < 30
    expect(r.m).toBe(2);
    expect(r.m).toBeLessThan(HISTORY_FAN_MIN_SEQUENCES);
    expect(r.byYear.p50).toHaveLength(6);
    expect(r.holds).not.toBeNull();
  });
  it('exports the constants the UI keys on', () => {
    expect(HISTORY_FAN_MIN_SEQUENCES).toBe(30);
    expect(HISTORY_STOCK_PCT).toBe(0.75);
  });
});

describe('historyFan — real-dataset historical anchors (the nominal-on-real tripwire)', () => {
  const INPUT = { pv: 100_000, annualContribution: 0, horizonYears: 30 };
  it('census coverage: m=123, starts 1871–1993 (matches availableStartYears(30))', () => {
    const r = historyFan(INPUT);
    expect(r.m).toBe(123);
    expect(r.startYears).toEqual({ first: 1871, last: 1993 });
  });
  it('T-anchor: year-30 real percentiles (script-derived literals)', () => {
    const r = historyFan(INPUT);
    expect(r.byYear.p25[30]).toBe(390_973);
    expect(r.byYear.p50[30]).toBe(554_674);
    expect(r.byYear.p75[30]).toBe(770_994);
  });
  it('holds census @ $600k target: 63 of 123', () => {
    const r = historyFan({ ...INPUT, target: 600_000 });
    expect(r.holds).toEqual({ count: 63, target: 600_000 });
  });
  /* W2 review fix (MAJOR 2), real-data half: the UI-reachable STOP state where
     the scoped portfolio already equals the FI number. Year 0 alone carries
     every stretch, so the count must equal M(10) exactly — the 1973 stretch
     never recovers to 1.0× within ten years, so a k=1…H recurrence reports
     142 of the 143. */
  it('holds census @ pv === target (H=10): all 143 stretches hold, on year 0', () => {
    const r = historyFan({
      pv: 600_000,
      annualContribution: 0,
      horizonYears: 10,
      target: 600_000,
    });
    expect(r.m).toBe(143);
    expect(r.holds).toEqual({ count: 143, target: 600_000 });
  });
  it('ANTI-PIN: the nominal blend lands strictly above the real ceiling (D-P8 seam trick)', () => {
    // sp500Real := sp500Nominal ⇒ implied inflation 0 ⇒ bond leg stays nominal:
    // the exact wrong-basis blend, through the production engine.
    const nominalRows = loadShillerAnnual().map((r) => ({
      ...r,
      sp500RealReturn: r.sp500NominalReturn,
    }));
    const r = historyFan({ ...INPUT, rows: nominalRows });
    expect(r.byYear.p50[30]).toBe(1_258_658);
    expect(r.byYear.p50[30]).toBeGreaterThan(770_994); // the load-bearing inequality
  });
  it('H=1 single-row consistency: reproduces blendedRealReturn per start year', () => {
    const rows = loadShillerAnnual();
    for (const y of [1871, 1929, 1966, 2022]) {
      const row = rows.find((r) => r.year === y)!;
      const r = historyFan({ pv: 1000, annualContribution: 0, horizonYears: 1, rows: [row] });
      expect(r.m).toBe(1);
      expect(r.byYear.p50[1]).toBe(Math.round(1000 * (1 + blendedRealReturn(y, 0.75))));
    }
  });
  it('the M table the UI degradation rules key on', () => {
    const m = (H: number) => historyFan({ pv: 1000, annualContribution: 0, horizonYears: H }).m;
    expect(m(10)).toBe(143);
    expect(m(30)).toBe(123);
    expect(m(50)).toBe(103);
    expect(m(123)).toBe(30); // still renders (=== M_MIN)
    expect(m(124)).toBe(29); // degrades
    expect(m(130)).toBe(23);
    expect(m(140)).toBe(13);
    expect(m(152)).toBe(1);
    expect(m(153)).toBe(0);
  });
});

describe('historyFan — determinism (the hard line)', () => {
  it('identical inputs ⇒ byte-identical results', () => {
    const input = { pv: 250_000, annualContribution: 12_000, horizonYears: 30, target: 900_000 };
    const a: HistoryFanResult = historyFan(input);
    const b: HistoryFanResult = historyFan(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  /* W2 review fix (MINOR 0): the gate receipt claims the census AND the four
     new calculator modules are free of randomness and clocks — the scan read
     only the engine. Every module the History view is built from is enrolled
     here, so the ratchet matches the claim. */
  it.each([
    'src/lib/history-fan.ts',
    'src/lib/calculators/use-chart-source.ts',
    'src/lib/calculators/history-fan-copy.ts',
    'src/components/calculators/ReturnSourceControl.tsx',
    'src/components/calculators/HistoryFanLegend.tsx',
  ])('%s contains no randomness and no clock (structural, not merely seeded)', (path) => {
    const src = readFileSync(path, 'utf8');
    expect(src).not.toMatch(/Math\.random/);
    expect(src).not.toMatch(/Date\.now/);
    expect(src).not.toMatch(/new Date/);
  });
});
