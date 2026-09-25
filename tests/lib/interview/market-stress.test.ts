import { describe, it, expect, afterEach } from 'vitest';
import {
  INVESTED_ACCOUNT_TYPES, MIX_OPTIONS, computeMarketStress, investedBalance, renderMarketStress,
  type MarketStressResult,
} from '@/lib/interview/market-stress';
import { STRESS_WINDOWS } from '@/lib/backtest/windows';
import { flatPathEnd } from '@/lib/backtest/replay';
import { MAX_SOLVE_AGE, projectedFv } from '@/lib/calculators/retirement-age-solver';
import { AccountType } from '@/types/enums';
import type { InterviewContext } from '@/types/interview';
import { computeStressDelays, type StressDelayInput } from '@/lib/backtest/stress-delay';
import { buildScenarioDefaults, toEngineAssumptions } from '@/lib/calculators/scenario-assumptions';
import { realRateView } from '@/lib/calculators/basis-view';
import { pickModerateEntry } from '@/lib/growth-scenario';
import { currentAge } from '@/lib/dates';
import { makeAccount, makeHousehold, makePerson } from '../../factories';
import { fixtureCtx, snap } from './fixture';
import { ADVICE_LEXICON } from '../../helpers/advice-lexicon';

// The SEED'S SHAPE (sample-profile.ts + migration 0001 defaults) as a pure
// fixture: $935,000 FI-eligible (the 529 is out), no contributions, $6,000/mo,
// 4% SWR, 2.4% inflation, Moderate 6% → real 3.515625%; Avery b. 1988-04-12,
// Jordan b. 1990-09-03; today local 2026-08-01 → Avery 38 (the older).
const SEED_HOUSEHOLD = makeHousehold({
  monthlyExpenseBaseline: 6000, withdrawalRate: 0.04, inflationAssumption: 0.024,
  growthScenarios: [
    { label: 'Conservative', rate: 0.05 }, { label: 'Moderate', rate: 0.06 },
    { label: 'Optimistic', rate: 0.07 }, { label: 'Bull', rate: 0.08 },
  ],
});
const seedCtx = (overrides: Partial<InterviewContext> = {}) => fixtureCtx({
  household: SEED_HOUSEHOLD,
  persons: [
    makePerson({ id: 1, name: 'Avery Sample', dateOfBirth: '1988-04-12' }),
    makePerson({ id: 2, name: 'Jordan Sample', dateOfBirth: '1990-09-03' }),
  ],
  accounts: [
    makeAccount({ id: 1, type: AccountType.ACCOUNT_BROKERAGE, name: 'Taxable Brokerage' }),
    makeAccount({ id: 2, type: AccountType.ACCOUNT_ROTH_IRA, name: 'Roth IRA' }),
    makeAccount({ id: 3, type: AccountType.ACCOUNT_401K, name: '401(k)' }),
    makeAccount({ id: 4, type: AccountType.ACCOUNT_BROKERAGE, name: 'Partner Brokerage' }),
    makeAccount({ id: 5, type: AccountType.ACCOUNT_SAVINGS, name: 'Partner Savings' }),
    makeAccount({ id: 6, type: AccountType.ACCOUNT_CASH, name: 'Joint Checking' }),
    makeAccount({ id: 7, type: AccountType.ACCOUNT_529, name: '529 College Fund' }),
  ],
  snapshots: [snap(1, 285000), snap(2, 92000), snap(3, 410000), snap(4, 118000), snap(5, 22000), snap(6, 8000), snap(7, 12000)],
  loans: [],
  ...overrides,
});
const withAvery = (dob: string) => seedCtx({
  persons: [makePerson({ id: 1, name: 'Avery Sample', dateOfBirth: dob }), makePerson({ id: 2, name: 'Jordan Sample', dateOfBirth: '1990-09-03' })],
});
const render75 = (ctx: InterviewContext) => renderMarketStress(computeMarketStress(ctx, 'stocks-75'));
const fiClauses = (lines: string[]) => lines.filter((l) => l.includes('FI target') || l.includes('No change to the year') || l.includes('runs past age'));

const SEED_CI_MS_1 = "Your $935,000 portfolio — from your latest account snapshots — replayed through five historical windows at a 75% stocks / 25% bonds mix, in today's dollars.";
const SEED_LINES_75 = [
  "The 1929 crash (1929–1931): $592,050 at the deepest year-end, −36.7% from today; back at today's value by 1935. FI target about 17 years later than on your assumed path.",
  "The 1970s inflation run (1973–1981): $576,821 at the deepest year-end (1974), −38.3% from today, and $629,774 at the end of 1981; back at today's value by 1984. FI target about 21 years later than on your assumed path.",
  "The dot-com crash (2000–2002): $705,575 at the deepest year-end, −24.5% from today; back at today's value by 2006. FI target about 12 years later than on your assumed path.",
  "The 2008 crash (2008): $719,455 at the deepest year-end, −23.1% from today; back at today's value by 2010. FI target about 9 years later than on your assumed path.",
  "The 2022 inflation shock (2022): $773,401 at the deepest year-end, −17.3% from today; not back at today's value by 2022, where the bundled data ends. FI target about 7 years later than on your assumed path.",
];
const CI_MS_4 = 'History that happened once — not a forecast, not a probability.';
const CI_MS_5_75 = "Stock leg: Shiller's CPI-deflated S&P total return; bond leg: 10-year Treasury total return deflated to real. 75% / 25% mix, rebalanced annually — the same return basis as the Historical Backtest.";
const CI_MS_6 = "All figures in today's dollars — each window's inflation is already taken out. Measured at year-ends; the worst moments within a year were deeper.";
const CI_MS_12 = 'Two different tails: the "back at today\'s value" year follows the actual history after each window, while the FI reading resumes your assumed path from the window\'s last year and never replays those later years.';
const CI_MS_7_SEED = 'Your assumed path compounds your 6% moderate scenario ≈ 3.5% real with the same contribution basis.';
const CI_MS_8B_SEED = "FI target $1,800,000 = 12 × $6,000/mo (from Household) ÷ 4% SWR — two identical whole-year solves from each window's last year, one from the replayed balance and one from your assumed path's balance; the search ends where Avery Sample reaches 90, counting from today's age.";
const CI_MS_9E = "The FI target doesn't hold by age 90 on your assumed path — the retirement reading isn't shown.";
const CI_MS_9D = 'Past age 90 — the retirement reading has no search range.';
const CI_MS_11 = 'Every start year, not just these windows — the Stress Test card and the Backtest tool on Calculators.';

describe('market-stress — the seeded shape at stocks-75 (Appendix A; re-derived on 9f693bb0)', () => {
  it('CI-MS-1 + the five window lines, byte-exact, in REGISTRY order (never sorted)', () => {
    const r = render75(seedCtx());
    expect(r.title).toBe('Market stress');
    expect(r.lines).toEqual([SEED_CI_MS_1, ...SEED_LINES_75]);
    // ORDERED pin on a fixture whose severity order differs from registry
    // order: 1973's trough ($576,821) is deeper than 1929's ($592,050), so a
    // sort-by-trough or sort-by-depth mutant reorders — and reds here.
    expect(r.lines.slice(1).map((l) => STRESS_WINDOWS.find((w) => l.startsWith(`${w.label} (`))!.id))
      .toEqual(STRESS_WINDOWS.map((w) => w.id));
  });

  it('the assumes block, byte-exact and in order', () => {
    expect(render75(seedCtx()).assumes).toEqual([
      CI_MS_4, CI_MS_5_75, CI_MS_6, CI_MS_12, CI_MS_7_SEED, CI_MS_8B_SEED,
      'Portfolio: from your account snapshots.',
      'Contributions: no contributions in the last 12 months.',
      CI_MS_11,
    ]);
  });

  it('the data seam pins F2d directly (ruling 5): window-end start, flatPathEnd cadence, delay = tB − tA', () => {
    const r = computeMarketStress(seedCtx(), 'stocks-75');
    expect(r).toMatchObject({ pv: 935_000, pmt: 0, targetFv: 1_800_000, ageNow: 38, olderName: 'Avery Sample', personCount: 2, fiState: 'ok', solverRan: true, stockPct: 75, bondPct: 25, lastDataYear: 2022 });
    expect(r.realRate).toBeCloseTo(0.03515625, 12);
    const w1929 = r.windows[0];
    expect(w1929).toMatchObject({ id: 'depression-1929', n: 3, legStartYear: 1931, troughYear: 1931, recoveredYear: 1935, solveAge: 41, verdictA: 'age-found', verdictB: 'age-found', tA: 16, tB: 33, delay: 17 });
    expect(w1929.legAStart).toBeCloseTo(1_037_120.78, 2);
    expect(w1929.legAStart).toBeCloseTo(flatPathEnd(935_000, r.realRate, 0, 3), 6);
    expect(w1929.legBStart).toBeCloseTo(592_050.17, 2);
    expect(w1929.troughBalance).toBeCloseTo(592_050.17, 2);
    const w1973 = r.windows[1];
    expect(w1973).toMatchObject({ n: 9, legStartYear: 1981, troughYear: 1974, solveAge: 47, tA: 10, tB: 31, delay: 21 });
    expect(w1973.legAStart).toBeCloseTo(1_276_041.47, 2);
    expect(w1973.windowEndBalance).toBeCloseTo(629_773.79, 2);
    expect(r.windows.map((w) => w.legStartYear)).toEqual(STRESS_WINDOWS.map((w) => w.span.endYear));
  });

  it('determinism: two computes are deep-equal and byte-identical', () => {
    const a = computeMarketStress(seedCtx(), 'stocks-75');
    const b = computeMarketStress(seedCtx(), 'stocks-75');
    expect(a).toEqual(b);
    expect(JSON.stringify(renderMarketStress(a))).toBe(JSON.stringify(renderMarketStress(b)));
  });

  it('CI-MS-O: the four mixes, values and labels', () => {
    expect(MIX_OPTIONS.map((o) => [o.value, o.label, o.stockPct])).toEqual([
      ['stocks-100', 'All stocks', 100], ['stocks-75', '75% stocks, 25% bonds', 75],
      ['stocks-60', '60% stocks, 40% bonds', 60], ['stocks-40', '40% stocks, 60% bonds', 40],
    ]);
    expect(STRESS_WINDOWS).toHaveLength(5); // the literal "five" in CI-MS-1 is a copy event when the roster changes
  });
});

describe('two persons: the OLDER person caps the search in either listing order (R4 review UPHELD 0)', () => {
  // Every other fixture lists Avery (the older) first, so "older" and "first"
  // were indistinguishable. These arms list the YOUNGER person first.
  const JORDAN = makePerson({ id: 2, name: 'Jordan Sample', dateOfBirth: '1990-09-03' });
  const youngerFirst = (averyDob: string) =>
    seedCtx({ persons: [JORDAN, makePerson({ id: 1, name: 'Avery Sample', dateOfBirth: averyDob })] });

  it('Jordan (35) listed before Avery (38): Avery caps the search and CI-MS-8b names Avery — every string equals the Avery-first render', () => {
    const res = computeMarketStress(youngerFirst('1988-04-12'), 'stocks-75');
    expect(res).toMatchObject({ olderName: 'Avery Sample', ageNow: 38, personCount: 2, fiState: 'ok' });
    expect(res.windows.map((w) => w.solveAge)).toEqual([41, 47, 41, 39, 39]);
    const r = renderMarketStress(res);
    expect(r.assumes).toContain(CI_MS_8B_SEED);
    expect(r.lines).toEqual([SEED_CI_MS_1, ...SEED_LINES_75]);
    expect(r).toEqual(render75(seedCtx())); // listing order changes nothing
  });

  it('Avery at 82 listed SECOND: ageNow 82 — the 1970s line carries CI-MS-3g, the rest not-by-max → one CI-MS-9e row; CI-MS-8b names Avery', () => {
    const res = computeMarketStress(youngerFirst('1944-04-12'), 'stocks-75');
    expect(res).toMatchObject({ olderName: 'Avery Sample', ageNow: 82, fiState: 'not-by-max' });
    expect(res.windows.map((w) => w.solveAge)).toEqual([85, 91, 85, 83, 83]);
    const r = renderMarketStress(res);
    const pastMax = r.lines.filter((l) => l.endsWith(' This window runs past age 90 — no retirement reading here.'));
    expect(pastMax).toHaveLength(1);
    expect(pastMax[0].startsWith('The 1970s inflation run (1973–1981):')).toBe(true);
    expect(fiClauses(r.lines)).toEqual(pastMax);
    expect(r.assumes.filter((a) => a === CI_MS_9E)).toHaveLength(1);
    expect(r.assumes).toContain(CI_MS_8B_SEED);
    expect(r).toEqual(render75(withAvery('1944-04-12'))); // the Avery-first twin
  });
});

describe('card parity (R4 review MINOR 2): the Stress Test card\'s future input path agrees with this thread when the inputs coincide', () => {
  // The B3b card will feed computeStressDelays from the Calculators path:
  // useScenarioAssumptions (buildScenarioDefaults → toEngineAssumptions, no
  // scenario-bar edits so values = defaults) + EarliestRetirementCard's rate
  // (pickModerateEntry → realRateView), target (annualExpenses ÷ swr) and
  // household age rule (two persons → the older; else the first). The hook
  // omits todayIso (it reads the UTC day — MINOR 5, chipped), so the inputs
  // coincide on the kernel's local day, passed here explicitly.
  const cardInputs = (ctx: InterviewContext, stockPct: number): StressDelayInput => {
    const { defaults } = buildScenarioDefaults({
      household: ctx.household, settings: ctx.settings, accounts: ctx.accounts,
      snapshots: ctx.snapshots, contributions: ctx.contributions, todayIso: '2026-08-01',
    });
    const engine = toEngineAssumptions(defaults);
    const moderate = pickModerateEntry(ctx.household!.growthScenarios)!;
    const ages = ctx.persons.map((p) => currentAge(p.dateOfBirth, ctx.today));
    const targetFv = engine.swr > 0 ? engine.annualExpenses / engine.swr : 0;
    return {
      pv: engine.portfolio, pmt: engine.annualContribution,
      realRate: realRateView(moderate.rate, engine.inflation).realRate,
      targetFv: targetFv <= 0 || engine.monthlyExpenses <= 0 ? null : targetFv,
      ageNow: ages.length === 0 ? null : ages.length === 2 ? Math.max(...ages) : ages[0],
      stockPct,
    };
  };

  it('the seeded household, every mix: same inputs, same windows (verdicts, tA/tB, delays), same state', () => {
    const ctx = seedCtx();
    for (const o of MIX_OPTIONS) {
      const thread = computeMarketStress(ctx, o.value);
      const inputs = cardInputs(ctx, o.stockPct / 100);
      expect(inputs).toEqual({ pv: thread.pv, pmt: thread.pmt, realRate: thread.realRate, targetFv: thread.targetFv, ageNow: thread.ageNow, stockPct: o.stockPct / 100 });
      const card = computeStressDelays(inputs);
      expect(card.windows, o.value).toEqual(thread.windows);
      expect(card.solverState).toBe(thread.fiState); // 'ok' on the seed — the two vocabularies coincide there
    }
    expect(computeStressDelays(cardInputs(ctx, 0.75)).windows.map((w) => w.delay)).toEqual([17, 21, 12, 9, 7]); // non-vacuous: Appendix A.2
  });

  it('r < 0 with contributions that clear the target (unfloored on both paths): same windows', () => {
    const ctx = seedCtx({
      household: makeHousehold({ ...SEED_HOUSEHOLD, monthlyExpenseBaseline: 2000, growthScenarios: [{ label: 'Moderate', rate: 0.01 }] }),
      persons: [makePerson({ id: 1, name: 'Solo', dateOfBirth: '1986-04-12' })],
      accounts: [makeAccount({ id: 1, type: AccountType.ACCOUNT_BROKERAGE, name: 'Brokerage' })],
      snapshots: [snap(1, 100_000)],
      contributions: [{ id: 1, accountId: 1, date: '2026-06-15', amount: 40_000 } as never],
    });
    const thread = computeMarketStress(ctx, 'stocks-75');
    expect(thread.realRate).toBeLessThan(0);
    expect(computeStressDelays(cardInputs(ctx, 0.75)).windows).toEqual(thread.windows);
  });
});

describe('historical anchors — the real dataset (the nominal-on-real lesson)', () => {
  // ANCHOR A: $100,000 + $12,000/yr at stocks-75, one person aged 40, target
  // $600,000 (= 12 × $2,000 ÷ 4%). Re-derived from replay.test.ts's default-card
  // anchor (trough 1931 $90,195.78; recovery 1932) — the trough IS the span end,
  // so CI-MS-2 (no parenthesised year) applies (review MINOR 13).
  const anchorA = () => seedCtx({
    household: makeHousehold({ ...SEED_HOUSEHOLD, monthlyExpenseBaseline: 2000 }),
    persons: [makePerson({ id: 1, name: 'Solo', dateOfBirth: '1986-04-12' })],
    accounts: [makeAccount({ id: 1, type: AccountType.ACCOUNT_BROKERAGE, name: 'Brokerage' })],
    snapshots: [snap(1, 100_000)],
    contributions: [{ id: 1, accountId: 1, date: '2026-06-15', amount: 12_000 } as never],
  });

  it('ANCHOR A line (CI-MS-1c + CI-MS-2r\' contributions qualifier + CI-MS-3): delay 4', () => {
    const r = render75(anchorA());
    expect(r.lines[0]).toBe("Your $100,000 portfolio and $12,000/yr of contributions — from your latest account snapshots and the last 12 months of contributions — replayed through five historical windows at a 75% stocks / 25% bonds mix, in today's dollars.");
    expect(r.lines[1]).toBe("The 1929 crash (1929–1931): $90,196 at the deepest year-end, −9.8% from today; back at today's value by 1932 with your $12,000/yr contributions counted. FI target about 4 years later than on your assumed path.");
    expect(r.assumes).toContain("FI target $600,000 = 12 × $2,000/mo (from Household) ÷ 4% SWR — two identical whole-year solves from each window's last year, one from the replayed balance and one from your assumed path's balance; the search ends at age 90, counting from today's age.");
    expect(r.assumes).toContain('Contributions: your last 12 months of contributions.');
  });

  it('ANCHOR A seam: legA is flatPathEnd (148,799.43), never projectedFv (148,202.47) nor today\'s pv; solve from 1931', () => {
    const r = computeMarketStress(anchorA(), 'stocks-75');
    const w = r.windows[0];
    expect(w.legStartYear).toBe(1931);
    expect(w.legAStart).toBeCloseTo(148_799.43, 2);
    expect(w.legAStart).toBeCloseTo(flatPathEnd(100_000, r.realRate, 12_000, 3), 6);
    expect(Math.abs(w.legAStart - projectedFv(100_000, 12_000, r.realRate, 3))).toBeGreaterThan(500); // the cadence mutant
    expect(w.legAStart).toBeGreaterThan(100_000); // a solve-from-today mutant starts at pv
    expect(w).toMatchObject({ solveAge: 43, tA: 19, tB: 23, delay: 4, recoveredYear: 1932 });
    // MUTANT NOTE: a leg solved from the window's FIRST year (1929 balances
    // $115,708 / $106,181) yields delay 1 — the 4 above reds it.
  });

  it('ANCHOR B (THE nominal-on-real anchor): $100,000 / $0 at stocks-60 — the 1970s line, and > $6,000 from the nominal-bond figure', () => {
    const ctx = seedCtx({
      household: makeHousehold({ ...SEED_HOUSEHOLD, monthlyExpenseBaseline: 2000 }),
      persons: [makePerson({ id: 1, name: 'Solo', dateOfBirth: '1986-04-12' })],
      accounts: [makeAccount({ id: 1, type: AccountType.ACCOUNT_BROKERAGE, name: 'Brokerage' })],
      snapshots: [snap(1, 100_000)],
    });
    const res = computeMarketStress(ctx, 'stocks-60');
    const w = res.windows[1];
    expect(w.troughBalance).toBeCloseTo(66_517.39, 2); // replay.test.ts P3's 1973–74 figure IS this window's trough
    expect(Math.abs(w.troughBalance - 73_158.09)).toBeGreaterThan(6_000); // the anti-pin
    // $100k / $0 toward $600k at 3.5% real is 52 years — not by 90 from any
    // window's end → every leg A not-by-max → CI-MS-9e, no clauses (ruling 2).
    expect(res.fiState).toBe('not-by-max');
    const r = renderMarketStress(res);
    expect(r.lines[2]).toBe("The 1970s inflation run (1973–1981): $66,517 at the deepest year-end (1974), −33.5% from today, and $66,893 at the end of 1981; back at today's value by 1984.");
    expect(r.assumes).toContain(CI_MS_9E);
    expect(r.assumes.some((a) => a.includes('not reachable'))).toBe(false);
    expect(fiClauses(r.lines)).toEqual([]);
  });
});

describe('solver verdicts, per line and per row (ruling 2 / MAJOR 2 / MAJOR 4)', () => {
  it('ageNow 70: every leg A found, every leg B not-by-max → CI-MS-3d on all five lines; CI-MS-12 present', () => {
    const r = render75(withAvery('1956-04-12'));
    for (const l of r.lines.slice(1)) expect(l.endsWith(' FI target not reached by age 90 on this path.')).toBe(true);
    expect(r.assumes).toContain(CI_MS_12);
    expect(r.assumes.some((a) => a === CI_MS_9E || a === CI_MS_9D)).toBe(false);
  });

  it('ageNow 82: the 1970s window runs past 90 (per-line CI-MS-3g); the other four are not-by-max → ONE CI-MS-9e row, no "not reachable", no CI-MS-9d', () => {
    const res = computeMarketStress(withAvery('1944-04-12'), 'stocks-75');
    expect(res.windows.map((w) => w.solveAge)).toEqual([85, 91, 85, 83, 83]);
    expect(res.fiState).toBe('not-by-max');
    const r = renderMarketStress(res);
    const pastMax = r.lines.filter((l) => l.endsWith(' This window runs past age 90 — no retirement reading here.'));
    expect(pastMax).toHaveLength(1);
    expect(pastMax[0].startsWith('The 1970s inflation run (1973–1981):')).toBe(true);
    expect(fiClauses(r.lines)).toEqual(pastMax);
    expect(r.assumes.filter((a) => a === CI_MS_9E)).toHaveLength(1);
    expect(r.assumes).not.toContain(CI_MS_9D);
    expect(JSON.stringify(r)).not.toContain('not reachable');
    expect(r.assumes).not.toContain(CI_MS_12); // no delay-family clause on any line
  });

  it('the exact cap boundary (R4 review UPHELD 1; ruling 2: past-max iff ageNow + n ≥ 90): the 1970s window at solveAge 89 / 90 / 91 — rendered rows', () => {
    // 80 → 89: in range, not-by-max like the other four → the uniform CI-MS-9e row, no clause on any line.
    // 81 → 90 (=== MAX_SOLVE_AGE): past-max → CI-MS-3g on that line; the four in-range lines stay uniform → one 9e row, no 3e, no 12.
    // 82 → 91: the same shape as 90.
    const LINE_3G = ' This window runs past age 90 — no retirement reading here.';
    const LINE_3E = " FI target not reached by age 90 on your assumed path from this window's end.";
    const rows = [['1946-04-12', 80], ['1945-04-12', 81], ['1944-04-12', 82]].map(([dob, age]) => {
      const res = computeMarketStress(withAvery(dob as string), 'stocks-75');
      expect(res.ageNow).toBe(age);
      const r = renderMarketStress(res);
      return {
        solveAge1970s: res.windows[1].solveAge,
        fiState: res.fiState,
        pastMaxLines: r.lines.filter((l) => l.endsWith(LINE_3G)).map((l) => l.split(' (')[0]),
        clauses: fiClauses(r.lines).length,
        mixed: r.lines.some((l) => l.endsWith(LINE_3E)),
        nineE: r.assumes.filter((a) => a === CI_MS_9E).length,
        twelve: r.assumes.includes(CI_MS_12),
      };
    });
    expect(rows).toEqual([
      { solveAge1970s: MAX_SOLVE_AGE - 1, fiState: 'not-by-max', pastMaxLines: [], clauses: 0, mixed: false, nineE: 1, twelve: false },
      { solveAge1970s: MAX_SOLVE_AGE, fiState: 'not-by-max', pastMaxLines: ['The 1970s inflation run'], clauses: 1, mixed: false, nineE: 1, twelve: false },
      { solveAge1970s: MAX_SOLVE_AGE + 1, fiState: 'not-by-max', pastMaxLines: ['The 1970s inflation run'], clauses: 1, mixed: false, nineE: 1, twelve: false },
    ]);
  });

  it('ageNow 88: three windows past 90 (1929, 1970s, dot-com); 2008/2022 not-by-max → CI-MS-9e; no CI-MS-9d', () => {
    const r = render75(withAvery('1938-04-12'));
    const pastMax = r.lines.filter((l) => l.includes('runs past age 90'));
    expect(pastMax.map((l) => l.split(' (')[0])).toEqual(['The 1929 crash', 'The 1970s inflation run', 'The dot-com crash']);
    expect(r.assumes).toContain(CI_MS_9E);
    expect(r.assumes).not.toContain(CI_MS_9D);
  });

  it('ageNow 89: every window runs past 90 → five CI-MS-3g lines, no CI-MS-9e/9d, CI-MS-8b still present, CI-MS-12 absent', () => {
    const r = render75(withAvery('1937-04-12'));
    expect(r.lines.slice(1).every((l) => l.endsWith(' This window runs past age 90 — no retirement reading here.'))).toBe(true);
    expect(r.assumes).not.toContain(CI_MS_9E);
    expect(r.assumes).not.toContain(CI_MS_9D);
    expect(r.assumes).toContain(CI_MS_8B_SEED);
    expect(r.assumes).not.toContain(CI_MS_12);
  });

  it('ageNow 90 today: CI-MS-9d; no solves, no clauses, no CI-MS-7/8', () => {
    const res = computeMarketStress(withAvery('1936-04-12'), 'stocks-75');
    expect(res.fiState).toBe('past-max-today');
    expect(res.solverRan).toBe(false);
    const r = renderMarketStress(res);
    expect(r.assumes).toContain(CI_MS_9D);
    expect(fiClauses(r.lines)).toEqual([]);
    expect(r.assumes.some((a) => a.startsWith('Your assumed path') || a.startsWith('FI target'))).toBe(false);
  });

  it('ageNow 81 with a $1,500,000 portfolio: the 1970s line carries CI-MS-3g while the other four keep their CI-MS-3d clauses; CI-MS-12 present; no 9e', () => {
    // t* from today = ln(1.8/1.5)/ln(1.03515625) ≈ 5.3 years. 1929 (n 3): leg A
    // $1,663,807 → tA 3 ≤ tMax 6 (found); leg B $949,795 → tB 19 > 6 (not-by-max).
    const ctx = seedCtx({
      persons: [makePerson({ id: 1, name: 'Avery Sample', dateOfBirth: '1945-04-12' })],
      accounts: [makeAccount({ id: 1, type: AccountType.ACCOUNT_BROKERAGE, name: 'Brokerage' })],
      snapshots: [snap(1, 1_500_000)],
    });
    const res = computeMarketStress(ctx, 'stocks-75');
    expect(res.fiState).toBe('ok');
    expect(res.windows.map((w) => w.verdictA)).toEqual(['age-found', 'past-max', 'age-found', 'age-found', 'age-found']);
    const r = renderMarketStress(res);
    expect(r.lines[2].endsWith(' This window runs past age 90 — no retirement reading here.')).toBe(true);
    for (const i of [1, 3, 4, 5]) expect(r.lines[i].endsWith(' FI target not reached by age 90 on this path.')).toBe(true);
    expect(r.assumes).toContain(CI_MS_12);
    expect(r.assumes).not.toContain(CI_MS_9E);
    expect(r.assumes).toContain("FI target $1,800,000 = 12 × $6,000/mo (from Household) ÷ 4% SWR — two identical whole-year solves from each window's last year, one from the replayed balance and one from your assumed path's balance; the search ends at age 90, counting from today's age.");
  });

  it('never-real (r < 0, no contributions): CI-MS-9b reserved for the solver\'s never-real verdict; CI-MS-7/8 still rendered', () => {
    const ctx = seedCtx({ household: makeHousehold({ ...SEED_HOUSEHOLD, growthScenarios: [{ label: 'Moderate', rate: 0.01 }] }) });
    const res = computeMarketStress(ctx, 'stocks-75');
    expect(res.realRate).toBeLessThan(0);
    expect(res.fiState).toBe('never-real');
    const r = renderMarketStress(res);
    expect(r.assumes).toContain("FI target not reachable under the moderate scenario — the retirement side isn't shown.");
    expect(fiClauses(r.lines)).toEqual([]);
    expect(r.assumes.some((a) => a.startsWith('FI target $1,800,000'))).toBe(true);
    // B3 renders negative rates with U+2212 — CI-MS-7's exact string is not pinned in this arm on purpose.
  });

  it('r < 0 but contributions clear the target (MINOR 17): verdicts age-found, clauses render — never "not reachable"', () => {
    const ctx = seedCtx({
      household: makeHousehold({ ...SEED_HOUSEHOLD, monthlyExpenseBaseline: 2000, growthScenarios: [{ label: 'Moderate', rate: 0.01 }] }),
      persons: [makePerson({ id: 1, name: 'Solo', dateOfBirth: '1986-04-12' })],
      accounts: [makeAccount({ id: 1, type: AccountType.ACCOUNT_BROKERAGE, name: 'Brokerage' })],
      snapshots: [snap(1, 100_000)],
      contributions: [{ id: 1, accountId: 1, date: '2026-06-15', amount: 40_000 } as never],
    });
    const res = computeMarketStress(ctx, 'stocks-75');
    expect(res.fiState).toBe('ok');
    expect(res.windows.every((w) => w.verdictA === 'age-found')).toBe(true);
    expect(JSON.stringify(renderMarketStress(res))).not.toContain('not reachable');
  });

  it('no baseline → CI-MS-9, no solves, no CI-MS-7/8/12; no persons → CI-MS-9c', () => {
    const noBaseline = render75(seedCtx({ household: makeHousehold({ ...SEED_HOUSEHOLD, monthlyExpenseBaseline: 0 }) }));
    expect(noBaseline.assumes).toContain('The retirement side needs a monthly expense baseline and withdrawal rate — not shown.');
    expect(fiClauses(noBaseline.lines)).toEqual([]);
    expect(noBaseline.assumes.some((a) => a.startsWith('Your assumed path') || a.startsWith('FI target') || a === CI_MS_12)).toBe(false);
    const noPersons = render75(seedCtx({ persons: [] }));
    expect(noPersons.assumes).toContain("The retirement reading needs a person's date of birth — not shown.");
    expect(fiClauses(noPersons.lines)).toEqual([]);
  });

  it('outpaced (CI-MS-2d): $100,000 + $60,000/yr never dips below today\'s value in 2008', () => {
    const ctx = seedCtx({
      household: makeHousehold({ ...SEED_HOUSEHOLD, monthlyExpenseBaseline: 2000 }),
      persons: [makePerson({ id: 1, name: 'Solo', dateOfBirth: '1986-04-12' })],
      accounts: [makeAccount({ id: 1, type: AccountType.ACCOUNT_BROKERAGE, name: 'Brokerage' })],
      snapshots: [snap(1, 100_000)],
      contributions: [{ id: 1, accountId: 1, date: '2026-06-15', amount: 60_000 } as never],
    });
    const res = computeMarketStress(ctx, 'stocks-75');
    const w = res.windows[3];
    expect(w.outpaced).toBe(true);
    expect(w.troughBalance).toBeGreaterThanOrEqual(100_000);
    const line = renderMarketStress(res).lines[4];
    // Pattern pin: the end figure is derived from the seam in the same test.
    expect(line.startsWith("The 2008 crash (2008): never below today's value at a year-end — contributions outpaced this window's losses; ")).toBe(true);
    expect(line).toContain(`${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Math.round(w.windowEndBalance))} at the end of the window.`);
  });

  it('hand-built numerics: k = 0 → CI-MS-3b; k < 0 → CI-MS-3c; leg B never-real → CI-MS-3f; a mixed leg A → CI-MS-3e with no 9e row', () => {
    const base = computeMarketStress(seedCtx(), 'stocks-75');
    const edit = (patch: Partial<MarketStressResult['windows'][number]>, i = 0): MarketStressResult =>
      ({ ...base, windows: base.windows.map((w, j) => (j === i ? { ...w, ...patch } : w)) });
    expect(renderMarketStress(edit({ tA: 16, tB: 16, delay: 0 })).lines[1].endsWith(' No change to the year your FI target holds.')).toBe(true);
    expect(renderMarketStress(edit({ tA: 16, tB: 14, delay: -2 })).lines[1].endsWith(' FI target about 2 years sooner than on your assumed path.')).toBe(true);
    expect(renderMarketStress(edit({ tA: 16, tB: 15, delay: -1 })).lines[1].endsWith(' FI target about 1 year sooner than on your assumed path.')).toBe(true);
    expect(renderMarketStress(edit({ verdictB: 'never-real', tB: null, delay: null })).lines[1].endsWith(' FI target not reached in real terms on this path.')).toBe(true);
    const mixed = renderMarketStress(edit({ verdictA: 'not-by-max', tA: null, delay: null }));
    expect(mixed.lines[1].endsWith(" FI target not reached by age 90 on your assumed path from this window's end.")).toBe(true);
    expect(mixed.lines[2]).toBe(SEED_LINES_75[1]); // the others keep their delays
    expect(mixed.assumes).not.toContain(CI_MS_9E);
  });
});

describe('house rules', () => {
  const corpus = () => [
    render75(seedCtx()), render75(withAvery('1944-04-12')), render75(withAvery('1938-04-12')),
    render75(withAvery('1936-04-12')), render75(seedCtx({ persons: [] })),
    render75(seedCtx({ household: makeHousehold({ ...SEED_HOUSEHOLD, monthlyExpenseBaseline: 0 }) })),
    renderMarketStress(computeMarketStress(seedCtx(), 'stocks-100')),
    renderMarketStress(computeMarketStress(seedCtx(), 'stocks-40')),
  ].flatMap((r) => [r.title, ...r.lines, ...r.assumes]);

  it('no advice lexeme, no exclamation, no self-description as advice, in any state', () => {
    // ONE word of ONE string is exempt by contract (R4 T8, the COMPARE_FOOTER
    // idiom in advice-lexicon.ts): CI-MS-6's "the worst moments within a year
    // were deeper" is the Stress Test card's own measurement caveat — a factual
    // statement about the data's intra-year lows, not a ranked choice. The rest
    // of CI-MS-6 is still scanned, the word is removed once only, and the
    // lexicon itself is unchanged.
    expect(corpus()).toContain(CI_MS_6);
    for (const s of corpus()) {
      const scanned = s === CI_MS_6 ? s.replace(/\bworst\b/, '') : s;
      expect(scanned, s).not.toMatch(ADVICE_LEXICON);
      expect(s, s).not.toContain('!');
      expect(s, s).not.toMatch(/(?<![\w-])(advice|advis(?:e[sd]?|ing|able)|recommend(?:s|ed|ing|ation|ations)?)\b/i);
    }
  });

  it('"age 90" is MAX_SOLVE_AGE, templated (a constant change moves every string)', () => {
    expect(MAX_SOLVE_AGE).toBe(90);
    const withAge = corpus().filter((s) => /\b90\b/.test(s));
    expect(withAge.length).toBeGreaterThan(0);
    for (const s of withAge) expect(s).toMatch(/age 90|reaches 90|Past age 90/);
  });

  it('INVESTED_ACCOUNT_TYPES / investedBalance (⚑ R4-F16): brokerage + retirement only; cash, savings, HSA, crypto, 529 and excluded accounts never count', () => {
    expect([...INVESTED_ACCOUNT_TYPES].sort()).toEqual([
      AccountType.ACCOUNT_401K, AccountType.ACCOUNT_BROKERAGE, AccountType.ACCOUNT_ROTH_401K,
      AccountType.ACCOUNT_ROTH_IRA, AccountType.ACCOUNT_TRAD_IRA,
    ].sort());
    expect(investedBalance(fixtureCtx())).toBe(0); // savings 22k + checking 8k
    expect(investedBalance(seedCtx())).toBe(905_000); // 285 + 92 + 410 + 118 (k)
    const hsaOnly = fixtureCtx({ accounts: [makeAccount({ id: 3, type: AccountType.ACCOUNT_HSA })], snapshots: [snap(3, 50_000)] });
    expect(investedBalance(hsaOnly)).toBe(0);
    const excluded = fixtureCtx({ accounts: [makeAccount({ id: 3, type: AccountType.ACCOUNT_BROKERAGE, excludedFromNetWorth: true })], snapshots: [snap(3, 50_000)] });
    expect(investedBalance(excluded)).toBe(0);
  });
});

describe('U12 — ageNow is the LOCAL-day age through the utcNoonOf bridge (Pacific/Kiritimati, UTC+14)', () => {
  const ORIGINAL_TZ = process.env.TZ;
  afterEach(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });
  it('on the local birthday Avery is 38 (a currentAgeAsOf(dob, ctx.today) mutant reads 37 — the review\'s evidence)', () => {
    process.env.TZ = 'Pacific/Kiritimati';
    const res = computeMarketStress(seedCtx({ today: new Date(2026, 3, 12) }), 'stocks-75');
    expect(res.ageNow).toBe(38);
  });
});
