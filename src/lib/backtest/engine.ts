import { projectScenario, totalInvestments, emptyLeverPayload, type RealState, type LeverPayload } from '@/lib/scenarios';
import type { BacktestConfig, BacktestResult, StartYearOutcome } from './types';
import { blendedRealReturn, availableStartYears } from './data';
import { withdrawalForYear } from './strategies';
import { aggregate, classifyTier } from './aggregate';

/**
 * Run a historical backtest of `config` against `seed` (the user's plan state
 * captured via captureRealState/useRealState).
 *
 * Reuses projectScenario WITHOUT modifying it: for each historical start year
 * we step ONE calendar year at a time, because the variable-with-guardrails
 * withdrawal depends on the prior year's resolved balance and so cannot be
 * precomputed into a single payload.
 *
 * ── Month-count + calendar anchoring (MF-2 fix) ──────────────────────────────
 * projectScenario pushes a no-op month-0 state at `startISO`, then loops
 * `i=1..months-1` calling stepMonth (engine.ts:202-214). So `months: N`
 * produces N states but only N-1 STEPPED months. To apply a FULL 12 step-months
 * per year we pass `months: 13` and read `states[12]`.
 *
 * We also anchor each year-segment at the PRIOR December (`${calYear-1}-12`) so
 * that the 12 stepped months (i=1..12) land on Jan..Dec of `calYear` exactly —
 * the engine keys its return override by the step month's calendar year
 * (engine.ts:679-680), so anchoring at January would push the 12th step into
 * `calYear+1` and apply the wrong year's return. Anchoring at prior-December
 * keeps all 12 steps inside `calYear`; the month-0 December seed is a no-op.
 *
 * ── Withdrawal cadence convention (SF-8 — documented, intentional) ───────────
 * The engine deducts expenses MONTHLY (engine.ts:562,588), so the annual
 * withdrawal is drawn as 12 equal monthly slices, NOT a single start-of-year
 * lump. This is deliberately MORE realistic than textbook start-of-year Bengen
 * (a retiree spends monthly), and it leaves slightly more invested through each
 * year — historically ~1–2 percentage points above the canonical lump-sum
 * Trinity figure. This is a modeling choice, NOT a data bug: do not "fix" it to
 * a Jan-1 lump. The flat-7% anchor test pins the per-step arithmetic; the
 * Trinity band test allows for this known cadence offset.
 *
 * Each year drives the engine's per-year hooks (returns.overrides at
 * engine.ts:680; expensePeriods at :562) with the historical blended REAL
 * return and the strategy-computed withdrawal. The engine runs in REAL dollars
 * (inflation override = 0), so the chart + tiers are already inflation-adjusted
 * with no double-deflation.
 */
export function backtestPlan(seed: RealState, config: BacktestConfig): BacktestResult {
  return runBacktest(seed, config, (calYear) => blendedRealReturn(calYear, config.stockPct));
}

/**
 * Test-only entry point: runs the identical loop with a CONSTANT real return,
 * so the flat-7%-year-end anchor test (MF-2) pins the engine arithmetic
 * independent of the transcribed Shiller data. Not used in production.
 */
export function backtestPlanWithFlatReturn(
  seed: RealState,
  config: BacktestConfig,
  flatRealReturn: number,
): BacktestResult {
  return runBacktest(seed, config, () => flatRealReturn);
}

// Synthetic account id the backtest parks the whole portfolio in (S1). Using a
// single id makes `config.initialPortfolio` the authoritative starting balance
// end-to-end, regardless of how many real accounts the seed had.
const BACKTEST_ACCOUNT_ID = 1;

/**
 * BT-1 / BT-2 / S1 — NEUTRALIZE the production seed for a real-dollar drawdown.
 *
 * A backtest models a PURE portfolio drawdown with NO active income — the
 * Trinity/Bengen premise. But `useRealState()` (the production caller) hands us
 * the user's REAL persons with their REAL `annualSalaryPretax` + `dateOfBirth`,
 * and the engine's retirement gate is `if (ageAtMonth(dob, monthISO) >= retireAt) return`
 * (engine.ts retirement gate). The backtest steps at HISTORICAL years
 * (1871–2022, the Shiller data range), so `ageAtMonth(realDOB, 1929-…)` is far
 * below retirement age —
 * often NEGATIVE for pre-birth years (ageAtMonth subtracts years). The gate is
 * therefore FALSE every year → the engine injects the user's full salary, taxes
 * it at 2026 brackets on "1929 income", and routes the surplus INTO the
 * portfolio → it GROWS instead of drawing down → success ≈ 100% regardless of
 * withdrawal rate. This corrupts the headline metric for the most common
 * visitor (someone not yet retired asking "what if I retired into 1966?").
 *
 * `retirementAgeOverride: 0` does NOT fix it — the schema range is
 * .min(30).max(90) so it can't be 0, and even at the minimum a pre-birth
 * NEGATIVE age is still `< 30`. The ONLY robust fix is to ZERO
 * `annualSalaryPretax` on every person (income becomes 0 ⇒ the gate's outcome is
 * irrelevant). We do it HERE, at the seed boundary inside runBacktest, so the
 * contract holds for ANY caller — not in the page (a future caller could
 * forget). The seven engine tests pass today only because their fixtures
 * pre-zero salary; the production wiring did not — fixed now.
 *
 * Also: BT-2 cashRate is neutralized in the per-year payload (cashRate: 0); and
 * S1 makes config.initialPortfolio the authoritative base (single synthetic
 * account, zero cash) so a user-edited portfolio matches the simulated balance.
 */
function neutralizeSeed(seed: RealState, config: BacktestConfig): RealState {
  return {
    ...seed,
    // BT-1: strip active income so the replay is a pure drawdown.
    persons: seed.persons.map((p) => ({ ...p, annualSalaryPretax: 0 })),
    // S1: config.initialPortfolio is authoritative end-to-end. Park it all in
    // one synthetic invested account with zero cash, so annualBalances[0]
    // (= config.initialPortfolio) equals the engine's actual starting balance.
    initialInvestmentsByAccount: { [BACKTEST_ACCOUNT_ID]: config.initialPortfolio },
    initialCash: 0,
    // Wave-9 M66: the replay is a PURE drawdown of config.initialPortfolio —
    // the seed's real debts/housing/leases belong to present-day cash flow,
    // not the historical replay, and were draining the (debt-excluding)
    // tracked portfolio (probe: success 121/123 → 76/123).
    loans: [],
    loanPayments: [],
    housingPayments: [],
    vehicleLeases: [],
  };
}

function runBacktest(
  seed: RealState,
  config: BacktestConfig,
  returnForYear: (calYear: number) => number,
): BacktestResult {
  const drawdownSeed = neutralizeSeed(seed, config);
  const starts = availableStartYears(config.horizonYears);
  const accountIds = Object.keys(drawdownSeed.initialInvestmentsByAccount).map(Number);

  const outcomes: StartYearOutcome[] = starts.map((startYear) => {
    // Per-path mutable carry: per-account balances + cash (from the neutralized seed).
    let investmentsByAccount: Record<number, number> = { ...drawdownSeed.initialInvestmentsByAccount };
    let cash = drawdownSeed.initialCash;
    const annualBalances: number[] = [config.initialPortfolio];
    let depletedYear: number | null = null;
    let priorYearEnd = config.initialPortfolio;

    for (let k = 0; k < config.horizonYears; k++) {
      const calYear = startYear + k;
      const withdrawal = withdrawalForYear(config, k, priorYearEnd);
      const realReturn = returnForYear(calYear);

      // Anchor at prior December so the 12 stepped months land on Jan..Dec of
      // calYear; override keyed by calYear; 12 monthly withdrawal slices.
      const anchorISO = `${calYear - 1}-12`;
      // B5 — PIN the exact schema-valid LeverPayload (do not defer to a tsc
      // guess). Start from emptyLeverPayload() — which already returns every
      // field LeverPayloadSchema requires — then override exactly the three the
      // backtest drives. Typed as LeverPayload so tsc validates the literal at
      // the call site, not at runtime.
      const base = emptyLeverPayload();
      const payload: LeverPayload = {
        ...base,
        // Withdrawal as 12 equal monthly slices of `withdrawal` (real $).
        // ExpensePeriod = { start: ISO-date, monthlyDelta, durationMonths>0 }.
        expensePeriods: [
          { start: `${calYear}-01-01`, monthlyDelta: withdrawal / 12, durationMonths: 12 },
        ],
        // Historical blended REAL return for calYear (ReturnScheduleSchema:
        // defaultRate in [-1,1], overrides keyed by 4-digit-year string,
        // compoundingFrequency MONTHLY from base).
        returns: {
          ...base.returns,
          defaultRate: realReturn,
          overrides: { [String(calYear)]: realReturn },
          // BT-2: real-dollar engine ⇒ NO nominal cash yield. Leaving cashRate
          // null makes effectiveCashApy fall through to the user's REAL HYSA
          // rate (e.g. 4.5%) and credit it to the cash bucket inside a real
          // replay — the Coast-FI nominal-on-real bug class. cashRate: 0 wins
          // outright (effective-cash-apy step-1 override).
          cashRate: 0,
        },
        // Real-dollar engine: zero inflation so CPI isn't re-applied
        // (InflationScheduleSchema: defaultRate in [-0.05,0.20] | null, overrides {}).
        inflation: { defaultRate: 0, overrides: {} },
      };

      const yearReal: RealState = {
        ...drawdownSeed,   // BT-1: income-zeroed persons carried into every year
        startISO: anchorISO,
        initialInvestmentsByAccount: { ...investmentsByAccount },
        initialCash: cash,
      };

      // months: 13 → 12 full step-months (i=1..12); read states[12] = Dec calYear.
      const states = projectScenario(yearReal, payload, { startISO: anchorISO, months: 13 });
      const yearEnd = states[12];
      investmentsByAccount = { ...yearEnd.investmentsByAccount };
      cash = yearEnd.cash;

      // Real portfolio value = investments + cash (home equity unused here).
      let balance = totalInvestments(yearEnd) + yearEnd.cash;
      if (balance <= 0) {
        balance = 0;
        if (depletedYear === null) depletedYear = k + 1;
        // Zero everything so subsequent years stay depleted.
        for (const id of accountIds) investmentsByAccount[id] = 0;
        cash = 0;
      }
      annualBalances.push(Math.round(balance));
      priorYearEnd = balance;
    }

    const endingBalance = annualBalances[annualBalances.length - 1];
    return {
      startYear,
      annualBalances,
      endingBalance,
      tier: classifyTier(endingBalance, config.goalAmount),
      depletedYear,
    };
  });

  return aggregate(outcomes, config.goalAmount);
}
