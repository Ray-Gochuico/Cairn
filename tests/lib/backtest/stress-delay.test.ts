import { describe, it, expect } from 'vitest';
import { computeStressDelays, type StressDelayInput } from '@/lib/backtest/stress-delay';
import { STRESS_WINDOWS } from '@/lib/backtest/windows';
import { flatPathEnd } from '@/lib/backtest/replay';
import { MAX_SOLVE_AGE, projectedFv } from '@/lib/calculators/retirement-age-solver';
import { realRateOfUnfloored } from '@/lib/calculators/real-rate';

// The seed's moderate 6% at 2.4% inflation → 0.03515625 (tests are not ratcheted; src is).
const R = realRateOfUnfloored(0.06, 0.024);
const SEED: StressDelayInput = { pv: 935_000, pmt: 0, realRate: R, targetFv: 1_800_000, ageNow: 38, stockPct: 0.75 };

describe('computeStressDelays — the seeded inputs at 75/25 (Appendix A.2 of the R4 plan; re-derived on 9f693bb0)', () => {
  it('five windows in REGISTRY order (never sorted — 1973 is deeper than 1929), each solved from its LAST year', () => {
    const d = computeStressDelays(SEED);
    expect(d.windows.map((w) => w.id)).toEqual(STRESS_WINDOWS.map((w) => w.id));
    expect(d.windows[1].troughBalance).toBeLessThan(d.windows[0].troughBalance); // severity ≠ registry order — the pin above is non-vacuous
    expect(d.windows.map((w) => w.legStartYear)).toEqual(STRESS_WINDOWS.map((w) => w.span.endYear));
    expect(d).toMatchObject({ solverRan: true, solverState: 'ok', lastDataYear: 2022, maxAge: 90 });
  });

  it('the numerics table: [n, trough, troughYear, end, recovered, legA, solveAge, tA, tB, delay]', () => {
    const d = computeStressDelays(SEED);
    const rows = d.windows.map((w) => [w.n, +w.troughBalance.toFixed(2), w.troughYear, +w.windowEndBalance.toFixed(2), w.recoveredYear, +w.legAStart.toFixed(2), w.solveAge, w.tA, w.tB, w.delay]);
    expect(rows).toEqual([
      [3, 592050.17, 1931, 592050.17, 1935, 1037120.78, 41, 16, 33, 17],
      [9, 576821.21, 1974, 629773.79, 1984, 1276041.47, 47, 10, 31, 21],
      [3, 705574.53, 2002, 705574.53, 2006, 1037120.78, 41, 16, 28, 12],
      [1, 719454.61, 2008, 719454.61, 2010, 967871.09, 39, 18, 27, 9],
      [1, 773401.48, 2022, 773401.48, null, 967871.09, 39, 18, 25, 7],
    ]);
    for (const w of d.windows) expect(w.legAStart).toBeCloseTo(flatPathEnd(SEED.pv, R, 0, w.n), 6);
    expect(d.windows.map((w) => +w.depth.toFixed(5))).toEqual([-0.36679, -0.38308, -0.24537, -0.23053, -0.17283]);
    expect(d.windows.every((w) => w.verdictA === 'age-found' && w.verdictB === 'age-found' && !w.outpaced)).toBe(true);
  });

  it('determinism', () => {
    expect(computeStressDelays(SEED)).toEqual(computeStressDelays(SEED));
  });
});

describe('ANCHOR A — $100,000 + $12,000/yr at 75/25, age 40, target $600,000: leg start year + cadence (ruling 5)', () => {
  const A: StressDelayInput = { pv: 100_000, pmt: 12_000, realRate: R, targetFv: 600_000, ageNow: 40, stockPct: 0.75 };
  it('1929: solved from 1931 with flatPathEnd (148,799.43) — never projectedFv (148,202.47) nor pv; tA 19, tB 23, delay 4', () => {
    const w = computeStressDelays(A).windows[0];
    expect(w).toMatchObject({ legStartYear: 1931, troughYear: 1931, recoveredYear: 1932, solveAge: 43, verdictA: 'age-found', verdictB: 'age-found', tA: 19, tB: 23, delay: 4 });
    expect(w.legAStart).toBeCloseTo(148_799.43, 2);
    expect(w.legAStart).toBeCloseTo(flatPathEnd(100_000, R, 12_000, 3), 6);
    expect(Math.abs(w.legAStart - projectedFv(100_000, 12_000, R, 3))).toBeGreaterThan(500); // the cadence mutant
    expect(w.legAStart).toBeGreaterThan(100_000); // a solve-from-today mutant starts at pv
    expect(w.troughBalance).toBeCloseTo(90_195.78, 2);
    expect(w.legBStart).toBeCloseTo(90_195.78, 2);
    // MUTANT NOTE: legs from the window's FIRST year (115,707.78 / 106,181.39 at age 41) give tA 21, tB 22, delay 1.
  });
});

describe('ANCHOR B — $100,000 / $0 at 60/40 (THE nominal-on-real anchor)', () => {
  it('1970s trough 66,517.39 in 1974, > $6,000 from the nominal-bond 73,158.09; every leg A not-by-max (t* ≈ 52 years)', () => {
    const d = computeStressDelays({ pv: 100_000, pmt: 0, realRate: R, targetFv: 600_000, ageNow: 40, stockPct: 0.6 });
    const w = d.windows[1];
    expect(w.troughBalance).toBeCloseTo(66_517.39, 2);
    expect(w.troughYear).toBe(1974);
    expect(w.windowEndBalance).toBeCloseTo(66_892.74, 2);
    expect(w.recoveredYear).toBe(1984);
    expect(Math.abs(w.troughBalance - 73_158.09)).toBeGreaterThan(6_000);
    expect(d.solverState).toBe('not-by-max');
    expect(d.windows.every((x) => x.verdictA === 'not-by-max')).toBe(true);
  });
});

describe('solver states and per-window past-max (ruling 2)', () => {
  const at = (ageNow: number, patch: Partial<StressDelayInput> = {}) => computeStressDelays({ ...SEED, ageNow, ...patch });

  it('age 70: every A found, every B not-by-max → state ok', () => {
    const d = at(70);
    expect(d.solverState).toBe('ok');
    expect(d.windows.map((w) => [w.verdictA, w.verdictB])).toEqual(Array(5).fill(['age-found', 'not-by-max']));
  });

  it('age 82: the 1970s window is past-max (solveAge 91), the rest not-by-max → state not-by-max', () => {
    const d = at(82);
    expect(d.windows.map((w) => w.solveAge)).toEqual([85, 91, 85, 83, 83]);
    expect(d.windows.map((w) => w.verdictA)).toEqual(['not-by-max', 'past-max', 'not-by-max', 'not-by-max', 'not-by-max']);
    expect(d.solverState).toBe('not-by-max');
  });

  it('age 88: three past-max + two not-by-max → not-by-max; age 89: all past-max → ok (nothing in range); age 90: past-max-today, no solve', () => {
    expect(at(88).windows.map((w) => w.verdictA)).toEqual(['past-max', 'past-max', 'past-max', 'not-by-max', 'not-by-max']);
    expect(at(88).solverState).toBe('not-by-max');
    expect(at(89).windows.every((w) => w.verdictA === 'past-max')).toBe(true);
    expect(at(89).solverState).toBe('ok');
    const d90 = at(90);
    expect(d90).toMatchObject({ solverState: 'past-max-today', solverRan: false });
    expect(d90.windows.every((w) => w.verdictA === null && w.tA === null && w.delay === null)).toBe(true);
    expect(d90.windows[0].troughBalance).toBeCloseTo(592_050.17, 2); // the replay still runs
  });

  it('age 81 with $1,500,000: the 1970s window is past-max while the others are found (A) / not-by-max (B) — the per-window state', () => {
    // t* = ln(1.8/1.5)/ln(1.03515625) ≈ 5.3; 1929: legA 1,663,807 → tA 3 ≤ tMax 6; legB 949,795 → tB 19 > 6.
    const d = at(81, { pv: 1_500_000 });
    expect(d.solverState).toBe('ok');
    expect(d.windows.map((w) => w.verdictA)).toEqual(['age-found', 'past-max', 'age-found', 'age-found', 'age-found']);
    expect(d.windows.map((w) => w.verdictB)).toEqual(['not-by-max', 'past-max', 'not-by-max', 'not-by-max', 'not-by-max']);
    expect(d.windows[0]).toMatchObject({ solveAge: 84, tA: 3 });
  });

  it('never-real (r < 0, pmt 0) is uniform; r < 0 with contributions that clear the target is age-found (MINOR 17)', () => {
    const neg = realRateOfUnfloored(0.01, 0.024);
    expect(neg).toBeLessThan(0);
    expect(computeStressDelays({ ...SEED, realRate: neg }).solverState).toBe('never-real');
    const d = computeStressDelays({ pv: 100_000, pmt: 40_000, realRate: neg, targetFv: 600_000, ageNow: 40, stockPct: 0.75 });
    expect(d.solverState).toBe('ok');
    expect(d.windows.every((w) => w.verdictA === 'age-found')).toBe(true);
  });

  it('no target / no age: the replay runs, nothing is solved', () => {
    const noTarget = computeStressDelays({ ...SEED, targetFv: null });
    expect(noTarget).toMatchObject({ solverState: 'no-target', solverRan: false });
    expect(noTarget.windows[0].verdictA).toBeNull();
    expect(noTarget.windows[0].troughBalance).toBeCloseTo(592_050.17, 2);
    expect(computeStressDelays({ ...SEED, ageNow: null })).toMatchObject({ solverState: 'no-age', solverRan: false });
  });

  it('outpaced: $100,000 + $60,000/yr never dips below its start in 2008; pmt 0 is never outpaced', () => {
    const d = computeStressDelays({ pv: 100_000, pmt: 60_000, realRate: R, targetFv: 600_000, ageNow: 40, stockPct: 0.75 });
    expect(d.windows[3].outpaced).toBe(true);
    expect(d.windows[3].troughBalance).toBeGreaterThanOrEqual(100_000);
    expect(computeStressDelays(SEED).windows.every((w) => !w.outpaced)).toBe(true);
  });

  it('pmt 0 is never outpaced — an all-bond replay that never dips (2008 at 0% stocks) is no drawdown, not contributions outpacing losses', () => {
    // Mutant receipt (R4 T7): dropping the `pmt > 0` guard reds here — the
    // seed's windows all dip, so the SEED arm above cannot see the guard.
    const d = computeStressDelays({ pv: 100_000, pmt: 0, realRate: R, targetFv: 600_000, ageNow: 40, stockPct: 0 });
    expect(d.windows[3].troughBalance).toBeGreaterThanOrEqual(100_000); // non-vacuous: the DP-15 shape, without contributions
    expect(d.windows.every((w) => !w.outpaced)).toBe(true);
  });

  it('maxAge defaults to the solver\'s MAX_SOLVE_AGE and is overridable (the cap moves every window)', () => {
    expect(computeStressDelays(SEED).maxAge).toBe(MAX_SOLVE_AGE);
    const capped = computeStressDelays({ ...SEED, maxAge: 45 });
    expect(capped.windows[1].verdictA).toBe('past-max'); // 38 + 9 = 47 ≥ 45
    expect(capped.windows[0]).toMatchObject({ solveAge: 41, verdictA: 'not-by-max' }); // tMax 4 < tA 16
  });
});
