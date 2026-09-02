import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  emptyLeverPayload, effectiveBaselineInflation,
  type Milestones, type MonthlyState,
} from '@/lib/scenarios';
import { NET_WORTH_FLOOR_ABS } from '@/lib/briefing';
import { formatCurrency } from '@/lib/format';
import {
  buildPlanReview, lineText, COMPARE_FOOTER, SECOND_SCENARIO_PROMPT, SEND_POINTER,
  resolveDeflatorSourceLabel, resolveComparePair, DEFLATOR_LABELS, TEMPLATES,
  type CompareSide, type PlanReviewInput, type PlanReviewModel, type ReviewLine,
} from '@/lib/whatif/plan-review';
import type { AssumptionParity, LeverDiff } from '@/lib/whatif/lever-diff';
import type { Scenario } from '@/types/scenario';
import type { AppSettings, Household } from '@/types/schema';
import { makeHousehold } from '../../factories';
import { ADVICE_LEXICON, RESERVED_PHRASES } from '../../helpers/advice-lexicon';

const st = (monthISO: string, over: Partial<MonthlyState> = {}): MonthlyState => ({
  monthISO, investmentsByAccount: {}, homeEquity: 0, cash: 0, debtByLoan: {},
  netWorth: 0, incomeAfterTax: 0, expenses: 0, savings: 0, events: [], ...over,
});

const EQ_PARITY: AssumptionParity = {
  equal: true, differences: [],
  inflation: { aEffective: 0.03, bEffective: 0.03, aHasOverrides: false, bHasOverrides: false },
};
const EMPTY_DIFF: LeverDiff = { onlyInA: [], onlyInB: [], changed: [], isEmpty: true };

/** A payload differing from emptyLeverPayload() in one engine-real field, so a
 *  fixture carrying a non-empty leverDiff can never accidentally satisfy the
 *  BL-5 canonical-equality rung (which sits ABOVE BL-6 in the ladder). */
const variant = () => ({ ...emptyLeverPayload(), annualLongTermGains: 1 });

const side = (name: string, over: Partial<CompareSide> = {}): CompareSide => ({
  name, payload: emptyLeverPayload(), states: [st('2026-09')], milestones: {} as Milestones, ...over,
});
const input = (over: Partial<PlanReviewInput> = {}): PlanReviewInput => ({
  a: side('Baseline'), b: side('Aggressive payoff'),
  dollarMode: 'nominal', horizonMonths: 360,
  deflator: { rate: 0.03, sourceLabel: 'your household setting' },
  parity: EQ_PARITY, leverDiff: EMPTY_DIFF, ...over,
});
const bl = (i: PlanReviewInput): string => lineText(buildPlanReview(i).bottomLine);

describe('bottom-line ladder (§1.3) — every rung straddled', () => {
  it('BL-1: both FI dates, differ', () => {
    const i = input({
      a: side('Baseline', { milestones: { financialIndependenceISO: '2040-06' } as Milestones }),
      b: side('Aggressive payoff', { milestones: { financialIndependenceISO: '2043-06' } as Milestones }),
    });
    expect(bl(i)).toBe('Baseline reaches the FI mark 36 months earlier — June 2040 vs June 2043.');
  });

  it('BL-1 singular month', () => {
    const i = input({
      a: side('Baseline', { milestones: { financialIndependenceISO: '2040-06' } as Milestones }),
      b: side('Aggressive payoff', { milestones: { financialIndependenceISO: '2040-07' } as Milestones }),
    });
    expect(bl(i)).toBe('Baseline reaches the FI mark 1 month earlier — June 2040 vs July 2040.');
  });

  it('BL-2: exactly one side defined', () => {
    const i = input({
      b: side('Aggressive payoff', { milestones: { financialIndependenceISO: '2041-02' } as Milestones }),
    });
    expect(bl(i)).toBe("Aggressive payoff reaches the FI mark within the horizon (February 2041); Baseline doesn't.");
  });

  it('BL-3 fires at the floor; BL-6 names the floor just under it (boundary pair)', () => {
    const at = input({
      a: side('Baseline', { milestones: { netWorth30y: 100_000 } as Milestones }),
      b: side('Aggressive payoff', { payload: variant(), milestones: { netWorth30y: 103_000 } as Milestones }),
      leverDiff: { onlyInA: [], onlyInB: ['Lump sum 2026-09: +$1 (investments)'], changed: [], isEmpty: false },
    });
    // floor = max(500, 0.005 × 103,000) = 515; Δ = 3,000 ≥ 515 → BL-3.
    expect(bl(at)).toBe('Aggressive payoff ends $3,000 higher at the 30-year mark.');
    const under = input({
      a: side('Baseline', { milestones: { netWorth30y: 100_000 } as Milestones }),
      b: side('Aggressive payoff', { payload: variant(), milestones: { netWorth30y: 100_400 } as Milestones }),
      leverDiff: { onlyInA: [], onlyInB: ['Lump sum 2026-09: +$1 (investments)'], changed: [], isEmpty: false },
    });
    // floor = max(500, 0.005 × 100,400) = 502; Δ = 400 < 502 → BL-6 with the floor.
    expect(bl(under)).toBe('These plans end within $502 of each other over this horizon.');
  });

  it('BL-3 real mode: deflated by the fmtNetWorth30y recipe + basis suffix', () => {
    const f = Math.pow(1.03, 30);
    const i = input({
      dollarMode: 'real',
      a: side('Baseline', { milestones: { netWorth30y: 100_000 * f } as Milestones }),
      b: side('Aggressive payoff', { milestones: { netWorth30y: 103_000 * f } as Milestones }),
      leverDiff: { onlyInA: [], onlyInB: ['x'], changed: [], isEmpty: false },
    });
    expect(bl(i)).toBe("Aggressive payoff ends $3,000 higher at the 30-year mark (today's dollars).");
  });

  it('BL-3h: horizon under 30 years names the horizon end', () => {
    const i = input({
      horizonMonths: 240,
      a: side('Baseline', { milestones: { netWorth30y: 100_000 } as Milestones }),
      b: side('Aggressive payoff', { milestones: { netWorth30y: 103_000 } as Milestones }),
      leverDiff: { onlyInA: [], onlyInB: ['x'], changed: [], isEmpty: false },
    });
    expect(bl(i)).toBe('Aggressive payoff ends $3,000 higher at the end of your 20-year horizon.');
  });

  it('BL-3 fires AT the floor, not only above it (CR-BL3 says ≥)', () => {
    const i = input({
      a: side('Baseline', { milestones: { netWorth30y: 0 } as Milestones }),
      b: side('Aggressive payoff', { payload: variant(), milestones: { netWorth30y: 500 } as Milestones }),
      leverDiff: { onlyInA: [], onlyInB: ['x'], changed: [], isEmpty: false },
    });
    // floor = max(500, 0.005 × 500) = 500; Δ = 500 — exactly the boundary.
    expect(bl(i)).toBe('Aggressive payoff ends $500 higher at the 30-year mark.');
  });

  // D-W3-P7: the fmtNetWorth30y mirror keeps its FIXED 30-year exponent even
  // when netWorth30y is the horizon-end fallback — parity with the
  // Manage-scenarios column outranks local correction (D-W3-4).
  it('BL-3h real mode deflates by (1+i)^30, never by horizonMonths/12', () => {
    const f = Math.pow(1.03, 30);
    const i = input({
      dollarMode: 'real', horizonMonths: 240,
      a: side('Baseline', { milestones: { netWorth30y: 100_000 * f } as Milestones }),
      b: side('Aggressive payoff', { payload: variant(), milestones: { netWorth30y: 103_000 * f } as Milestones }),
      leverDiff: { onlyInA: [], onlyInB: ['x'], changed: [], isEmpty: false },
    });
    // Fixed 30 → disp 100,000 vs 103,000 → Δ $3,000. An exponent of 240/12
    // would leave 1.03^10 in both figures and render $4,032.
    expect(bl(i)).toBe("Aggressive payoff ends $3,000 higher at the end of your 20-year horizon (today's dollars).");
  });

  it('BL-3h: a horizon that is not a whole number of years names months', () => {
    const i = input({
      horizonMonths: 250,
      a: side('Baseline', { milestones: { netWorth30y: 100_000 } as Milestones }),
      b: side('Aggressive payoff', { milestones: { netWorth30y: 103_000 } as Milestones }),
      leverDiff: { onlyInA: [], onlyInB: ['x'], changed: [], isEmpty: false },
    });
    expect(bl(i)).toBe('Aggressive payoff ends $3,000 higher at the end of your 250-month horizon.');
  });

  // Smoke M1 (2026-09-02): the card read $3,822,730 while the Manage-scenarios
  // columns differed by $3,822,729. D-W3-4's parity intent is that the user can
  // hold the card against the modal, so the delta is the difference of the
  // figures the SCOREBOARD shows — each side rounded to whole dollars first,
  // then subtracted — not the rounded difference of the raw halves.
  it('M1: the 30-year delta subtracts the SCOREBOARD-ROUNDED sides (halves straddling .5)', () => {
    const i = input({
      a: side('Baseline', { milestones: { netWorth30y: 1_000_000.5 } as Milestones }),
      b: side('Aggressive payoff', { payload: variant(), milestones: { netWorth30y: 500_000.4 } as Milestones }),
      leverDiff: { onlyInA: [], onlyInB: ['x'], changed: [], isEmpty: false },
    });
    // ManageScenariosModal renders each column as formatCurrency(n): Intl
    // rounds to whole dollars, so the columns read $1,000,001 and $500,000 and
    // their visible difference is $500,001. Subtracting the raw halves first
    // gives 500,000.1 → $500,000, the $1 the smoke caught.
    expect(formatCurrency(1_000_000.5)).toBe('$1,000,001');
    expect(formatCurrency(500_000.4)).toBe('$500,000');
    expect(bl(i)).toBe('Baseline ends $500,001 higher at the 30-year mark.');
  });

  it('M1: real mode rounds the DEFLATED sides, matching the modal column it mirrors', () => {
    const f = Math.pow(1.03, 30);
    const i = input({
      dollarMode: 'real',
      a: side('Baseline', { milestones: { netWorth30y: 1_000_000.5 * f } as Milestones }),
      b: side('Aggressive payoff', { payload: variant(), milestones: { netWorth30y: 500_000.4 * f } as Milestones }),
      leverDiff: { onlyInA: [], onlyInB: ['x'], changed: [], isEmpty: false },
    });
    expect(bl(i)).toBe("Baseline ends $500,001 higher at the 30-year mark (today's dollars).");
  });

  it('BL-4: both debt-free, differ (FI silent, NW under floor)', () => {
    const i = input({
      a: side('Baseline', { milestones: { debtFreeISO: '2028-03', netWorth30y: 100_000 } as Milestones }),
      b: side('Aggressive payoff', { milestones: { debtFreeISO: '2030-03', netWorth30y: 100_100 } as Milestones }),
      leverDiff: { onlyInA: [], onlyInB: ['x'], changed: [], isEmpty: false },
    });
    expect(bl(i)).toBe('Baseline is debt-free 24 months earlier — March 2028 vs March 2030.');
  });

  it('BL-5: canonical-JSON-equal payloads → "lines overlap"', () => {
    expect(bl(input())).toBe('These two scenarios are identical — their lines overlap.');
  });

  // Smoke D1 (2026-09-02): the lever-diff now hides a SHAPE-only income
  // difference, but BL-5 is NOT weakened to match. "Their lines overlap" rests
  // on D-W3-P10 — canonical-JSON-equal payloads share a projection cache key
  // (scenarios-store.ts:222-223), so the states are the same object. A
  // shape-only twin has a DIFFERENT key and is merely expected to overlap, so
  // the ladder must fall through to the rung the numbers actually support.
  it('BL-5 still requires canonical equality: a shape-only income twin falls through to BL-6', () => {
    const one = { ...emptyLeverPayload(), income: { perPerson: [{ annualRaiseRate: 0, events: [] }] } };
    const two = {
      ...emptyLeverPayload(),
      income: { perPerson: [{ annualRaiseRate: 0, events: [] }, { annualRaiseRate: 0, events: [] }] },
    };
    expect(JSON.stringify(one)).not.toBe(JSON.stringify(two)); // not identical payloads
    const i = input({
      a: side('Baseline', { payload: one, milestones: { netWorth30y: 100_000 } as Milestones }),
      b: side('Aggressive payoff', { payload: two, milestones: { netWorth30y: 100_000 } as Milestones }),
    });
    const model = buildPlanReview(i);
    // floor = max(500, 0.005 × 100,000) = 500; Δ = 0 → BL-6, never BL-5.
    expect(lineText(model.bottomLine)).toBe('These plans end within $500 of each other over this horizon.');
    expect(lineText(model.bottomLine)).not.toContain('identical');
    // The empty diff + equal parity still pairs with the honest MD-4 line.
    expect(model.mainDifference.map(lineText)).toEqual(['No differences — see the bottom line.']);
  });

  it('BL-6 fallback floor is NET_WORTH_FLOOR_ABS when no 30y figures exist', () => {
    const i = input({
      a: side('Baseline'),
      b: side('Aggressive payoff', { payload: variant() }),
      leverDiff: { onlyInA: [], onlyInB: ['x'], changed: [], isEmpty: false },
    });
    expect(bl(i)).toBe(`These plans end within $${NET_WORTH_FLOOR_ABS} of each other over this horizon.`);
  });

  it('FI-scan-disabled pair (no FI on either side) never renders an FI sentence', () => {
    const i = input({
      b: side('Aggressive payoff', { payload: variant() }),
      leverDiff: { onlyInA: [], onlyInB: ['x'], changed: [], isEmpty: false },
    });
    const model = buildPlanReview(i);
    const all = [model.bottomLine, ...model.tradeoffs].map(lineText).join('\n');
    expect(all).not.toContain('FI mark');
  });
});

/**
 * D-W3-10 / plan §3: "Both directions phrased identically; the panel never
 * ranks." Every earlier fixture put the earlier/first/only side on A, so
 * 'always A first' regressions rendered inverted, false claims ("Baseline
 * reaches the FI mark -36 months earlier") with nothing failing.
 */
describe('direction symmetry (D-W3-10) — the earlier/first/only side is COMPUTED', () => {
  const NON_EMPTY: LeverDiff = { onlyInA: [], onlyInB: ['x'], changed: [], isEmpty: false };

  it('BL-1 names B when B reaches FI first', () => {
    expect(bl(input({
      a: side('Baseline', { milestones: { financialIndependenceISO: '2043-06' } as Milestones }),
      b: side('Aggressive payoff', { milestones: { financialIndependenceISO: '2040-06' } as Milestones }),
    }))).toBe('Aggressive payoff reaches the FI mark 36 months earlier — June 2040 vs June 2043.');
  });

  it('BL-2 names A when only A reaches FI', () => {
    expect(bl(input({
      a: side('Baseline', { milestones: { financialIndependenceISO: '2041-02' } as Milestones }),
      b: side('Aggressive payoff', { payload: variant() }),
      leverDiff: NON_EMPTY,
    }))).toBe("Baseline reaches the FI mark within the horizon (February 2041); Aggressive payoff doesn't.");
  });

  it('BL-4 names B when B is debt-free first', () => {
    expect(bl(input({
      a: side('Baseline', { milestones: { debtFreeISO: '2030-03' } as Milestones }),
      b: side('Aggressive payoff', { payload: variant(), milestones: { debtFreeISO: '2028-03' } as Milestones }),
      leverDiff: NON_EMPTY,
    }))).toBe('Aggressive payoff is debt-free 24 months earlier — March 2028 vs March 2030.');
  });

  it('TR-DEBT1 names B when only B is debt-free', () => {
    expect(buildPlanReview(input({
      a: side('Baseline', { payload: variant() }),
      b: side('Aggressive payoff', { milestones: { debtFreeISO: '2030-01' } as Milestones }),
      leverDiff: { onlyInA: ['x'], onlyInB: [], changed: [], isEmpty: false },
    })).tradeoffs.map(lineText)).toEqual([
      'Aggressive payoff is debt-free by January 2030; Baseline still carries debt at the end of the horizon.',
    ]);
  });

  it('TR-DRAW2 names B first when B draws first', () => {
    expect(buildPlanReview(input({
      a: side('Baseline', { payload: variant(), states: [st('2046-11', { withdrawnFromInvestments: 10 })] }),
      b: side('Aggressive payoff', { states: [st('2044-05', { withdrawnFromInvestments: 10 })] }),
      leverDiff: NON_EMPTY,
    })).tradeoffs.map(lineText)).toEqual([
      'Aggressive payoff starts drawing from investments in May 2044; Baseline in November 2046.',
    ]);
  });

  it('TR-DRAW1 names B when only B draws', () => {
    expect(buildPlanReview(input({
      a: side('Baseline', { payload: variant() }),
      b: side('Aggressive payoff', { states: [st('2026-09'), st('2045-01', { withdrawnFromInvestments: 100 })] }),
      leverDiff: NON_EMPTY,
    })).tradeoffs.map(lineText)).toEqual([
      "Aggressive payoff starts drawing from investments in January 2045; Baseline doesn't within the horizon.",
    ]);
  });

  it('TR-RET1 names B when only B retires', () => {
    expect(buildPlanReview(input({
      a: side('Baseline', { payload: variant() }),
      b: side('Aggressive payoff', { milestones: { retirementISO: '2044-01' } as Milestones }),
      leverDiff: NON_EMPTY,
    })).tradeoffs.map(lineText)).toEqual([
      'Salary income ends January 2044 in Aggressive payoff; in Baseline it continues through the horizon.',
    ]);
  });

  it('PROPERTY: swapping A and B yields the same bottom line and the same tradeoff SET', () => {
    const A = side('Baseline', {
      payload: variant(),
      states: [st('2026-09'), st('2045-01', { withdrawnFromInvestments: 100 })],
      milestones: { financialIndependenceISO: '2043-06', debtFreeISO: '2030-03', netWorth30y: 400_000 } as Milestones,
    });
    const B = side('Aggressive payoff', {
      states: [st('2026-09'), st('2044-05', { withdrawnFromInvestments: 100 })],
      milestones: { financialIndependenceISO: '2040-06', debtFreeISO: '2028-03', netWorth30y: 900_000 } as Milestones,
    });
    const fwd = buildPlanReview(input({ a: A, b: B, leverDiff: NON_EMPTY }));
    const rev = buildPlanReview(input({ a: B, b: A, leverDiff: NON_EMPTY }));
    expect(lineText(rev.bottomLine)).toBe(lineText(fwd.bottomLine));
    expect(lineText(fwd.bottomLine))
      .toBe('Aggressive payoff reaches the FI mark 36 months earlier — June 2040 vs June 2043.');
    expect([...rev.tradeoffs.map(lineText)].sort()).toEqual([...fwd.tradeoffs.map(lineText)].sort());
    expect(fwd.tradeoffs.length).toBe(3);
  });

  it('TR-RET2 is the ONE contractual exception: it names A then B by position', () => {
    const A = side('Baseline', { payload: variant(), milestones: { retirementISO: '2044-01' } as Milestones });
    const B = side('Aggressive payoff', { milestones: { retirementISO: '2046-01' } as Milestones });
    expect(buildPlanReview(input({ a: A, b: B, leverDiff: NON_EMPTY })).tradeoffs.map(lineText))
      .toEqual(['Salary income ends January 2044 in Baseline and January 2046 in Aggressive payoff.']);
    expect(buildPlanReview(input({ a: B, b: A, leverDiff: NON_EMPTY })).tradeoffs.map(lineText))
      .toEqual(['Salary income ends January 2046 in Aggressive payoff and January 2044 in Baseline.']);
  });
});

/** ⚑ W3-F5: which sentence is the headline and which becomes a bullet. */
describe('bottom-line ladder PRECEDENCE (FI → 30y NW → debt-free)', () => {
  const NON_EMPTY: LeverDiff = { onlyInA: [], onlyInB: ['x'], changed: [], isEmpty: false };

  it('FI outranks a 30-year gap that is well over the floor', () => {
    const m = buildPlanReview(input({
      a: side('Baseline', { milestones: { financialIndependenceISO: '2040-06', netWorth30y: 900_000 } as Milestones }),
      b: side('Aggressive payoff', { payload: variant(), milestones: { financialIndependenceISO: '2043-06', netWorth30y: 400_000 } as Milestones }),
      leverDiff: NON_EMPTY,
    }));
    expect(lineText(m.bottomLine)).toBe('Baseline reaches the FI mark 36 months earlier — June 2040 vs June 2043.');
    // …and the 30-year figure reappears as the CR-TR-NW bullet, never lost.
    expect(m.tradeoffs.map(lineText)).toEqual(['Baseline ends $500,000 higher at the 30-year mark.']);
  });

  it('the 30-year gap outranks debt-free when no FI date exists', () => {
    const m = buildPlanReview(input({
      a: side('Baseline', { milestones: { debtFreeISO: '2028-03', netWorth30y: 900_000 } as Milestones }),
      b: side('Aggressive payoff', { payload: variant(), milestones: { debtFreeISO: '2030-03', netWorth30y: 400_000 } as Milestones }),
      leverDiff: NON_EMPTY,
    }));
    expect(lineText(m.bottomLine)).toBe('Baseline ends $500,000 higher at the 30-year mark.');
    expect(m.tradeoffs.map(lineText)).toEqual(['Baseline is debt-free 24 months earlier — March 2028 vs March 2030.']);
  });
});

describe('tradeoffs (§1.4)', () => {
  it('consumed-by-bottom-line families do not repeat; others render in fixed order', () => {
    const i = input({
      a: side('Baseline', {
        states: [st('2026-09'), st('2045-01', { withdrawnFromInvestments: 100 })],
        milestones: { financialIndependenceISO: '2040-06', debtFreeISO: '2028-03', retirementISO: '2044-01' } as Milestones,
      }),
      b: side('Aggressive payoff', {
        milestones: { financialIndependenceISO: '2043-06', debtFreeISO: '2030-03', retirementISO: '2046-01' } as Milestones,
      }),
    });
    const m = buildPlanReview(i);
    expect(lineText(m.bottomLine)).toBe('Baseline reaches the FI mark 36 months earlier — June 2040 vs June 2043.');
    expect(m.tradeoffs.map(lineText)).toEqual([
      'Baseline is debt-free 24 months earlier — March 2028 vs March 2030.',
      "Baseline starts drawing from investments in January 2045; Aggressive payoff doesn't within the horizon.",
      'Salary income ends January 2044 in Baseline and January 2046 in Aggressive payoff.',
    ]);
  });

  it('one-side variants: debt carry + salary continues', () => {
    const i = input({
      a: side('Baseline', { milestones: { debtFreeISO: '2030-01', retirementISO: '2044-01' } as Milestones }),
      b: side('Aggressive payoff', { payload: variant() }),
      leverDiff: { onlyInA: [], onlyInB: ['x'], changed: [], isEmpty: false },
    });
    const m = buildPlanReview(i);
    expect(m.tradeoffs.map(lineText)).toEqual([
      'Baseline is debt-free by January 2030; Aggressive payoff still carries debt at the end of the horizon.',
      'Salary income ends January 2044 in Baseline; in Aggressive payoff it continues through the horizon.',
    ]);
  });

  it('both sides draw at different months → the two-sided draw bullet', () => {
    const i = input({
      a: side('Baseline', { states: [st('2044-05', { withdrawnFromInvestments: 10 })], payload: variant() }),
      b: side('Aggressive payoff', { states: [st('2046-11', { withdrawnFromInvestments: 10 })] }),
      leverDiff: { onlyInA: ['x'], onlyInB: [], changed: [], isEmpty: false },
    });
    expect(buildPlanReview(i).tradeoffs.map(lineText)).toEqual([
      'Baseline starts drawing from investments in May 2044; Aggressive payoff in November 2046.',
    ]);
  });

  // The full candidate order FI → DEBT → NW → DRAW → RETIRE, with the FI
  // family consumed by the bottom line. `toEqual` on the exact four lines
  // (the old `<= 4` could not fail): it pins the ORDER and the family skip,
  // which are the reachable rules — the cap and the text-dedupe are
  // structurally unreachable, recorded as such in plan-review.ts.
  it('the tradeoff list is the four remaining families, in the contract order', () => {
    const i = input({
      a: side('Baseline', {
        states: [st('2044-05', { withdrawnFromInvestments: 10 })],
        milestones: {
          financialIndependenceISO: '2040-06', debtFreeISO: '2028-03',
          retirementISO: '2044-01', netWorth30y: 900_000,
        } as Milestones,
      }),
      b: side('Aggressive payoff', {
        states: [st('2046-11', { withdrawnFromInvestments: 10 })],
        milestones: {
          financialIndependenceISO: '2043-06', debtFreeISO: '2030-03',
          retirementISO: '2046-01', netWorth30y: 400_000,
        } as Milestones,
      }),
    });
    const m = buildPlanReview(i);
    expect(lineText(m.bottomLine)).toBe('Baseline reaches the FI mark 36 months earlier — June 2040 vs June 2043.');
    expect(m.tradeoffs.map(lineText)).toEqual([
      'Baseline is debt-free 24 months earlier — March 2028 vs March 2030.',
      'Baseline ends $500,000 higher at the 30-year mark.',
      'Baseline starts drawing from investments in May 2044; Aggressive payoff in November 2046.',
      'Salary income ends January 2044 in Baseline and January 2046 in Aggressive payoff.',
    ]);
  });
});

describe('same-yardstick block (§1.2)', () => {
  it('nominal: Y1 + Y2 + Y4a, byte-exact', () => {
    const m = buildPlanReview(input());
    expect(m.yardstick.map(lineText)).toEqual([
      'Same data: both lines start from one capture of your data — the same accounts, balances, loans, incomes, and tax brackets.',
      'Same yardstick: dollars are nominal and the horizon is 30 years — for every line on this chart.',
      'Return, inflation, withdrawal, and tax assumptions are identical — the differences below come only from the plan levers.',
    ]);
  });

  it('real mode adds the one-deflator clause with its source label', () => {
    const m = buildPlanReview(input({ dollarMode: 'real' }));
    expect(lineText(m.yardstick[1])).toBe(
      "Same yardstick: dollars are real (today's dollars) and the horizon is 30 years — for every line on this chart.");
    expect(lineText(m.yardstick[2])).toBe(
      "One deflator: today's-dollar conversion uses one inflation rate — 3%, your household setting — applied to every line.");
  });

  it('deflator mismatch appendix names the side and both rates', () => {
    const m = buildPlanReview(input({
      dollarMode: 'real',
      parity: { ...EQ_PARITY, inflation: { aEffective: 0.03, bEffective: 0.04, aHasOverrides: false, bHasOverrides: false } },
    }));
    expect(lineText(m.yardstick[2])).toBe(
      "One deflator: today's-dollar conversion uses one inflation rate — 3%, your household setting — applied to every line." +
      ' Aggressive payoff is projected at 4% inflation but deflated at 3% here.');
  });

  it('override appendix wins over the mismatch appendix for that side', () => {
    const m = buildPlanReview(input({
      dollarMode: 'real',
      parity: { ...EQ_PARITY, inflation: { aEffective: 0.03, bEffective: 0.04, aHasOverrides: false, bHasOverrides: true } },
    }));
    expect(lineText(m.yardstick[2])).toBe(
      "One deflator: today's-dollar conversion uses one inflation rate — 3%, your household setting — applied to every line." +
      ' Aggressive payoff carries year-specific inflation overrides but is deflated at a flat 3% here.');
  });

  it('A is appended before B when both sides diverge from the deflator', () => {
    const m = buildPlanReview(input({
      dollarMode: 'real',
      parity: { ...EQ_PARITY, inflation: { aEffective: 0.02, bEffective: 0.04, aHasOverrides: false, bHasOverrides: false } },
    }));
    expect(lineText(m.yardstick[2])).toBe(
      "One deflator: today's-dollar conversion uses one inflation rate — 3%, your household setting — applied to every line." +
      ' Baseline is projected at 2% inflation but deflated at 3% here.' +
      ' Aggressive payoff is projected at 4% inflation but deflated at 3% here.');
  });

  // Review MINOR 3: the months branch of CR-Y2 was unpinned — only BL-3h's
  // horizonClause covered non-12-divisible horizons.
  it('CR-Y2 names months when the horizon is not a whole number of years', () => {
    expect(lineText(buildPlanReview(input({ horizonMonths: 250 })).yardstick[1])).toBe(
      'Same yardstick: dollars are nominal and the horizon is 250 months — for every line on this chart.');
  });

  // Review MINOR 18: pct is toFixed(2) trimmed in BOTH copies — toFixed(1)
  // would round a 2.75% deflator to 2.8% inside an honesty clause.
  it('the deflator rate keeps two decimals (2.75%, never 2.8%)', () => {
    const m = buildPlanReview(input({
      dollarMode: 'real',
      deflator: { rate: 0.0275, sourceLabel: 'your Settings default' },
    }));
    expect(lineText(m.yardstick[2])).toBe(
      "One deflator: today's-dollar conversion uses one inflation rate — 2.75%, your Settings default — applied to every line."
      + ' Baseline is projected at 3% inflation but deflated at 2.75% here.'
      + ' Aggressive payoff is projected at 3% inflation but deflated at 2.75% here.');
  });

  // CR-Y3b's condition is "the side HAS year-specific overrides" ALONE. The
  // natural configuration is exactly the one an extra baseline-mismatch
  // requirement would silence: the ACTIVE scenario supplies the deflator, so
  // its engine-effective baseline equals it by construction (D-W3-6).
  it('CR-Y3b fires on overrides alone, with the side effective == the deflator', () => {
    const bOnly = buildPlanReview(input({
      dollarMode: 'real',
      parity: { ...EQ_PARITY, inflation: { aEffective: 0.03, bEffective: 0.03, aHasOverrides: false, bHasOverrides: true } },
    }));
    expect(lineText(bOnly.yardstick[2])).toBe(
      "One deflator: today's-dollar conversion uses one inflation rate — 3%, your household setting — applied to every line."
      + ' Aggressive payoff carries year-specific inflation overrides but is deflated at a flat 3% here.');
    const aOnly = buildPlanReview(input({
      dollarMode: 'real',
      parity: { ...EQ_PARITY, inflation: { aEffective: 0.03, bEffective: 0.03, aHasOverrides: true, bHasOverrides: false } },
    }));
    expect(lineText(aOnly.yardstick[2])).toBe(
      "One deflator: today's-dollar conversion uses one inflation rate — 3%, your household setting — applied to every line."
      + ' Baseline carries year-specific inflation overrides but is deflated at a flat 3% here.');
  });

  it('parity differences render as the named list', () => {
    const m = buildPlanReview(input({
      parity: { ...EQ_PARITY, equal: false, differences: ['return 7% vs 5.5%', 'withdrawal strategy proportional vs sequential'] },
      leverDiff: { onlyInA: [], onlyInB: ['x'], changed: [], isEmpty: false },
    }));
    expect(lineText(m.yardstick[2])).toBe(
      'These plans differ in assumptions, not just moves: return 7% vs 5.5%; withdrawal strategy proportional vs sequential.');
  });
});

describe('main difference (§1.5)', () => {
  it('only-in lines + cross-ref when assumptions also differ', () => {
    const m = buildPlanReview(input({
      parity: { ...EQ_PARITY, equal: false, differences: ['return 7% vs 5.5%'] },
      leverDiff: { onlyInA: ['+$200/mo on Car loan (Always)'], onlyInB: ['Lump sum 2026-09: +$10,000 (investments)'], changed: [], isEmpty: false },
    }));
    expect(m.mainDifference.map(lineText)).toEqual([
      'Only in Aggressive payoff: Lump sum 2026-09: +$10,000 (investments)',
      'Only in Baseline: +$200/mo on Car loan (Always)',
      'Assumption differences are listed under Same yardstick above.',
    ]);
  });

  it('changed-in-both lines render after the only-in lines', () => {
    const m = buildPlanReview(input({
      leverDiff: { onlyInA: [], onlyInB: ['Lump sum 2026-09: +$10,000 (investments)'], changed: ['Annual raises: 3% vs 2%'], isEmpty: false },
    }));
    expect(m.mainDifference.map(lineText)).toEqual([
      'Only in Aggressive payoff: Lump sum 2026-09: +$10,000 (investments)',
      'Annual raises: 3% vs 2%',
    ]);
  });

  it('empty diff: parity-equal and parity-differs forms', () => {
    expect(buildPlanReview(input()).mainDifference.map(lineText))
      .toEqual(['No differences — see the bottom line.']);
    const m = buildPlanReview(input({
      parity: { ...EQ_PARITY, equal: false, differences: ['return 7% vs 5.5%'] },
    }));
    expect(m.mainDifference.map(lineText))
      .toEqual(["The plans' moves are identical — only the assumptions above differ."]);
  });
});

describe('degradation + footer', () => {
  it('empty-states side → clauses 1-2 + the refusal; no figures fabricated', () => {
    const m = buildPlanReview(input({ b: side('Aggressive payoff', { states: [] }) }));
    expect(m.yardstick).toHaveLength(2);
    expect(lineText(m.bottomLine)).toBe('Projection unavailable for Aggressive payoff.');
    expect(m.tradeoffs).toEqual([]);
    expect(m.mainDifference).toEqual([]);
  });

  it('both sides empty → both names', () => {
    const m = buildPlanReview(input({ a: side('Baseline', { states: [] }), b: side('Aggressive payoff', { states: [] }) }));
    expect(lineText(m.bottomLine)).toBe('Projection unavailable for Baseline and Aggressive payoff.');
  });

  it('footer is the fixed not-advice constant on every model', () => {
    expect(buildPlanReview(input()).footer).toBe(
      'A mechanical comparison of two scenarios you built — not advice, not a recommendation.');
    expect(COMPARE_FOOTER.includes('!')).toBe(false);
  });
});

describe('advice-lexicon + reserved phrases (D-W3-10/11) — over EVERY template', () => {
  const models: PlanReviewModel[] = [
    buildPlanReview(input()),
    buildPlanReview(input({
      dollarMode: 'real',
      a: side('Baseline', { milestones: { financialIndependenceISO: '2040-06', netWorth30y: 900_000 } as Milestones }),
      b: side('Aggressive payoff', { milestones: { debtFreeISO: '2031-01', netWorth30y: 400_000 } as Milestones }),
      parity: { ...EQ_PARITY, equal: false, differences: ['return 7% vs 5.5%'] },
      leverDiff: { onlyInA: ['+$200/mo on Car loan (Always)'], onlyInB: [], changed: ['Annual raises: 3% vs 2%'], isEmpty: false },
    })),
    buildPlanReview(input({ b: side('Aggressive payoff', { states: [] }) })),
  ];
  const allLines = models.flatMap((m) => [...m.yardstick, m.bottomLine, ...m.tradeoffs, ...m.mainDifference].map(lineText));

  // Review MINOR 0: the scan used to run over three assembled models, which
  // reached ~13 of the 22 template families — planting 'should' in BL1 or
  // TR_RET2 was caught only by the byte pins. Rendering the REGISTRY itself
  // with a representative-slot table closes the escape hatch for good.
  const TEMPLATE_SLOTS: Record<keyof typeof TEMPLATES, unknown> = {
    Y1: undefined,
    Y2: { basis: "real (today's dollars)", horizon: '30 years' },
    Y4_EQUAL: undefined,
    Y4_DIFFER: { list: 'return 7% vs 5.5%; withdrawal strategy proportional vs sequential' },
    BL1: { earlierName: 'Baseline', months: 36, earlierLabel: 'June 2040', laterLabel: 'June 2043' },
    BL2: { yesName: 'Baseline', monthLabel: 'February 2041', noName: 'Aggressive payoff' },
    BL3: { higherName: 'Baseline', delta: '$205,993', horizonClause: 'at the 30-year mark', basisSuffix: " (today's dollars)" },
    BL4: { earlierName: 'Baseline', months: 24, earlierLabel: 'March 2028', laterLabel: 'March 2030' },
    BL5: undefined,
    BL6: { floor: '$500' },
    TR_DEBT1: { yesName: 'Baseline', monthLabel: 'January 2030', noName: 'Aggressive payoff' },
    TR_DRAW2: { firstName: 'Baseline', firstLabel: 'May 2044', secondName: 'Aggressive payoff', secondLabel: 'November 2046' },
    TR_DRAW1: { name: 'Baseline', monthLabel: 'January 2045', otherName: 'Aggressive payoff' },
    TR_RET2: { aLabel: 'January 2044', aName: 'Baseline', bLabel: 'January 2046', bName: 'Aggressive payoff' },
    TR_RET1: { monthLabel: 'January 2044', name: 'Baseline', otherName: 'Aggressive payoff' },
    MD_ONLY: { name: 'Baseline', phrase: '+$200/mo on Car loan (Always)' },
    MD_CHANGED: { line: 'Annual raises: 3% vs 2%' },
    MD_XREF: undefined,
    MD_NONE: undefined,
    MD_ASSUMPTIONS_ONLY: undefined,
    UNAVAILABLE: { names: 'Baseline and Aggressive payoff' },
  };
  const templateLines = Object.entries(TEMPLATES).map(([k, fn]) =>
    lineText((fn as unknown as (s?: unknown) => ReviewLine)(TEMPLATE_SLOTS[k as keyof typeof TEMPLATES])));

  it('RATCHET: every TEMPLATES entry has a representative slot (a new one cannot escape)', () => {
    expect(Object.keys(TEMPLATE_SLOTS).sort()).toEqual(Object.keys(TEMPLATES).sort());
    expect(templateLines.length).toBe(Object.keys(TEMPLATES).length);
    for (const line of templateLines) expect(line.length).toBeGreaterThan(0);
  });

  it('no prescriptive lexeme in ANY template family or assembled line (footer exempt)', () => {
    for (const line of [...templateLines, ...allLines]) expect(line).not.toMatch(ADVICE_LEXICON);
  });

  it('no exclamation marks anywhere in the registry output', () => {
    for (const s of [...templateLines, ...allLines, COMPARE_FOOTER, SECOND_SCENARIO_PROMPT, SEND_POINTER]) {
      expect(s).not.toContain('!');
    }
  });

  it('reserved phrases never appear (incl. the footer)', () => {
    for (const s of [...templateLines, ...allLines, COMPARE_FOOTER, SECOND_SCENARIO_PROMPT, SEND_POINTER]) {
      for (const phrase of RESERVED_PHRASES) expect(s).not.toContain(phrase);
    }
  });

  it('the footer is the ONE exempt string, and it is pinned byte-exact', () => {
    expect(COMPARE_FOOTER).toMatch(ADVICE_LEXICON);  // names the register, deliberately
    expect(COMPARE_FOOTER).toBe(
      'A mechanical comparison of two scenarios you built — not advice, not a recommendation.');
  });
});

describe('determinism (§2 threat table)', () => {
  it('PROPERTY: byte-identical output for independently constructed equal inputs', () => {
    const mk = () => input({
      a: side('Baseline', { milestones: { financialIndependenceISO: '2040-06' } as Milestones }),
      b: side('Aggressive payoff', { milestones: { financialIndependenceISO: '2043-06' } as Milestones }),
    });
    expect(JSON.stringify(buildPlanReview(mk()))).toBe(JSON.stringify(buildPlanReview(mk())));
  });

  it('SOURCE SCAN: the W3 libs use no ambient clock, locale, or randomness', () => {
    // Review MINOR 6: the list used to be `.filter(existsSync)` with a
    // `>= 2` floor (a Task-3-not-yet-landed accommodation), so renaming or
    // moving a lib silently dropped it from the scan. All three ship now —
    // each path must EXIST, and all three must be scanned.
    const paths = [
      'src/lib/whatif/plan-review.ts',
      'src/lib/whatif/lever-diff.ts',
      'src/lib/model-gaps.ts',
    ].map((f) => join(process.cwd(), f));
    for (const f of paths) expect(existsSync(f)).toBe(true);
    const libs = paths;
    expect(libs.length).toBe(3);
    for (const f of libs) {
      const src = readFileSync(f, 'utf8');
      expect(src).not.toContain('Date.now(');
      expect(src).not.toContain('new Date' + '()');           // bare form only; new Date(iso) is fine
      expect(src).not.toContain('Math.random');
      expect(src).not.toMatch(/toLocaleString\((?!'en-US')/); // fixed-locale only
      expect(src).not.toContain('toLocaleDateString');
    }
  });
});

describe('golden byte pins (D-W3-P14) — reviewed against the copy contract, then locked', () => {
  it('both-FI', () => {
    const m = buildPlanReview(input({
      a: side('Baseline', { milestones: { financialIndependenceISO: '2040-06', debtFreeISO: '2028-03' } as Milestones }),
      b: side('Aggressive payoff', { payload: variant(), milestones: { financialIndependenceISO: '2043-06', debtFreeISO: '2030-03' } as Milestones }),
      leverDiff: { onlyInA: [], onlyInB: ['Lump sum 2026-09: +$10,000 (investments)'], changed: [], isEmpty: false },
    }));
    expect(JSON.stringify(m)).toBe(GOLDEN_BOTH_FI);
  });

  it('one-FI', () => {
    const m = buildPlanReview(input({
      b: side('Aggressive payoff', { payload: variant(), milestones: { financialIndependenceISO: '2041-02' } as Milestones }),
      leverDiff: { onlyInA: ['+$200/mo on Car loan (Always)'], onlyInB: [], changed: [], isEmpty: false },
    }));
    expect(JSON.stringify(m)).toBe(GOLDEN_ONE_FI);
  });

  it('assumptions-diverge, real mode', () => {
    const m = buildPlanReview(input({
      dollarMode: 'real',
      a: side('Baseline', { milestones: { netWorth30y: 900_000 } as Milestones }),
      b: side('Aggressive payoff', { payload: variant(), milestones: { netWorth30y: 400_000 } as Milestones }),
      parity: {
        equal: false, differences: ['return 7% vs 5.5%'],
        inflation: { aEffective: 0.03, bEffective: 0.04, aHasOverrides: false, bHasOverrides: false },
      },
      leverDiff: { onlyInA: [], onlyInB: [], changed: ['Annual raises: 3% vs 2%'], isEmpty: false },
    }));
    expect(JSON.stringify(m)).toBe(GOLDEN_ASSUMPTIONS_REAL);
  });

  it('identical payloads', () => {
    expect(JSON.stringify(buildPlanReview(input()))).toBe(GOLDEN_IDENTICAL);
  });
});

describe('deflator source label (D-W3-P9) — branch parity with effectiveBaselineInflation', () => {
  it('resolves each branch to its frozen label', () => {
    const hh = makeHousehold({ inflationAssumption: 0.03 });
    const scenarioWith = { leverPayload: { ...emptyLeverPayload(), inflation: { defaultRate: 0.04, overrides: {} } } };
    expect(resolveDeflatorSourceLabel(scenarioWith as never, hh, null)).toBe(DEFLATOR_LABELS.scenario);
    expect(resolveDeflatorSourceLabel(null, hh, null)).toBe(DEFLATOR_LABELS.household);
    expect(resolveDeflatorSourceLabel(null, null, { defaultInflation: 0.025 } as never)).toBe(DEFLATOR_LABELS.settings);
    expect(resolveDeflatorSourceLabel(null, null, null)).toBe(DEFLATOR_LABELS.appDefault);
  });

  // Review MAJOR 3: the four single-source fixtures above never exercise the
  // ORDER of the household and Settings legs — and on this page a household
  // is ALWAYS present (Household.inflationAssumption is non-nullable,
  // D-W3-P1) while Settings > Advanced default inflation is user-settable, so
  // a swapped branch would put a false provenance claim in a rendered clause.
  it('PARITY: each label names the leg effectiveBaselineInflation actually returns', () => {
    const hh = makeHousehold({ inflationAssumption: 0.03 });
    const settings = { defaultInflation: 0.025 } as unknown as AppSettings;
    const scenarioWith = {
      leverPayload: { ...emptyLeverPayload(), inflation: { defaultRate: 0.04, overrides: {} } },
    } as unknown as Scenario;
    const cases: [Scenario | null, Household | null, AppSettings | null, string, number][] = [
      // ALL THREE set → the scenario lever wins, in both the label and the value.
      [scenarioWith, hh, settings, DEFLATOR_LABELS.scenario, 0.04],
      // household AND Settings set → household, never 'your Settings default'.
      [null, hh, settings, DEFLATOR_LABELS.household, 0.03],
      [null, null, settings, DEFLATOR_LABELS.settings, 0.025],
      [null, null, null, DEFLATOR_LABELS.appDefault, 0.03],
    ];
    for (const [sc0, hh0, st0, label, value] of cases) {
      expect(resolveDeflatorSourceLabel(sc0, hh0, st0)).toBe(label);
      expect(effectiveBaselineInflation(sc0, hh0, st0)).toBe(value);
    }
  });

  it('the four labels are the canonical provenance literals', () => {
    expect(DEFLATOR_LABELS).toEqual({
      scenario: "the active scenario's inflation lever",
      household: 'your household setting',
      settings: 'your Settings default',
      appDefault: 'app default 3%',
    });
  });
});

describe('resolveComparePair (D-W3-3 lens)', () => {
  const sc = (id: number, over: Record<string, unknown> = {}) => ({
    id, name: `S${id}`, isBaseline: false, color: '#4f86f7', lineStyle: 'solid' as const,
    visible: true, isActive: false, sortOrder: id, leverPayload: emptyLeverPayload(),
    createdAt: '2026-08-25T00:00:00Z', updatedAt: '2026-08-25T00:00:00Z', ...over,
  });
  const scenarios = [
    sc(1, { isBaseline: true, sortOrder: 0, name: 'Baseline' }),
    sc(2, { isActive: true }),
    sc(3),
  ] as unknown as Scenario[];

  it('A defaults to the baseline; B honors createdScenarioId', () => {
    const r = resolveComparePair(scenarios, { aId: null, bId: null }, 3);
    expect(r.a?.id).toBe(1);
    expect(r.b?.id).toBe(3);
  });
  it('without createdScenarioId, B is the active non-baseline', () => {
    expect(resolveComparePair(scenarios, { aId: null, bId: null }, null).b?.id).toBe(2);
  });
  it('B never equals A: selecting A over the current B reselects B', () => {
    const r = resolveComparePair(scenarios, { aId: 2, bId: 2 }, null);
    expect(r.a?.id).toBe(2);
    expect(r.b?.id).not.toBe(2);
  });
  it('a single scenario resolves A only', () => {
    const r = resolveComparePair([scenarios[0]], { aId: null, bId: null }, null);
    expect(r.a?.id).toBe(1);
    expect(r.b).toBeNull();
  });
  it('no scenarios resolves to a null pair', () => {
    expect(resolveComparePair([], { aId: null, bId: null }, null)).toEqual({ a: null, b: null });
  });

  // Review MINOR 17: with the baseline active (the everyday state) B comes
  // from the sortOrder fallback — every earlier fixture had one candidate.
  it('with the baseline active, B is the HIGHEST-sortOrder non-baseline', () => {
    const list = [
      sc(1, { isBaseline: true, sortOrder: 0, name: 'Baseline', isActive: true }),
      sc(2, { sortOrder: 1 }),
      sc(3, { sortOrder: 2 }),
    ] as unknown as Scenario[];
    expect(resolveComparePair(list, { aId: null, bId: null }, null).b?.id).toBe(3);
  });

  // Review MINOR 11: projectedScenarios(real) projects VISIBLE scenarios only,
  // so a hidden default pick renders the CR-9 refusal as the card's first
  // impression. The two FALLBACK rungs prefer a visible candidate; the
  // explicit selection and createdScenarioId stay unfiltered so the refusal
  // remains reachable and honest.
  it('the sortOrder fallback prefers a VISIBLE candidate over a hidden newer one', () => {
    const list = [
      sc(1, { isBaseline: true, sortOrder: 0, name: 'Baseline', isActive: true }),
      sc(2, { sortOrder: 1 }),
      sc(3, { sortOrder: 2, visible: false }),
    ] as unknown as Scenario[];
    expect(resolveComparePair(list, { aId: null, bId: null }, null).b?.id).toBe(2);
  });

  it('the active-non-baseline fallback prefers a VISIBLE candidate', () => {
    const list = [
      sc(1, { isBaseline: true, sortOrder: 0, name: 'Baseline' }),
      sc(2, { sortOrder: 1, isActive: true, visible: false }),
      sc(3, { sortOrder: 2, isActive: true }),
    ] as unknown as Scenario[];
    expect(resolveComparePair(list, { aId: null, bId: null }, null).b?.id).toBe(3);
  });

  it('an all-hidden field still resolves B (the refusal is reachable, never a crash)', () => {
    const list = [
      sc(1, { isBaseline: true, sortOrder: 0, name: 'Baseline', isActive: true }),
      sc(2, { sortOrder: 1, visible: false }),
    ] as unknown as Scenario[];
    expect(resolveComparePair(list, { aId: null, bId: null }, null).b?.id).toBe(2);
  });

  it('an EXPLICIT hidden selection and createdScenarioId are never filtered', () => {
    const list = [
      sc(1, { isBaseline: true, sortOrder: 0, name: 'Baseline', isActive: true }),
      sc(2, { sortOrder: 1 }),
      sc(3, { sortOrder: 2, visible: false }),
    ] as unknown as Scenario[];
    expect(resolveComparePair(list, { aId: null, bId: 3 }, null).b?.id).toBe(3);
    expect(resolveComparePair(list, { aId: null, bId: null }, 3).b?.id).toBe(3);
  });
});

// ── Golden byte pins ────────────────────────────────────────────────────────
// Materialized from a reviewed first run (D-W3-P14): each string below was
// printed once, checked line by line against the W3 copy contract, then locked.
//
// GOLDEN_ASSUMPTIONS_REAL's BL-3 figure, derived by hand against the
// fmtNetWorth30y recipe (ManageScenariosModal.tsx:39-44) rather than trusted:
//   1.03^30                       = 2.427262471189662
//   disp(900,000) = 900,000/1.03^30 = 370,788.08356431575  (higher → "Baseline")
//   disp(400,000) = 400,000/1.03^30 = 164,794.70380636255
//   |Δ|                            = 205,993.3797579532 → formatCurrency → $205,993
//   floor = max(500, 0.005 × 370,788.08) = 1,853.94 → Δ ≥ floor, so BL-3 fires.
const GOLDEN_BOTH_FI = '{"yardstick":[{"parts":[{"text":"Same data: both lines start from one capture of your data — the same accounts, balances, loans, incomes, and tax brackets."}]},{"parts":[{"text":"Same yardstick: dollars are "},{"text":"nominal","emphasis":true},{"text":" and the horizon is "},{"text":"30 years","emphasis":true},{"text":" — for every line on this chart."}]},{"parts":[{"text":"Return, inflation, withdrawal, and tax assumptions are identical — the differences below come only from the plan levers."}]}],"bottomLine":{"parts":[{"text":"Baseline reaches the FI mark "},{"text":"36 months","emphasis":true},{"text":" earlier — "},{"text":"June 2040","emphasis":true},{"text":" vs "},{"text":"June 2043","emphasis":true},{"text":"."}]},"tradeoffs":[{"parts":[{"text":"Baseline is debt-free "},{"text":"24 months","emphasis":true},{"text":" earlier — "},{"text":"March 2028","emphasis":true},{"text":" vs "},{"text":"March 2030","emphasis":true},{"text":"."}]}],"mainDifference":[{"parts":[{"text":"Only in Aggressive payoff: "},{"text":"Lump sum 2026-09: +$10,000 (investments)","emphasis":true}]}],"footer":"A mechanical comparison of two scenarios you built — not advice, not a recommendation."}';

const GOLDEN_ONE_FI = '{"yardstick":[{"parts":[{"text":"Same data: both lines start from one capture of your data — the same accounts, balances, loans, incomes, and tax brackets."}]},{"parts":[{"text":"Same yardstick: dollars are "},{"text":"nominal","emphasis":true},{"text":" and the horizon is "},{"text":"30 years","emphasis":true},{"text":" — for every line on this chart."}]},{"parts":[{"text":"Return, inflation, withdrawal, and tax assumptions are identical — the differences below come only from the plan levers."}]}],"bottomLine":{"parts":[{"text":"Aggressive payoff reaches the FI mark within the horizon ("},{"text":"February 2041","emphasis":true},{"text":"); Baseline doesn\'t."}]},"tradeoffs":[],"mainDifference":[{"parts":[{"text":"Only in Baseline: "},{"text":"+$200/mo on Car loan (Always)","emphasis":true}]}],"footer":"A mechanical comparison of two scenarios you built — not advice, not a recommendation."}';

const GOLDEN_ASSUMPTIONS_REAL = '{"yardstick":[{"parts":[{"text":"Same data: both lines start from one capture of your data — the same accounts, balances, loans, incomes, and tax brackets."}]},{"parts":[{"text":"Same yardstick: dollars are "},{"text":"real (today\'s dollars)","emphasis":true},{"text":" and the horizon is "},{"text":"30 years","emphasis":true},{"text":" — for every line on this chart."}]},{"parts":[{"text":"One deflator: today\'s-dollar conversion uses one inflation rate — "},{"text":"3%","emphasis":true},{"text":", your household setting — applied to every line."},{"text":" Aggressive payoff is projected at "},{"text":"4%","emphasis":true},{"text":" inflation but deflated at "},{"text":"3%","emphasis":true},{"text":" here."}]},{"parts":[{"text":"These plans differ in assumptions, not just moves: "},{"text":"return 7% vs 5.5%","emphasis":true},{"text":"."}]}],"bottomLine":{"parts":[{"text":"Baseline ends "},{"text":"$205,993","emphasis":true},{"text":" higher at the 30-year mark (today\'s dollars)."}]},"tradeoffs":[],"mainDifference":[{"parts":[{"text":"Annual raises: 3% vs 2%","emphasis":true}]},{"parts":[{"text":"Assumption differences are listed under Same yardstick above."}]}],"footer":"A mechanical comparison of two scenarios you built — not advice, not a recommendation."}';

const GOLDEN_IDENTICAL = '{"yardstick":[{"parts":[{"text":"Same data: both lines start from one capture of your data — the same accounts, balances, loans, incomes, and tax brackets."}]},{"parts":[{"text":"Same yardstick: dollars are "},{"text":"nominal","emphasis":true},{"text":" and the horizon is "},{"text":"30 years","emphasis":true},{"text":" — for every line on this chart."}]},{"parts":[{"text":"Return, inflation, withdrawal, and tax assumptions are identical — the differences below come only from the plan levers."}]}],"bottomLine":{"parts":[{"text":"These two scenarios are identical — their lines overlap."}]},"tradeoffs":[],"mainDifference":[{"parts":[{"text":"No differences — see the bottom line."}]}],"footer":"A mechanical comparison of two scenarios you built — not advice, not a recommendation."}';
