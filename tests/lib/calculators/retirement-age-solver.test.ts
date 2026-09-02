import { describe, expect, it } from 'vitest';
import {
  MAX_SOLVE_AGE,
  projectedFv,
  solveEarliestRetirement,
} from '@/lib/calculators/retirement-age-solver';
import { yearsToFi } from '@/lib/financial-independence';

describe('projectedFv (the D-R1 closed form)', () => {
  it('matches FV = pv(1+r)^t + pmt((1+r)^t − 1)/r', () => {
    const r = 3 / 103;
    expect(projectedFv(500_000, 30_000, r, 29)).toBeCloseTo(
      500_000 * Math.pow(1 + r, 29) + (30_000 * (Math.pow(1 + r, 29) - 1)) / r,
      6,
    );
  });

  it('r = 0 is the linear limit: pv + pmt·t', () => {
    expect(projectedFv(100_000, 12_000, 0, 10)).toBe(220_000);
  });
});

describe('P4 — the spec pin (ageNow 40, pv 500k, pmt 30k, real 3/103, target 2.4M)', () => {
  const input = {
    ageNow: 40,
    pv: 500_000,
    pmt: 30_000,
    realRate: 3 / 103, // 6% nominal / 3% inflation, exact
    targetFv: 2_400_000,
    maxAge: 90,
  };

  it('answers t = 29 (age 69); t* ≈ 28.1188', () => {
    const result = solveEarliestRetirement(input);
    expect(result.verdict).toBe('age-found');
    expect(result.answerT).toBe(29);
    // pmt/r = 1,030,000 exactly ⇒ t* = ln(343/153)/ln(106/103)
    expect(Math.log(343 / 153) / Math.log(106 / 103)).toBeCloseTo(28.1188, 4);
  });

  it('records the probe trace IN TESTED ORDER: 50✓ · 25✕ · 37✓ · 31✓ · 28✕ · 29✓ (D-R3)', () => {
    const { probes } = solveEarliestRetirement(input);
    expect(probes.map((p) => [p.t, p.holds])).toEqual([
      [50, true],
      [25, false],
      [37, true],
      [31, true],
      [28, false],
      [29, true],
    ]);
  });

  it('probe FVs are the closed form (28 misses by ~$11.7k — off the knife edge)', () => {
    const { probes } = solveEarliestRetirement(input);
    const at28 = probes.find((p) => p.t === 28)!;
    const at29 = probes.find((p) => p.t === 29)!;
    expect(at28.fv).toBeCloseTo(2_388_325.12, 2);
    expect(at29.fv).toBeCloseTo(2_487_887.99, 2);
  });
});

describe('the closed-form ORACLE property (D-R4): answerT === ceil(yearsToFi) off the knife edge', () => {
  it('holds across a grid of reachable inputs', () => {
    const pvs = [0, 50_000, 300_000];
    const pmts = [0, 12_000, 30_000];
    const rates = [0.005, 3 / 103, 0.05];
    const targets = [500_000, 1_200_000, 2_400_000];
    let checked = 0;
    for (const pv of pvs)
      for (const pmt of pmts)
        for (const realRate of rates)
          for (const targetFv of targets) {
            if (projectedFv(pv, pmt, realRate, 0) >= targetFv) continue; // already-holds branch
            const years = yearsToFi({ pv, pmt, annualRate: realRate, targetFv });
            if (!Number.isFinite(years)) continue;
            if (Math.abs(years - Math.round(years)) < 1e-9) continue; // knife edge — excluded by design
            const result = solveEarliestRetirement({ ageNow: 30, pv, pmt, realRate, targetFv, maxAge: 90 });
            if (Math.ceil(years) > 60) {
              expect(result.verdict).toBe('not-by-max');
            } else {
              expect(result.verdict).toBe('age-found');
              expect(result.answerT).toBe(Math.ceil(years));
            }
            checked++;
          }
    expect(checked).toBeGreaterThan(20); // the grid must actually exercise the property
  });
});

describe('edge verdicts (D-R2/D-R3 + the spec edge table)', () => {
  it('already holds: FV(0) ≥ target → verdict with NO probes, answerT 0', () => {
    const r = solveEarliestRetirement({ ageNow: 40, pv: 2_500_000, pmt: 0, realRate: 0.02, targetFv: 2_400_000, maxAge: 90 });
    expect(r).toEqual({ verdict: 'already-holds', answerT: 0, probes: [] });
  });

  it('not by max: positive real rate, unreachable by 90 → ONE probe (tMax), shown', () => {
    const r = solveEarliestRetirement({ ageNow: 40, pv: 1_000, pmt: 0, realRate: 0.001, targetFv: 2_400_000, maxAge: 90 });
    expect(r.verdict).toBe('not-by-max');
    expect(r.answerT).toBeNull();
    expect(r.probes).toHaveLength(1);
    expect(r.probes[0].t).toBe(50);
    expect(r.probes[0].holds).toBe(false);
  });

  it('never-real: UNREACHABLE in real terms → the lock verdict, exact not a search failure', () => {
    // Decreasing FV branch: pv > pmt/|r| (500k > 120k), FV(0) < target — the
    // asymptote sits below the target, so no t reaches it.
    const input = { ageNow: 40, pv: 500_000, pmt: 12_000, realRate: -0.1, targetFv: 600_000, maxAge: 90 };
    const r = solveEarliestRetirement(input);
    expect(r.verdict).toBe('never-real');
    expect(r.probes).toHaveLength(1); // the honest tMax probe
    // The verdict's criterion IS the closed-form oracle (D-R4 parity).
    expect(
      yearsToFi({ pv: input.pv, pmt: input.pmt, annualRate: input.realRate, targetFv: input.targetFv }),
    ).toBe(Infinity);
  });

  it('never-real: no contributions under a negative real rate (FV decays toward 0)', () => {
    const r = solveEarliestRetirement({ ageNow: 36, pv: 200_000, pmt: 0, realRate: -0.01, targetFv: 1_500_000, maxAge: 90 });
    expect(r.verdict).toBe('never-real');
    expect(r.probes).toHaveLength(1);
  });

  it('NOT never-real: a negative real rate whose asymptote clears the target is merely not-by-max', () => {
    // Review MAJOR 1: the verdict is classified by REACHABILITY, not by the
    // sign of r. 2% return / 3% inflation ⇒ real −0.9709%; pmt/|r| = $2.472M
    // is above the $1.5M target, so FV is INCREASING and crosses it — just
    // after age 90 (t* ≈ 87.03). Saying "never reached in real terms" there
    // is false, and it disagrees with PathToFi on the same household.
    const realRate = 1.02 / 1.03 - 1;
    const input = { ageNow: 36, pv: 200_000, pmt: 24_000, realRate, targetFv: 1_500_000, maxAge: 90 };
    const r = solveEarliestRetirement(input);
    expect(r.verdict).toBe('not-by-max');
    expect(r.answerT).toBeNull();
    expect(r.probes).toHaveLength(1);
    expect(r.probes[0].t).toBe(54);
    expect(r.probes[0].fv).toBeCloseTo(1_130_448.13, 2);
    // Parity with the card the solver must agree with (D-R4/D-R6).
    const years = yearsToFi({ pv: 200_000, pmt: 24_000, annualRate: realRate, targetFv: 1_500_000 });
    expect(Number.isFinite(years)).toBe(true);
    expect(years).toBeCloseTo(87.0280, 4);
  });

  it('realRate EXACTLY 0 (CP-39 boundary): pmt > 0 is reachable (not-by-max), pmt = 0 is never-real', () => {
    // realRateOfUnfloored(0.03, 0.03) === 0 exactly — a reachable user state.
    const reachable = solveEarliestRetirement({ ageNow: 40, pv: 100_000, pmt: 1_000, realRate: 0, targetFv: 2_400_000, maxAge: 90 });
    expect(reachable.verdict).toBe('not-by-max'); // linear: t* = 2,300 years
    const unreachable = solveEarliestRetirement({ ageNow: 40, pv: 100_000, pmt: 0, realRate: 0, targetFv: 2_400_000, maxAge: 90 });
    expect(unreachable.verdict).toBe('never-real'); // FV is flat at pv forever
  });

  it('negative real rate CAN still hold (asymptote pmt/|r| above target) — bisection stays valid (D-R2 monotonicity)', () => {
    // r = −1%: FV rises toward pmt/0.01 = 3M; target 1M is crossed.
    const r = solveEarliestRetirement({ ageNow: 40, pv: 0, pmt: 30_000, realRate: -0.01, targetFv: 1_000_000, maxAge: 90 });
    expect(r.verdict).toBe('age-found');
    expect(r.answerT).not.toBeNull();
    const t = r.answerT!;
    expect(projectedFv(0, 30_000, -0.01, t)).toBeGreaterThanOrEqual(1_000_000);
    expect(projectedFv(0, 30_000, -0.01, t - 1)).toBeLessThan(1_000_000);
  });

  it('r = 0 with contributions that reach the target solves linearly (no division blowup)', () => {
    // (1.2M − 200k)/50k = 20 exactly is a knife edge — use 48k: t* = 1M/48k ≈ 20.83 → 21.
    const r = solveEarliestRetirement({ ageNow: 40, pv: 200_000, pmt: 48_000, realRate: 0, targetFv: 1_200_000, maxAge: 90 });
    expect(r.verdict).toBe('age-found');
    expect(r.answerT).toBe(21);
  });

  it('past the cap: ageNow ≥ maxAge → past-max, no probes', () => {
    const r = solveEarliestRetirement({ ageNow: 90, pv: 0, pmt: 0, realRate: 0.03, targetFv: 1, maxAge: 90 });
    expect(r).toEqual({ verdict: 'past-max', answerT: null, probes: [] });
    const r2 = solveEarliestRetirement({ ageNow: 95, pv: 0, pmt: 0, realRate: 0.03, targetFv: 1, maxAge: 90 });
    expect(r2.verdict).toBe('past-max');
  });
});

describe('bisection shape', () => {
  it('probe count is ~log2(tMax), never a linear sweep (≤ 8 probes for a 50-year range)', () => {
    const { probes } = solveEarliestRetirement({
      ageNow: 40, pv: 500_000, pmt: 30_000, realRate: 3 / 103, targetFv: 2_400_000, maxAge: 90,
    });
    expect(probes.length).toBeLessThanOrEqual(8);
  });

  it('MAX_SOLVE_AGE is 90 (the persons-schema retirement cap)', () => {
    expect(MAX_SOLVE_AGE).toBe(90);
  });
});
