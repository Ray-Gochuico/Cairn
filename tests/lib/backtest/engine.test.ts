import { describe, it, expect } from 'vitest';
import { backtestPlan, backtestPlanWithFlatReturn } from '@/lib/backtest/engine';
import { projectScenario, emptyLeverPayload, type RealState, type LeverPayload } from '@/lib/scenarios';
import type { BacktestConfig } from '@/lib/backtest/types';

// Minimal single-investment-account RealState seed. The backtest overrides
// returns/inflation/expenses per year, so most of RealState can be inert.
function seed(initialPortfolio: number): RealState {
  return {
    accounts: [{ id: 1, householdId: 1, name: 'Brokerage', type: 'BROKERAGE',
      ownerPersonId: null, excludedFromNetWorth: false } as never],
    holdings: [],
    loans: [],
    loanPayments: [],
    household: { id: 1, filingStatus: 'SINGLE' } as never,
    persons: [{ id: 1, dateOfBirth: '1960-01-01', annualSalaryPretax: 0,
      targetRetirementAge: 0 } as never],
    accountsByBucket: { taxAdvantaged: [], brokerage: [], cash: [] },
    initialCash: 0,
    initialInvestmentsByAccount: { 1: initialPortfolio },
    cashAccountsWithBalances: [],
    defaults: { inflation: 0, returnRate: 0, defaultCashApy: null, defaultDrawdownTaxRate: null },
    startISO: '1871-01',
    taxBrackets: { federal: [], state: [], city: null, ltcg: [],
      standardDeduction: { federal: 0, state: 0, city: 0 } },
    housingPayments: [],
    vehicleLeases: [],
  };
}

// BT-3 — the PRODUCTION-PATH seed: a real working-age user with a real salary,
// a real DOB, and a cash account with a nominal APY. This is what useRealState()
// actually hands backtestPlan(). The seven idealized tests above pre-zero salary
// — which is exactly why BT-1/BT-2 hid behind green tests. These deliberately
// do NOT pre-zero, so they exercise the real wiring `runBacktest` must neutralize.
function prodSeed(initialPortfolio: number): RealState {
  return {
    accounts: [
      { id: 1, householdId: 1, name: 'Brokerage', type: 'BROKERAGE', ownerPersonId: null, excludedFromNetWorth: false } as never,
      { id: 2, householdId: 1, name: 'HYSA', type: 'SAVINGS', ownerPersonId: null, excludedFromNetWorth: false } as never,
    ],
    holdings: [],
    loans: [],
    loanPayments: [],
    household: { id: 1, filingStatus: 'SINGLE' } as never,
    // Age ~40 in 2026, salary $150k, retire at 65 — a typical pre-retirement user.
    persons: [{ id: 1, dateOfBirth: '1986-01-01', annualSalaryPretax: 150_000,
      targetRetirementAge: 65 } as never],
    accountsByBucket: { taxAdvantaged: [], brokerage: [], cash: [] },
    initialCash: 50_000,
    initialInvestmentsByAccount: { 1: initialPortfolio },
    // A real 4.5% HYSA — would over-credit cash in a real-dollar replay if cashRate isn't 0 (BT-2).
    cashAccountsWithBalances: [{ account: { id: 2, type: 'SAVINGS', apyRate: 0.045 } as never, balance: 50_000 }],
    defaults: { inflation: 0, returnRate: 0, defaultCashApy: 0.045, defaultDrawdownTaxRate: null },
    startISO: '1871-01',
    taxBrackets: { federal: [], state: [], city: null, ltcg: [],
      standardDeduction: { federal: 0, state: 0, city: 0 } },
    housingPayments: [],
    vehicleLeases: [],
  };
}

const cfg = (over: Partial<BacktestConfig> = {}): BacktestConfig => ({
  initialPortfolio: 1_500_000,
  annualSpending: 60_000,
  horizonYears: 30,
  goalAmount: 0,
  strategy: 'constant-dollar',
  stockPct: 0.75,
  variableRate: 0.04,
  minWithdrawal: 48_000,
  maxWithdrawal: 90_000,
  ...over,
});

describe('backtestPlan', () => {
  it('runs one outcome per available start year for the horizon', () => {
    const r = backtestPlan(seed(1_500_000), cfg());
    // 1871..(LATEST-29); at least ~120 starts for a ~155-year dataset.
    expect(r.outcomes.length).toBeGreaterThan(100);
    expect(r.startYears.first).toBe(1871);
    expect(r.outcomes[0].annualBalances).toHaveLength(31); // horizon+1
    expect(r.outcomes[0].annualBalances[0]).toBe(1_500_000);
  });

  // MF-2 anchor: EXACT year-end math, not a tolerance band. A full calendar
  // year of 7% real return on $100k with ZERO spending must end at exactly
  // $107,000.00 — this proves the per-year segment applies 12 full step-months
  // (not 11), pinning the off-by-one that a loose success-rate tolerance hides.
  it('applies a FULL 12-month year (flat 7%, no spend → exactly $107,000)', () => {
    const flat = backtestPlanWithFlatReturn(seed(100_000), {
      ...cfg({ initialPortfolio: 100_000, annualSpending: 0, horizonYears: 1, strategy: 'constant-dollar' }),
    }, 0.07);
    // annualBalances[1] is the end of the single year.
    expect(flat.outcomes[0].annualBalances[1]).toBeCloseTo(107_000, 2);
  });

  it('matches the canonical Trinity 4%/30y success rate within a tight band', () => {
    // 4% constant-dollar, 75/25, 30y historically succeeds ~95% (Trinity).
    // With the off-by-one fixed (MF-2), this should land near the literature,
    // so we use a TIGHT band [0.90, 1.0] rather than the prior loose >0.85
    // that masked a ~30-missing-month skew. If it lands below 0.90, suspect
    // the Shiller transcription (Task 2) before loosening the band.
    const r = backtestPlan(seed(1_500_000), cfg({ stockPct: 0.75, annualSpending: 60_000 }));
    const successRate = r.survivedCount / r.outcomes.length;
    expect(successRate).toBeGreaterThanOrEqual(0.90);
    expect(successRate).toBeLessThanOrEqual(1.0);
  });

  it('ranks the 1966 cohort worse than the 1929 cohort', () => {
    const r = backtestPlan(seed(1_500_000), cfg());
    const y1966 = r.outcomes.find((o) => o.startYear === 1966)!;
    const y1929 = r.outcomes.find((o) => o.startYear === 1929)!;
    expect(y1966.endingBalance).toBeLessThan(y1929.endingBalance);
  });

  it('goal 0 makes goalMetCount equal survivedCount', () => {
    const r = backtestPlan(seed(1_500_000), cfg({ goalAmount: 0 }));
    expect(r.goalMetCount).toBe(r.survivedCount);
  });

  it('raising the goal lowers goalMetCount but not survivedCount', () => {
    const lo = backtestPlan(seed(1_500_000), cfg({ goalAmount: 0 }));
    const hi = backtestPlan(seed(1_500_000), cfg({ goalAmount: 1_000_000 }));
    expect(hi.goalMetCount).toBeLessThanOrEqual(lo.goalMetCount);
    expect(hi.survivedCount).toBe(lo.survivedCount);
  });

  it('variable strategy produces full-length paths without throwing', () => {
    const r = backtestPlan(seed(1_500_000), cfg({ strategy: 'variable' }));
    expect(r.outcomes.every((o) => o.annualBalances.length === 31)).toBe(true);
  });
});

// ── BT-1 / BT-2 regression: drive the NON-idealized production seed ─────────
// The seven cases above all use seed(), which pre-zeros salary and carries no
// cash account — which is exactly why the production-path bugs hid behind green
// tests. These two drive prodSeed() (a real working-age user: $150k salary, DOB
// 1986, retire-65, 4.5% HYSA) — what useRealState() actually hands backtestPlan()
// — and would FAIL if runBacktest's neutralization (BT-1) or the payload's
// cashRate:0 (BT-2) regressed. They are the non-idealized tests the seed()
// fixtures structurally cannot provide.
describe('backtestPlan — production-seed neutralization (BT-1/BT-2)', () => {
  it('BT-1: strips a real salary + DOB so the replay is a genuine drawdown, not a rubber-stamp ~100%', () => {
    const params = cfg({ stockPct: 0.75, annualSpending: 60_000 });
    const prod = backtestPlan(prodSeed(1_500_000), params);
    const ideal = backtestPlan(seed(1_500_000), params);

    // (a) The portfolio actually DRAWS DOWN: the worst historical sequence ends
    //     BELOW where it started. WITHOUT neutralizeSeed the engine's retirement
    //     gate (`ageAtMonth(dob, 1871-…) ≥ 65` is false for a 1986 DOB — often a
    //     NEGATIVE age in pre-birth years, engine.ts:499-503) never trips, so the
    //     full $150k salary is injected, taxed at 2026 brackets on "1871 income",
    //     and the surplus routed INTO the portfolio (applyGapAllocation) → EVERY
    //     sequence GROWS → worst.value ≫ initialPortfolio and success is a
    //     meaningless ~100%. This assertion fails loudly if BT-1 regresses.
    //     (We assert the drawdown via the ending balance rather than the survival
    //     rate because a legitimate 4%/30y replay can itself survive ~100% of the
    //     time — see the Trinity-band case above — so "success < 100%" is not a
    //     robust discriminator, but "worst sequence loses money" is.)
    expect(prod.endings.worst.value).toBeLessThan(params.initialPortfolio);

    // (b) Once neutralized, prodSeed feeds the engine BYTE-IDENTICAL inputs to the
    //     idealized seed: salary 0 ⇒ income 0 (DOB/retire-age moot); S1 parks the
    //     whole portfolio in one synthetic account with zero cash; cashRate 0 makes
    //     the 4.5% HYSA inert; and the default PROPORTIONAL withdrawal ignores
    //     real.accounts, so prodSeed's extra HYSA account is inert too. Same in ⇒
    //     same out — the realistic seed is indistinguishable from the textbook one.
    expect(prod.survivedCount).toBe(ideal.survivedCount);
    expect(prod.goalMetCount).toBe(ideal.goalMetCount);
    expect(prod.endings.worst.value).toBe(ideal.endings.worst.value);
    expect(prod.endings.best.value).toBe(ideal.endings.best.value);

    // (c) S1 (BT-8) — config.initialPortfolio is the AUTHORITATIVE starting
    //     balance end-to-end, even though prodSeed carries TWO accounts + a
    //     $50k cash bucket. neutralizeSeed parks the whole portfolio in one
    //     synthetic account with initialCash:0, so every path's first
    //     annualBalances entry equals config.initialPortfolio exactly (not
    //     initialPortfolio + the seed's stray cash). This is the assertion the
    //     page relies on so an edited starting portfolio matches the simulated
    //     curve's origin.
    expect(prod.outcomes.every((o) => o.annualBalances[0] === params.initialPortfolio)).toBe(true);
  });

  it('BT-2: the per-year payload pins cashRate:0 — a nominal HYSA APY never grows cash in a real-dollar replay', () => {
    // neutralizeSeed (S1) zeros initialCash, so the FULL backtest path can never
    // surface a non-zero cash bucket — a cash assertion routed through
    // backtestPlan(prodSeed(…)) would pass vacuously (0 → 0) even if cashRate
    // regressed. So this guard drives projectScenario with the SAME per-year
    // payload runBacktest builds (cashRate:0, inflation 0, flat 0% return, no
    // withdrawal) against a yearReal that DOES carry a real $100k cash bucket on
    // prodSeed's 4.5% HYSA. In a REAL-dollar replay cash must stay FLAT; crediting
    // the seed's nominal 4.5% would over-state real wealth by ~CPI/yr (the
    // Coast-FI nominal-on-real bug class). If a future change ever carries the
    // user's real cash into the replay, THIS is the assertion that keeps it honest.
    const base = emptyLeverPayload();
    const payload: LeverPayload = {
      ...base,
      returns: { ...base.returns, defaultRate: 0, overrides: { '1990': 0 }, cashRate: 0 },
      inflation: { defaultRate: 0, overrides: {} },
      expensePeriods: [], // no withdrawal → isolate cash growth
    };
    const yearReal: RealState = {
      ...prodSeed(0),                  // brings the 4.5% HYSA + defaultCashApy 0.045
      // Mirror neutralizeSeed: zero salary so the engine's retirement gate is
      // moot. prodSeed carries a $150k salary + a 1986 DOB; driving
      // projectScenario directly (this test bypasses neutralizeSeed) would
      // otherwise inject + tax that salary on "1990 income" and route the
      // surplus into the bucket → cash reds at ~$238,525 for a reason
      // unrelated to cashRate. Zeroing salary isolates the cashRate:0 assertion.
      persons: prodSeed(0).persons.map((p) => ({ ...p, annualSalaryPretax: 0 })),
      startISO: '1989-12',
      initialInvestmentsByAccount: {}, // isolate the cash bucket
      initialCash: 100_000,
    };
    // months: 13 → states[12] = Dec 1990 (12 full step-months over calYear 1990).
    const states = projectScenario(yearReal, payload, { startISO: '1989-12', months: 13 });
    // Flat: $100k stays $100k. Drop `cashRate: 0` (reverting to emptyLeverPayload's
    // null default) and effectiveCashApy falls through to the 4.5% HYSA →
    // states[12].cash compounds to exactly $104,500 (100k × 1.045) → this fails.
    expect(states[12].cash).toBe(100_000);
  });
});
