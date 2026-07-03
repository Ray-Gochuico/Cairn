import type { LeverPayload } from './lever-types';
import type { RealState } from './state-snapshot';
import {
  activeContributionAmount,
  applyAnnualReturnWithFrequency,
  applyGapAllocation,
  applyLumpSum,
  applyExtraLoanPayment,
  computeMonthlyIncomeForPerson,
  monthlyExpenseFromPeriods,
  monthlyReturnFromAnnualWithFrequency,
  type LoanMonthlyContext,
} from './apply-real';
import { CompoundingFrequency } from '@/types/enums';
import { totalInvestments } from './aggregate-investments';
import { computeTotalTax } from '@/lib/tax';
import { ageAtMonth } from '@/lib/dates';
import { effectiveCashApy } from './effective-cash-apy';
import { monthlyRecurringObligation } from '@/lib/recurring-obligations';
import {
  effectiveAnnualInflationFromSlice,
  type InflationSlice,
} from './effective-inflation';
import {
  sequencingBucketForAccount,
  type SequencingBucket,
} from '@/lib/account-tax-classification';
import type { Account } from '@/types/schema';

export interface MonthlyState {
  monthISO: string;
  /**
   * Per-account investment balances. Key = Account.id, value = current balance.
   * Cash/savings accounts are NOT included (they flow into `cash`).
   * Aggregation to tax-bucket totals or a single scalar happens at render
   * time via `totalInvestments(state)` / `aggregateByTaxBucket(state, accounts)`.
   */
  investmentsByAccount: Record<number, number>;
  homeEquity: number;
  cash: number;
  debtByLoan: Record<number, number>;
  netWorth: number;
  incomeAfterTax: number;
  expenses: number;
  savings: number;
  events: string[];

  // ---------------------------------------------------------------------------
  // Optional flow decomposition fields (Task #25).
  //
  // Pure observability — do NOT participate in any engine math. Populated by
  // stepMonth and consumed by the projection chart's hover tooltip (and the
  // ContributionsPopover auto-invest preview card). All values are in nominal
  // dollars, scoped to THIS step only (not cumulative). Optional so tests /
  // fixtures that construct MonthlyState literals continue to compile —
  // missing fields default to 0 at consumption time.
  // ---------------------------------------------------------------------------
  /** Gain credited to investments this step from `applyAnnualReturn`. */
  compoundReturnAdded?: number;
  /**
   * Amount of `s.savings` routed into TAX-ADVANTAGED accounts this step via
   * the gapAllocation lever (when no segment fully absorbed the surplus).
   * Zero in every other case. The three `gapTo*` fields sum to the post-
   * segment positive surplus that flowed through `applyGapAllocation`.
   */
  gapToTaxAdvantaged?: number;
  /** Amount routed into BROKERAGE / taxable accounts this step via gapAllocation. Zero otherwise. */
  gapToBrokerage?: number;
  /**
   * Amount that flowed to CASH via gapAllocation this step (whether routed
   * explicitly by the user's allocation or as the default "remainder to cash"
   * overflow). Note: this is the gap-flow path only; cash that lands here
   * from the "active segment + positive remainder" branch in `stepMonth` is
   * NOT counted (that's segment leftover, not gap allocation).
   */
  gapToCash?: number;
  /**
   * `segment.monthlyAmount` distributed to investments this step when a
   * contribution segment was active. Zero when no segment covers this month.
   */
  leverContributionsInvested?: number;
  /** Sum of lump-sum events firing this step with `destination === 'investments'`. */
  lumpSumInvested?: number;
  /**
   * Investments drawn down by `applyCashFloorShortfall` this step (positive
   * number; the actual investment balance change is negative). Triggered when
   * cash + this step's surplus can't cover expenses + loan payments.
   */
  withdrawnFromInvestments?: number;
  /**
   * Implied tax accrued from grossing up a sequential Trad-bucket withdrawal
   * this step. Zero unless (a) sequential strategy AND (b) the household
   * actually drained the taxDeferred tier this step AND (c)
   * payload.effectiveDrawdownTaxRate > 0. Observability-only — does not
   * affect any other engine math (the gross-up has already reduced the
   * Trad balance for us).
   */
  withdrawalTaxAccrued?: number;
}

export interface Horizon {
  startISO: string;   // 'YYYY-MM'
  months: number;     // 60..480
}

// V1 ASSUMPTION: brackets are loaded once from tax_rules at projection start
// (RealState.taxBrackets) and apply unchanged across the entire 5-40y horizon.
// Year-over-year bracket inflation indexing is not modeled in v1.
//
// Investment income (LTCG / qualified divs / non-qualified divs) is sourced
// from the LeverPayload's annual* fields (introduced 2026-05-27 R2 wiring
// sweep). Zero-defaults preserve legacy projection sentinels for scenarios
// that don't model investment income.
//
// FICA (Wave 2 §6): the per-person wage split is threaded through so Social
// Security caps at EACH earner's own wage base — the old combined-gross path
// applied one base across the household, hiding ~$7.2k/yr of FICA for a
// dual-$150k couple as phantom after-tax income.
function annualHouseholdTax(
  real: RealState,
  annualHouseholdGross: number,
  payload: LeverPayload,
  perPersonAnnualGross: number[],
): number {
  return computeTotalTax({
    gross: annualHouseholdGross,
    // Wave 2 §6: per-person wage split so Social Security caps at each
    // earner's own wage base instead of one base across the household.
    perPersonGross: perPersonAnnualGross,
    filingStatus: real.household.filingStatus,
    federalBrackets: real.taxBrackets.federal,
    stateBrackets: real.taxBrackets.state,
    cityBrackets: real.taxBrackets.city,
    standardDeduction: real.taxBrackets.standardDeduction,
    pretax: { pretax401k: 0, pretaxHealth: 0, pretaxDcfsa: 0, pretaxHsa: 0 },
    longTermGains: payload.annualLongTermGains ?? 0,
    qualifiedDividends: payload.annualQualifiedDividends ?? 0,
    nonQualifiedDividends: payload.annualNonQualifiedDividends ?? 0,
    ltcgBrackets: real.taxBrackets.ltcg,
  }).total;
}

export function projectScenario(
  real: RealState,
  payload: LeverPayload,
  horizon: Horizon,
): MonthlyState[] {
  const out: MonthlyState[] = [];
  const startYear = Number(horizon.startISO.slice(0, 4));

  // Freeze the effective cash APY at projection start. The resolver checks
  // payload.returns.cashRate first (scenario override), then falls through to
  // the balance-weighted average across real.cashAccountsWithBalances. We
  // construct a minimal Scenario shim so effectiveCashApy() can read the
  // payload's cashRate via its scenario parameter.
  const scenarioShim = {
    leverPayload: payload,
  } as Parameters<typeof effectiveCashApy>[0];
  const settingsShim = real.defaults?.defaultCashApy != null
    ? ({ defaultCashApy: real.defaults.defaultCashApy } as Parameters<typeof effectiveCashApy>[2])
    : null;
  const effectiveCashApy_frozen = effectiveCashApy(
    scenarioShim,
    real.cashAccountsWithBalances ?? [],
    settingsShim,
  );
  // Task #16: cash APY uses the SAME compounding frequency as investment
  // returns (per-scenario; defaults to MONTHLY which preserves the legacy
  // (1+APY)^(1/12)-1 formula bit-for-bit). For coarser frequencies the
  // periodic rate is decomposed into 12 equal monthly factors via
  // monthlyReturnFromAnnualWithFrequency — total annual yield is preserved.
  const compoundingFrequency: CompoundingFrequency =
    payload.returns.compoundingFrequency ?? CompoundingFrequency.MONTHLY;
  const cashMonthlyRate = effectiveCashApy_frozen > 0
    ? monthlyReturnFromAnnualWithFrequency(effectiveCashApy_frozen, compoundingFrequency)
    : 0;

  // Capture the inflation slice frozen at projection start. The per-year
  // override LOOKUP happens per-step (effectiveAnnualInflationFromSlice) but
  // the precedence-chain sources are resolved once here.
  //
  // Engine note: the engine's authoritative "household / settings inflation"
  // has always been `real.defaults.inflation` (sourced via captureRealState
  // from appSettings.defaultInflation). The Household.inflationAssumption
  // field has not historically been threaded into the engine — only the
  // resolver's UI-facing precedence chain consults it. To preserve existing
  // engine behavior we leave householdInflation null here and let
  // settingsInflation carry the canonical pre-Task-15 value.
  const inflationSlice: InflationSlice = {
    scenarioDefault: payload.inflation?.defaultRate ?? null,
    scenarioOverrides: payload.inflation?.overrides ?? {},
    householdInflation: null,
    settingsInflation: real.defaults?.inflation ?? null,
  };

  let state: MonthlyState = {
    monthISO: horizon.startISO,
    investmentsByAccount: { ...real.initialInvestmentsByAccount },
    homeEquity: 0,
    cash: real.initialCash,
    debtByLoan: Object.fromEntries(real.loans.map((l) => [l.id!, l.currentBalance])),
    netWorth: 0,
    incomeAfterTax: 0,
    expenses: 0,
    savings: 0,
    events: [],
  };
  state.netWorth = computeNetWorth(state);
  out.push(state);

  for (let i = 1; i < horizon.months; i++) {
    state = stepMonth(
      state,
      real,
      payload,
      startYear,
      i,
      cashMonthlyRate,
      inflationSlice,
      compoundingFrequency,
    );
    out.push(state);
  }
  return out;
}

/**
 * Resolve the per-account contribution allocation for a given month.
 * Priority: segment.allocation (explicit override) → historical mix (v2) → even split.
 * v1: historical-mix derivation is not yet implemented; falls back directly to even split.
 *
 * Stale account IDs in segment.allocation (those not present in
 * investmentsByAccount) are filtered out and the remaining proportions are
 * re-normalized to sum to 1. If the override map has zero valid IDs, we fall
 * through to the even-split fallback.
 */
function resolveAllocation(
  payload: LeverPayload,
  monthIndex: number,
  investmentsByAccount: Record<number, number>,
): Record<number, number> {
  const segment = payload.contributions.find(
    (seg) =>
      monthIndex >= seg.startMonth &&
      (seg.endMonth === null || monthIndex <= seg.endMonth),
  );

  if (segment?.allocation) {
    const validIds = new Set(Object.keys(investmentsByAccount).map(Number));
    const filtered: Record<number, number> = {};
    for (const [idStr, proportion] of Object.entries(segment.allocation)) {
      const id = Number(idStr);
      if (validIds.has(id)) {
        filtered[id] = proportion;
      }
    }
    const total = Object.values(filtered).reduce((s, p) => s + p, 0);
    if (total > 0) {
      return Object.fromEntries(
        Object.entries(filtered).map(([k, v]) => [Number(k), v / total]),
      );
    }
  }

  // Even split across all investment accounts currently tracked.
  const ids = Object.keys(investmentsByAccount).map(Number);
  if (ids.length === 0) return {};
  const share = 1 / ids.length;
  return Object.fromEntries(ids.map((id) => [id, share]));
}

function distributeToAccounts(
  investmentsByAccount: Record<number, number>,
  amount: number,
  allocation: Record<number, number>,
): Record<number, number> {
  const result = { ...investmentsByAccount };
  for (const [idStr, proportion] of Object.entries(allocation)) {
    const id = Number(idStr);
    result[id] = (result[id] ?? 0) + amount * proportion;
  }
  return result;
}

/**
 * Withdraw `deficit` (positive) proportionally across all accounts.
 * If the total is non-positive, deduct an equal share from each account
 * (or no-op if there are no accounts at all). Accounts may go negative
 * if the deficit exceeds the total — we don't clamp, since that would
 * silently hide an insolvent projection from the user.
 */
function withdrawProportionally(
  investmentsByAccount: Record<number, number>,
  deficit: number,
): Record<number, number> {
  const ids = Object.keys(investmentsByAccount).map(Number);
  if (ids.length === 0) return investmentsByAccount;

  const total = ids.reduce((sum, id) => sum + (investmentsByAccount[id] ?? 0), 0);

  if (total <= 0) {
    const share = deficit / ids.length;
    return Object.fromEntries(ids.map((id) => [id, (investmentsByAccount[id] ?? 0) - share]));
  }

  const result: Record<number, number> = {};
  for (const id of ids) {
    const balance = investmentsByAccount[id] ?? 0;
    const proportion = balance / total;
    result[id] = balance - deficit * proportion;
  }
  return result;
}

/**
 * Sequential drawdown (Task 3D) — textbook tax-efficient withdrawal order:
 * taxable → tax-deferred → Roth. Each tier is drawn within its bucket
 * proportionally to balance, then any unmet deficit cascades to the next tier.
 * If all three tiers are exhausted, the remaining deficit is split across
 * any negative-balance accounts proportionally (matching the legacy
 * pro-rata fallback for insolvent projections).
 *
 * Accounts that aren't in the engine's accounts list (rare — usually only
 * happens when test fixtures stub `investmentsByAccount` without an Account
 * entry) fall through to the legacy proportional logic.
 *
 * Tax gross-up (Wave-3 Task 2): when `effectiveTaxRate > 0` AND the
 * tier being drained is `taxDeferred` (Trad 401k / Trad IRA / HSA / 529),
 * the withdrawal is grossed up so the NET amount reaching the user equals
 * the requested deficit:
 *     grossWithdrawal = netNeeded / (1 - rate)
 * `taxable` and `roth` tiers ignore this — taxable principal is already
 * after-tax (gains already taxed at LTCG schedule via annualLongTermGains;
 * pre-realisation basis is not modelled here), and Roth distributions are
 * tax-free at 59.5+. Returns a {balances, taxPaid} tuple so the caller can
 * surface the implied tax via withdrawalTaxAccrued for tooltip / disclosure.
 */
interface SequentialWithdrawResult {
  balances: Record<number, number>;
  /** Gross dollars actually pulled from the taxDeferred tier (gross = net / (1 - rate)). */
  taxDeferredGross: number;
  /** Implied tax = taxDeferredGross * rate. Zero when rate == 0 or no Trad bucket drained. */
  taxPaid: number;
}

function withdrawSequential(
  investmentsByAccount: Record<number, number>,
  deficit: number,
  accounts: Account[],
  effectiveTaxRate: number = 0,
): SequentialWithdrawResult {
  const accountById = new Map<number, Account>();
  for (const a of accounts) if (a.id !== undefined) accountById.set(a.id, a);

  const bucketIds: Record<SequencingBucket, number[]> = {
    taxable: [],
    taxDeferred: [],
    roth: [],
  };
  const unbucketed: number[] = [];
  for (const idStr of Object.keys(investmentsByAccount)) {
    const id = Number(idStr);
    const acc = accountById.get(id);
    const bucket = acc ? sequencingBucketForAccount(acc) : null;
    if (bucket) bucketIds[bucket].push(id);
    else unbucketed.push(id);
  }

  // No account metadata available → degrade to proportional. This keeps
  // legacy fixture mocks (that pass investmentsByAccount but stub
  // accounts: []) behaving consistently.
  if (
    bucketIds.taxable.length + bucketIds.taxDeferred.length + bucketIds.roth.length === 0
  ) {
    return {
      balances: withdrawProportionally(investmentsByAccount, deficit),
      taxDeferredGross: 0,
      taxPaid: 0,
    };
  }

  let remaining = deficit;
  let taxDeferredGross = 0;
  const result: Record<number, number> = { ...investmentsByAccount };

  // tier-with-gross-up: the BALANCE drawn from the tier is potentially the
  // grossed-up amount (gross = net / (1 - rate)). `remaining` represents
  // the NET cash still needed — so when we draw $X gross we reduce
  // `remaining` by `X * (1 - rate)` (the net portion delivered to the user).
  // Tier balances may not be sufficient to satisfy the grossed-up draw —
  // in that case we drain the whole tier and convert what was actually
  // drawn into its net contribution.
  function drainTier(ids: number[], grossUp: boolean): void {
    if (remaining <= 0 || ids.length === 0) return;
    const tierTotal = ids.reduce((s, id) => s + (result[id] ?? 0), 0);
    if (tierTotal <= 0) return;
    // If grossing up: the ideal gross draw is `remaining / (1 - rate)`,
    // but cap at the tier total. The net delivered equals
    // (actualGross) * (1 - rate). For non-gross-up tiers, gross == net.
    const idealGross = grossUp && effectiveTaxRate < 1
      ? remaining / (1 - effectiveTaxRate)
      : remaining;
    const actualGross = Math.min(tierTotal, idealGross);
    for (const id of ids) {
      const balance = result[id] ?? 0;
      result[id] = balance - actualGross * (balance / tierTotal);
    }
    const netDelivered = grossUp ? actualGross * (1 - effectiveTaxRate) : actualGross;
    remaining -= netDelivered;
    if (grossUp) taxDeferredGross += actualGross;
  }

  drainTier(bucketIds.taxable, false);
  drainTier(bucketIds.taxDeferred, effectiveTaxRate > 0);
  drainTier(bucketIds.roth, false);

  // Anything left? Push it onto either the unbucketed accounts (if any) or,
  // failing that, distribute pro-rata across all known accounts (matching the
  // insolvent-projection behavior of withdrawProportionally — we don't clamp).
  if (remaining > 0) {
    if (unbucketed.length > 0) {
      const share = remaining / unbucketed.length;
      for (const id of unbucketed) result[id] = (result[id] ?? 0) - share;
    } else {
      const ids = Object.keys(result).map(Number);
      if (ids.length > 0) {
        const share = remaining / ids.length;
        for (const id of ids) result[id] = (result[id] ?? 0) - share;
      }
    }
  }

  return {
    balances: result,
    taxDeferredGross,
    taxPaid: taxDeferredGross * effectiveTaxRate,
  };
}

function stepMonth(
  prev: MonthlyState,
  real: RealState,
  payload: LeverPayload,
  startYear: number,
  monthIndex: number,
  cashMonthlyRate: number,   // pre-computed, frozen at projection start
  inflationSlice: InflationSlice,
  compoundingFrequency: CompoundingFrequency,  // frozen at projection start
): MonthlyState {
  const monthISO = addMonths(prev.monthISO, 1);
  let s: MonthlyState = {
    ...prev,
    monthISO,
    events: [],
    // Reset per-step flow decomposition. Optional fields default to 0 each
    // step so a consumer can sum across an interval without worrying about
    // undefined arithmetic.
    compoundReturnAdded: 0,
    gapToTaxAdvantaged: 0,
    gapToBrokerage: 0,
    gapToCash: 0,
    leverContributionsInvested: 0,
    lumpSumInvested: 0,
    withdrawnFromInvestments: 0,
    withdrawalTaxAccrued: 0,
    // Clone `investmentsByAccount` and `debtByLoan` so this step's mutations
    // (applyGapAllocation / distributeWithinBucket mutate in place) don't
    // ripple back into earlier states in the projection array. The previous
    // routing helpers all returned fresh objects; the gap-allocation helper
    // is intentionally mutating for symmetry inside its phases.
    investmentsByAccount: { ...prev.investmentsByAccount },
    debtByLoan: { ...prev.debtByLoan },
  };

  // 0. Apply this month's cash APY growth on last month's ending balance,
  //    BEFORE the savings/contribution step adds new inflows.
  //    cashMonthlyRate is frozen at projection start via effectiveCashApy_frozen.
  if (cashMonthlyRate > 0) {
    s.cash *= 1 + cashMonthlyRate;
  }

  // Resolve the contribution allocation for this month once. Used by both
  // lump-sum routing (when destination=investments) and contribution routing.
  const allocation = resolveAllocation(payload, monthIndex, s.investmentsByAccount);

  // 1. Lump-sum events firing this month
  let lumpSumInvested = 0;
  for (const evt of payload.lumpSums) {
    if (evt.when.slice(0, 7) === monthISO) {
      if (evt.destination === 'investments') {
        lumpSumInvested += evt.amount;
      }
      s = applyLumpSum(s, evt, allocation);
    }
  }
  s.lumpSumInvested = lumpSumInvested;

  // 2. Compute monthly income across persons. After a person reaches their
  // retirement age (Person.targetRetirementAge, or LeverPayload.retirementAgeOverride
  // when set), their salary contribution drops to zero. Expenses are still
  // deducted normally; the cash-floor rule (step 6) will route the resulting
  // deficit out of investments — modeling a SWR-style drawdown without needing
  // a separate withdrawal-engine code path.
  const perPersonMonthlyGross: number[] = [];
  real.persons.forEach((p, idx) => {
    const plan = payload.income.perPerson[idx] ?? payload.income.perPerson[0];
    const baseSalary = p.annualSalaryPretax ?? 0;
    const retireAt = payload.retirementAgeOverride ?? (p as { targetRetirementAge?: number }).targetRetirementAge ?? null;
    if (retireAt !== null) {
      const personAge = ageAtMonth((p as { dateOfBirth?: string }).dateOfBirth, monthISO);
      if (personAge >= retireAt) {
        perPersonMonthlyGross.push(0); // retired this month → no salary
        return;
      }
    }
    perPersonMonthlyGross.push(computeMonthlyIncomeForPerson(baseSalary, plan, monthISO, startYear));
  });
  const monthlyGrossIncome = perPersonMonthlyGross.reduce((a, b) => a + b, 0);

  // 3. Bracket-real federal + FICA + state + city tax via computeTotalTax.
  // Annualize monthly gross, compute annual tax once, amortize back to monthly drag.
  // (Pretax deductions stay at zero in v1 — a follow-up can thread household pretax in.)
  // LTCG / qualified / non-qualified dividends flow through the payload's
  // annual* fields so they're taxed at the LTCG schedule (when present) and
  // contribute to NIIT MAGI/net-II calculation.
  const annualGross = monthlyGrossIncome * 12;
  const annualTax = annualHouseholdTax(
    real,
    annualGross,
    payload,
    perPersonMonthlyGross.map((g) => g * 12),
  );
  s.incomeAfterTax = (annualGross - annualTax) / 12;

  // 4. Expenses: baseline trended + period deltas.
  //
  // Inflation compounds monthly. The annual rate is year-aware — sourced
  // from the inflationSlice via effectiveAnnualInflationFromSlice(year).
  // Pre-Task-15 the engine used Math.pow(1 + flatRate, monthIndex / 12)
  // which is mathematically equivalent to compounding the SAME monthly
  // factor monthIndex times. We preserve that semantics for the
  // no-override path (slice falls through to real.defaults.inflation)
  // while letting per-year overrides "kink" the curve at calendar-year
  // boundaries.
  //
  // The factor is rebuilt from scratch each step to keep the engine
  // pure — no carried state beyond `prev`. For a 40-year horizon
  // (480 months) this is O(480 * 480) = 230k multiplications in the
  // worst case, which is fine.
  const currentYear = Number(monthISO.slice(0, 4));
  let inflationFactor = 1;
  // Step from the startISO month FORWARD by monthIndex steps, applying
  // the per-year monthly rate at each step. We do this by walking
  // year-by-year so we only compute one monthly rate per year-of-step.
  let stepYear = startYear;
  let stepsLeft = monthIndex;
  // Months into stepYear at projection start. startISO is "YYYY-MM";
  // month 5 means 4 months have already elapsed inside startYear when
  // monthIndex=0 — but we anchor the factor at monthIndex=0 (factor=1)
  // and only compound steps 1..monthIndex. So the FIRST monthly step
  // lands in startYear's month "startMonth+1" (clamped to year boundary).
  let monthsAvailableInCurrentYear = 12 - Number(real.startISO.slice(5, 7));
  while (stepsLeft > 0) {
    const annualRate = effectiveAnnualInflationFromSlice(inflationSlice, stepYear);
    const monthlyFactor = Math.pow(1 + annualRate, 1 / 12);
    const stepsToTake = Math.min(stepsLeft, Math.max(0, monthsAvailableInCurrentYear));
    if (stepsToTake > 0) {
      inflationFactor *= Math.pow(monthlyFactor, stepsToTake);
      stepsLeft -= stepsToTake;
    }
    stepYear += 1;
    monthsAvailableInCurrentYear = 12;
    // Defensive — never run past currentYear, this loop should bottom
    // out via stepsLeft == 0 before stepYear exceeds currentYear+1.
    if (stepYear > currentYear + 1) break;
  }
  // Expense math (revamp 2026-05-26): the engine no longer adds a transaction-
  // derived baseline. Expenses are sourced entirely from active expense periods
  // (in today's-dollars) then inflated to the current month's nominal value.
  const periodDelta = monthlyExpenseFromPeriods(payload.expensePeriods, monthISO);
  // v1.1 (2026-05-27): recurring monthly obligations (rent + vehicle leases)
  // are summed per projection month so leases that end stop contributing
  // automatically. The total inflates alongside the rest of expenses. The
  // `-15` suffix is a stable mid-month date — isActiveOn's lexicographic
  // comparison works on any date in the month; mid-month avoids edge-case
  // ambiguity at month boundaries when endDate falls on the last day of a
  // month. The `?? []` guards against hand-constructed RealState fixtures
  // in legacy engine tests that pre-date the v1.1 field.
  const obligationDelta = monthlyRecurringObligation(
    real.housingPayments ?? [],
    real.vehicleLeases ?? [],
    `${monthISO}-15`,
  );
  // Feature B — the recurring monthly base BEFORE additive period overlays.
  // custom → customMonthly verbatim; data modes → the figure precomputed on
  // RealState.expenseBasis at capture. `?? 0` keeps legacy fixtures that
  // pre-date expenseBasis (and the back-compat custom/0 default) at a 0 base —
  // byte-identical to the pre-Feature-B engine. The base is added INSIDE the
  // same *inflationFactor term so it inflates exactly like periods + obligations.
  const expenseSource =
    (payload as { expenseSource?: 'latestMonth' | 'rolling12m' | 'custom' }).expenseSource ?? 'custom';
  const expenseBase =
    expenseSource === 'custom'
      ? ((payload as { customMonthly?: number }).customMonthly ?? 0)
      : (real.expenseBasis?.[expenseSource] ?? 0);
  s.expenses = (expenseBase + periodDelta + obligationDelta) * inflationFactor;

  // 5. Debt servicing
  let regularLoanPayments = 0;
  let extraLoanPayments = 0;
  for (const loan of real.loans) {
    if (loan.id === undefined) continue;
    const currentBal = s.debtByLoan[loan.id] ?? 0;
    if (currentBal <= 0) continue;
    const ctx: LoanMonthlyContext = {
      loanId: loan.id,
      balance: currentBal,
      annualRate: loan.interestRate,
      regularMonthlyPayment: loan.monthlyPayment,
    };
    const extra = payload.extraLoanPayments.find((e) => e.loanId === loan.id);
    const result = applyExtraLoanPayment(ctx, extra, monthISO);
    s.debtByLoan = { ...s.debtByLoan, [loan.id]: result.newBalance };
    regularLoanPayments += loan.monthlyPayment;
    extraLoanPayments += result.extraApplied;
    if (result.newBalance === 0 && (prev.debtByLoan[loan.id] ?? 0) > 0) {
      s.events.push(`debt_paid_off:${loan.id}`);
    }
  }

  // 6. Savings = income - expenses - loan payments.
  // Route monthly cash flow so that cash is floored at zero and any remaining
  // shortfall draws from investments instead of letting cash go negative.
  // - With an active contributions segment: pull the fixed amount into
  //   investments, then route the remaining surplus (savings - contribution)
  //   to cash if positive, or apply the cash-floor shortfall rule if negative.
  // - With no segment active: positive savings → investments, negative savings
  //   → cash-floor shortfall rule.
  // The shortfall rule: deduct from cash first, floor cash at zero, then deduct
  // any remaining deficit from investments. Returns are applied after this
  // routing (step 7), so investments still receive their monthly growth on
  // whatever balance remains.
  s.savings = s.incomeAfterTax - s.expenses - regularLoanPayments - extraLoanPayments;
  // Resolve the withdrawal strategy once per step. Field is optional on
  // older saved scenarios (lever-types schema parses missing values as
  // 'proportional'); the explicit ?? lets unparsed in-memory payloads
  // fall back too.
  const withdrawalStrategy =
    (payload as { withdrawalStrategy?: 'proportional' | 'sequential' }).withdrawalStrategy
    ?? 'proportional';
  // Precedence: per-scenario lever value wins when set to a non-zero rate
  // (explicit override), otherwise fall back to the household-level
  // AppSettings.defaultDrawdownTaxRate surfaced via Settings → Advanced.
  // 0 anywhere in the chain ⇒ legacy net-equals-gross behavior. Mirrors
  // the inflation / cash-APY / SWR precedence convention.
  const perScenarioRate =
    (payload as { effectiveDrawdownTaxRate?: number }).effectiveDrawdownTaxRate ?? 0;
  const effectiveDrawdownTaxRate =
    perScenarioRate > 0
      ? perScenarioRate
      : real.defaults?.defaultDrawdownTaxRate ?? 0;
  const contribution = activeContributionAmount(payload.contributions, monthIndex);
  if (contribution !== null) {
    s.investmentsByAccount = distributeToAccounts(s.investmentsByAccount, contribution, allocation);
    s.leverContributionsInvested = contribution;
    const remainder = s.savings - contribution;
    if (remainder > 0) {
      // Route the segment-leftover surplus through gap allocation (per spec
      // §"Engine routing order"). Mutate s.savings in-place so the helper
      // operates on the segment-leftover amount, then restore the original
      // `s.savings` for the rest of stepMonth.
      const original = s.savings;
      s.savings = remainder;
      applyGapAllocation(s, payload.gapAllocation, real.accountsByBucket);
      s.savings = original;
    } else if (remainder < 0) {
      applyCashFloorShortfall(s, -remainder, withdrawalStrategy, real.accounts, effectiveDrawdownTaxRate);
    }
  } else if (s.savings > 0) {
    // Gap allocation lever (revamp 2026-05-26) — routes the positive surplus
    // into tax-advantaged accounts, brokerage, and/or cash per
    // payload.gapAllocation. Defaults to all-cash when the user hasn't
    // configured anything.
    applyGapAllocation(s, payload.gapAllocation, real.accountsByBucket);
  } else if (s.savings < 0) {
    applyCashFloorShortfall(s, -s.savings, withdrawalStrategy, real.accounts, effectiveDrawdownTaxRate);
  }

  // 7. Apply this month's return to investments. The compounding frequency
  // is per-scenario (defaults to MONTHLY — identical to the legacy
  // (1+annual)^(1/12)-1 monthly rate). See applyAnnualReturnWithFrequency.
  // We snapshot total investments immediately before and after the call so
  // we can attribute the gain to `compoundReturnAdded` (Task #25) without
  // changing the math. The snapshot wraps whichever variant of applyReturn
  // is in use — frequency-aware or otherwise.
  const investmentsBeforeReturn = totalInvestments(s);
  const year = Number(monthISO.slice(0, 4));
  const annualReturn = payload.returns.overrides[String(year)] ?? payload.returns.defaultRate;
  s = applyAnnualReturnWithFrequency(s, annualReturn, compoundingFrequency);
  s.compoundReturnAdded = totalInvestments(s) - investmentsBeforeReturn;

  s.netWorth = computeNetWorth(s);
  return s;
}

// Deduct `deficit` (a positive number) from cash first; if cash can't cover it,
// floor cash at zero and pull the rest from investments. Investments may go
// negative if the deficit exceeds both buckets — we don't clamp, since that
// would silently hide an insolvent projection from the user.
//
// Side-effect: when the helper draws from investments it accumulates the
// drawn amount into `s.withdrawnFromInvestments` (Task #25 decomposition).
// Accumulates because a single step may invoke this twice (e.g. with an
// active contribution segment whose remainder goes negative AND a savings
// branch that also triggers — though in practice only one branch fires per
// step). Using += keeps the contract safe either way.
function applyCashFloorShortfall(
  s: MonthlyState,
  deficit: number,
  strategy: 'proportional' | 'sequential',
  accounts: Account[],
  effectiveDrawdownTaxRate: number = 0,
): void {
  if (s.cash >= deficit) {
    s.cash -= deficit;
    return;
  }
  const fromInvestments = deficit - s.cash;
  s.cash = 0;
  if (strategy === 'sequential') {
    const r = withdrawSequential(
      s.investmentsByAccount,
      fromInvestments,
      accounts,
      effectiveDrawdownTaxRate,
    );
    s.investmentsByAccount = r.balances;
    // Implied tax is accrued for tooltip / decomposition. The grossed-up
    // gross amount has ALREADY reduced the Trad balances, so the net
    // delivered = fromInvestments + r.taxPaid is what reached the user
    // (matches: cash absorbed `s.cash` worth of the deficit, then we
    // pulled fromInvestments-net from accounts after gross-up shenanigans).
    s.withdrawalTaxAccrued = (s.withdrawalTaxAccrued ?? 0) + r.taxPaid;
    // withdrawnFromInvestments tracks the *gross* hit to portfolio balances
    // (taxable principal + grossed-up Trad gross + Roth principal); that's
    // the right value for "how much smaller did your portfolio just get."
    s.withdrawnFromInvestments =
      (s.withdrawnFromInvestments ?? 0) + fromInvestments + r.taxPaid;
  } else {
    s.investmentsByAccount = withdrawProportionally(s.investmentsByAccount, fromInvestments);
    s.withdrawnFromInvestments = (s.withdrawnFromInvestments ?? 0) + fromInvestments;
  }
}

export function computeNetWorth(s: MonthlyState): number {
  const debt = Object.values(s.debtByLoan).reduce((a, b) => a + b, 0);
  return totalInvestments(s) + s.homeEquity + s.cash - debt;
}

function addMonths(monthISO: string, n: number): string {
  const d = new Date(`${monthISO}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
}
