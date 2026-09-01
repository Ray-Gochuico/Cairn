import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { emptyLeverPayload, type Milestones, type MonthlyState } from '@/lib/scenarios';
import { NET_WORTH_FLOOR_ABS } from '@/lib/briefing';
import {
  buildPlanReview, lineText, COMPARE_FOOTER, SECOND_SCENARIO_PROMPT, SEND_POINTER,
  resolveDeflatorSourceLabel, resolveComparePair, DEFLATOR_LABELS,
  type CompareSide, type PlanReviewInput, type PlanReviewModel,
} from '@/lib/whatif/plan-review';
import type { AssumptionParity, LeverDiff } from '@/lib/whatif/lever-diff';
import type { Scenario } from '@/types/scenario';
import { makeHousehold } from '../../factories';

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

  it('BL-3h: a horizon that is not a whole number of years names months', () => {
    const i = input({
      horizonMonths: 250,
      a: side('Baseline', { milestones: { netWorth30y: 100_000 } as Milestones }),
      b: side('Aggressive payoff', { milestones: { netWorth30y: 103_000 } as Milestones }),
      leverDiff: { onlyInA: [], onlyInB: ['x'], changed: [], isEmpty: false },
    });
    expect(bl(i)).toBe('Aggressive payoff ends $3,000 higher at the end of your 250-month horizon.');
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

  it('the tradeoff list is capped at four bullets', () => {
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
    expect(buildPlanReview(i).tradeoffs.length).toBeLessThanOrEqual(4);
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

describe('advice-lexicon + reserved phrases (D-W3-10/11) — over ALL rendered lines', () => {
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

  it('no prescriptive lexeme in any narrative line (footer pinned separately)', () => {
    const ADVICE = /\b(should|recommend|recommendation|consider|suggest|suggested|ought|advise|advice|winner|act now)\b|\b(best|better)\s+plan\b|don'?t miss/i;
    for (const line of allLines) expect(line).not.toMatch(ADVICE);
  });

  it('no exclamation marks anywhere in the registry output', () => {
    for (const s of [...allLines, COMPARE_FOOTER, SECOND_SCENARIO_PROMPT, SEND_POINTER]) {
      expect(s).not.toContain('!');
    }
  });

  it('reserved phrases never appear (incl. the footer)', () => {
    for (const s of [...allLines, COMPARE_FOOTER, SECOND_SCENARIO_PROMPT, SEND_POINTER]) {
      expect(s).not.toContain('Suggested next step');
      expect(s).not.toContain('Note — not a warning.');
    }
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
    const libs = [
      'src/lib/whatif/plan-review.ts',
      'src/lib/whatif/lever-diff.ts',
      'src/lib/model-gaps.ts',           // exists from Task 3 on; filtered below
    ].map((f) => join(process.cwd(), f)).filter(existsSync);
    expect(libs.length).toBeGreaterThanOrEqual(2);
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
