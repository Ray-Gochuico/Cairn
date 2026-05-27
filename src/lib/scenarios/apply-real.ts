import type { MonthlyState } from './engine';
import type {
  ContributionSegment,
  ExpensePeriod,
  ExtraLoanPayment,
  GapAllocation,
  IncomeEvent,
  LumpSumEvent,
  PerAccountSplit,
  PersonIncomePlan,
} from './lever-types';
import type { Account } from '@/types/schema';
import { CompoundingFrequency } from '@/types/enums';

/** Converts an annual return to a monthly return that compounds back to the annual. */
export function monthlyReturnFromAnnual(annual: number): number {
  return Math.pow(1 + annual, 1 / 12) - 1;
}

/**
 * Periods-per-year mapping for {@link CompoundingFrequency}.
 *
 * - DAILY → 365 (calendar-perfect alternatives would use 365.25; 365 keeps the
 *   math symbolic and matches the typical HYSA quoting convention).
 * - WEEKLY → 52.
 * - MONTHLY → 12. Identical to the legacy `monthlyReturnFromAnnual`.
 * - QUARTERLY → 4.
 * - ANNUALLY → 1. The full annual rate lands in one month per year — for the
 *   12-month-balanced projection this still compounds to (1 + annual) over the
 *   year, but the per-step rate is 0 for 11 of the 12 months.
 *
 * NOTE: the engine still steps month-by-month. For frequencies coarser than
 * monthly, the periodic interest rate is decomposed into 12 equal monthly
 * sub-rates so the projection retains its monthly cadence without losing
 * total annual yield.
 */
export function periodsPerYear(frequency: CompoundingFrequency): number {
  switch (frequency) {
    case CompoundingFrequency.DAILY:
      return 365;
    case CompoundingFrequency.WEEKLY:
      return 52;
    case CompoundingFrequency.MONTHLY:
      return 12;
    case CompoundingFrequency.QUARTERLY:
      return 4;
    case CompoundingFrequency.ANNUALLY:
      return 1;
  }
}

/**
 * Converts an annual rate to a monthly rate consistent with the supplied
 * compounding frequency.
 *
 * Interpretation: the user-supplied `annual` is the EFFECTIVE annual rate
 * regardless of frequency. The math derives a per-period rate that compounds
 * over `N` periods to equal (1 + annual), then re-spreads that periodic rate
 * over the 12 monthly engine steps so total annual yield is preserved.
 *
 * Identity for MONTHLY (the default): collapses to
 *   `Math.pow(1 + annual, 1/12) - 1`
 * which is the exact pre-Task-16 `monthlyReturnFromAnnual` formula. Tests
 * pin that identity so existing $100k @ 7% baselines (line 105 of the
 * 2026-05-26 current-state spec) keep producing $107,000.00 at month 12.
 *
 * For ANY frequency, the value at month 12 is still
 *   start * (1 + annual)
 * because the 12 monthly factors multiply to `(1 + periodicRate)^N` and
 * `(1 + periodicRate)^N === 1 + annual` by construction. DAILY / WEEKLY /
 * QUARTERLY differ from MONTHLY only in INTRA-year balances (where
 * "per-month" growth is non-uniform), not in the full-year total.
 */
export function monthlyReturnFromAnnualWithFrequency(
  annual: number,
  frequency: CompoundingFrequency,
): number {
  // Negative annual rates are valid for projection (loss-year overrides like
  // the Lost Decade preset). Math.pow handles negative bases fine when the
  // exponent is rational, but a -100%+ rate (1+annual <= 0) is degenerate;
  // clamp to -1 + epsilon to avoid NaN. The schema already restricts the
  // range to [-1, 1] so this is defensive.
  const safeBase = Math.max(1 + annual, 1e-12);
  const N = periodsPerYear(frequency);
  // Periodic rate that compounds N times per year to give (1 + annual).
  const periodicRate = Math.pow(safeBase, 1 / N) - 1;
  // Convert periodic rate back to a monthly rate. (1 + periodicRate)^N over
  // a full year equals (1 + annual), so the equivalent monthly rate that
  // multiplies to the same annual total across 12 months is:
  //   Math.pow(1 + periodicRate, N / 12) - 1.
  // For MONTHLY (N=12) this collapses to (1 + annual)^(1/12) - 1 exactly,
  // preserving the legacy formula bit-for-bit.
  return Math.pow(1 + periodicRate, N / 12) - 1;
}

export function applyAnnualReturn(state: MonthlyState, annualReturn: number): MonthlyState {
  const m = monthlyReturnFromAnnual(annualReturn);
  const grown: Record<number, number> = {};
  for (const [idStr, balance] of Object.entries(state.investmentsByAccount)) {
    grown[Number(idStr)] = balance * (1 + m);
  }
  return { ...state, investmentsByAccount: grown };
}

/**
 * Frequency-aware variant of {@link applyAnnualReturn}. Used by the engine
 * when the per-scenario Returns lever sets a non-default compounding
 * frequency. Routes via {@link monthlyReturnFromAnnualWithFrequency}.
 */
export function applyAnnualReturnWithFrequency(
  state: MonthlyState,
  annualReturn: number,
  frequency: CompoundingFrequency,
): MonthlyState {
  const m = monthlyReturnFromAnnualWithFrequency(annualReturn, frequency);
  const grown: Record<number, number> = {};
  for (const [idStr, balance] of Object.entries(state.investmentsByAccount)) {
    grown[Number(idStr)] = balance * (1 + m);
  }
  return { ...state, investmentsByAccount: grown };
}

export function applyLumpSum(
  state: MonthlyState,
  evt: LumpSumEvent,
  allocation: Record<number, number>,
): MonthlyState {
  if (evt.destination === 'investments') {
    const grown = { ...state.investmentsByAccount };
    for (const [idStr, proportion] of Object.entries(allocation)) {
      const id = Number(idStr);
      grown[id] = (grown[id] ?? 0) + evt.amount * proportion;
    }
    return {
      ...state,
      investmentsByAccount: grown,
      events: [...state.events, `lump_sum:${evt.label ?? 'event'}`],
    };
  }
  return {
    ...state,
    cash: state.cash + evt.amount,
    events: [...state.events, `lump_sum:${evt.label ?? 'event'}`],
  };
}

/**
 * Returns the total monthly expense amount active for the given YYYY-MM,
 * summed across overlapping periods. Each period's `monthlyDelta` is an
 * ABSOLUTE monthly expense amount in today's dollars (see ExpensePeriodSchema
 * JSDoc). Negative values let users overlay reductions on top of overlapping
 * positive periods.
 *
 * SEMANTIC (since 2026-05-26 revamp): the engine no longer adds a
 * transaction-derived baseline. The sum returned here IS the scenario's
 * monthly expense (before inflation).
 */
export function monthlyExpenseFromPeriods(periods: ExpensePeriod[], monthISO: string): number {
  const monthDate = new Date(`${monthISO}-01T00:00:00Z`);
  let total = 0;
  for (const p of periods) {
    const startDate = new Date(p.start.length === 7 ? `${p.start}-01T00:00:00Z` : `${p.start}T00:00:00Z`);
    const endDate = addMonthsUTC(startDate, p.durationMonths);
    if (monthDate >= startDate && monthDate < endDate) {
      total += p.monthlyDelta;
    }
  }
  return total;
}

/**
 * Distributes `amount` into `s.investmentsByAccount` across the bucket's
 * accounts. Honors `accountSplits` when present (filtering stale account ids
 * and re-normalizing the survivors). Falls back to even split when splits are
 * null OR every split id is stale. No-op when `amount <= 0` or accounts is
 * empty.
 *
 * Note: this function MUTATES `s.investmentsByAccount`. The engine's gap
 * routing block already operates on a draft state so this is fine — keeps the
 * helper symmetrical with `applyGapAllocation` below.
 */
export function distributeWithinBucket(
  s: MonthlyState,
  _bucket: 'taxAdvantaged' | 'brokerage',
  amount: number,
  accountSplits: PerAccountSplit[] | null,
  accounts: Account[],
): void {
  if (amount <= 0 || accounts.length === 0) return;

  const validIds = new Set(
    accounts.map((a) => a.id).filter((id): id is number => id != null),
  );

  // Try the user-configured splits first.
  if (accountSplits && accountSplits.length > 0) {
    const filtered = accountSplits.filter((sp) => validIds.has(sp.accountId));
    const sum = filtered.reduce((acc, sp) => acc + sp.pct, 0);
    if (sum > 0) {
      for (const sp of filtered) {
        const share = amount * (sp.pct / sum);
        s.investmentsByAccount[sp.accountId] =
          (s.investmentsByAccount[sp.accountId] ?? 0) + share;
      }
      return;
    }
    // All splits stale — fall through to even split.
  }

  // Even-split fallback across valid bucket accounts.
  const ids = [...validIds];
  if (ids.length === 0) return;
  const share = amount / ids.length;
  for (const id of ids) {
    s.investmentsByAccount[id] = (s.investmentsByAccount[id] ?? 0) + share;
  }
}

/**
 * Routes a positive monthly gap into tax-advantaged accounts, brokerage,
 * and/or cash per a two-level allocation. See the spec's §E3 for the
 * full algorithm — corrected from the spec's pseudocode here:
 *
 * Phase 1 — Compute fixed-bucket amounts (clamped to the gap; empty buckets
 *           skipped, their value stays in `remaining` and flows to cash).
 * Phase 1b — If sum-of-fixed > original gap, scale all fixed amounts
 *           proportionally so they fit. Percent buckets get $0 that month.
 * Phase 2 — Compute percent-bucket amounts over `remaining` (post-fixed).
 * Phase 2b — If sum-of-percent > 1.0, normalize the percent values
 *           proportionally before computing amounts.
 * Phase 3 — Distribute via distributeWithinBucket. Tag decomposition fields.
 * Phase 4 — Any positive `remaining` flows to cash.
 *
 * Mutates `s` in place: `s.cash`, `s.investmentsByAccount`, and the three
 * new `gapTo*` decomposition fields. Always exits with the three `gapTo*`
 * fields set (possibly 0).
 */
export function applyGapAllocation(
  s: MonthlyState,
  alloc: GapAllocation,
  accountsByBucket: Record<'taxAdvantaged' | 'brokerage', Account[]>,
): void {
  s.gapToTaxAdvantaged = 0;
  s.gapToBrokerage = 0;
  s.gapToCash = 0;
  if (s.savings <= 0) return;

  const originalGap = s.savings;
  let remaining = originalGap;

  // ---- Phase 1: fixed-dollar buckets ----------------------------------------
  const fixedAmounts: { taxAdvantaged: number; brokerage: number } = {
    taxAdvantaged: 0,
    brokerage: 0,
  };
  for (const bucket of ['taxAdvantaged', 'brokerage'] as const) {
    const cfg = alloc[bucket];
    if (cfg?.mode !== 'fixed') continue;
    if (accountsByBucket[bucket].length === 0) continue;  // empty bucket → flows to cash
    fixedAmounts[bucket] = Math.min(cfg.value, originalGap);
  }
  const fixedSum = fixedAmounts.taxAdvantaged + fixedAmounts.brokerage;

  // ---- Phase 1b: proportional clamp when fixed sum > gap --------------------
  if (fixedSum > originalGap && fixedSum > 0) {
    const scale = originalGap / fixedSum;
    fixedAmounts.taxAdvantaged *= scale;
    fixedAmounts.brokerage     *= scale;
  }
  remaining = originalGap - (fixedAmounts.taxAdvantaged + fixedAmounts.brokerage);

  // ---- Phase 2: percent buckets over `remaining` ----------------------------
  // First normalize sum-of-percent > 1 in-place (creates a clone so we don't
  // mutate the user's payload).
  const pctValues: { taxAdvantaged: number; brokerage: number } = {
    taxAdvantaged:
      alloc.taxAdvantaged?.mode === 'percent' && accountsByBucket.taxAdvantaged.length > 0
        ? alloc.taxAdvantaged.value
        : 0,
    brokerage:
      alloc.brokerage?.mode === 'percent' && accountsByBucket.brokerage.length > 0
        ? alloc.brokerage.value
        : 0,
  };
  const pctSum = pctValues.taxAdvantaged + pctValues.brokerage;
  if (pctSum > 1 && pctSum > 0) {
    pctValues.taxAdvantaged /= pctSum;
    pctValues.brokerage     /= pctSum;
  }

  const percentAmounts: { taxAdvantaged: number; brokerage: number } = {
    taxAdvantaged: remaining * pctValues.taxAdvantaged,
    brokerage:     remaining * pctValues.brokerage,
  };
  remaining -= percentAmounts.taxAdvantaged + percentAmounts.brokerage;

  // ---- Phase 3: distribute + tag --------------------------------------------
  for (const bucket of ['taxAdvantaged', 'brokerage'] as const) {
    const amount = fixedAmounts[bucket] + percentAmounts[bucket];
    if (amount <= 0) continue;
    const cfg = alloc[bucket];
    distributeWithinBucket(s, bucket, amount, cfg?.accountSplits ?? null, accountsByBucket[bucket]);
    if (bucket === 'taxAdvantaged') s.gapToTaxAdvantaged = amount;
    else                            s.gapToBrokerage     = amount;
  }

  // ---- Phase 4: cash overflow ----------------------------------------------
  const cashAmount = Math.max(0, remaining);
  s.cash += cashAmount;
  s.gapToCash = cashAmount;
}

function addMonthsUTC(d: Date, months: number): Date {
  const out = new Date(d);
  out.setUTCMonth(out.getUTCMonth() + months);
  return out;
}

export interface LoanMonthlyContext {
  loanId: number;
  balance: number;
  annualRate: number;
  regularMonthlyPayment: number;
}

export interface LoanMonthlyResult {
  newBalance: number;
  principalPaid: number;
  interestPaid: number;
  extraApplied: number;
}

export function applyExtraLoanPayment(
  ctx: LoanMonthlyContext,
  extra: ExtraLoanPayment | undefined,
  monthISO: string,
): LoanMonthlyResult {
  if (ctx.balance <= 0) return { newBalance: 0, principalPaid: 0, interestPaid: 0, extraApplied: 0 };

  const monthlyRate = ctx.annualRate / 12;
  const interest = ctx.balance * monthlyRate;
  const regularPrincipal = Math.min(ctx.regularMonthlyPayment - interest, ctx.balance);

  let extraApplied = 0;
  if (extra && extra.extraMonthly > 0 && isWithinWindow(monthISO, extra.start, extra.end)) {
    const balanceAfterRegular = ctx.balance - regularPrincipal;
    extraApplied = Math.min(extra.extraMonthly, balanceAfterRegular);
  }

  const principalPaid = regularPrincipal + extraApplied;
  const newBalance = Math.max(0, ctx.balance - principalPaid);
  return { newBalance, principalPaid, interestPaid: interest, extraApplied };
}

function isWithinWindow(monthISO: string, start?: string, end?: string): boolean {
  const m = monthISO; // 'YYYY-MM'
  if (start && m < start.slice(0, 7)) return false;
  if (end && m > end.slice(0, 7)) return false;
  return true;
}

/**
 * Returns the active contribution amount for a given `monthIndex` (0-based, months
 * elapsed since projection start), or `null` if no segment covers this month.
 *
 * Segments are half-open intervals on the LEFT (startMonth inclusive) and CLOSED
 * on the RIGHT (endMonth inclusive). `endMonth: null` is open-ended through the
 * horizon. If multiple segments overlap a month, the first one in array order wins.
 */
export function activeContributionAmount(
  segments: ContributionSegment[],
  monthIndex: number,
): number | null {
  for (const seg of segments) {
    if (monthIndex < seg.startMonth) continue;
    if (seg.endMonth !== null && monthIndex > seg.endMonth) continue;
    return seg.monthlyAmount;
  }
  return null;
}

export function computeMonthlyIncomeForPerson(
  baseSalary: number,
  plan: PersonIncomePlan,
  monthISO: string,         // 'YYYY-MM'
  startYear: number,
): number {
  const [yyyy, mm] = monthISO.split('-').map(Number);

  // Build the per-event timeline applied through monthISO.
  const sortedEvents = [...plan.events].sort((a, b) => a.when.localeCompare(b.when));

  let currentSalary = baseSalary;
  let preSabbaticalSalary = baseSalary;
  let sabbaticalEndISO: string | null = null as string | null;
  let sabbaticalResumeAt: number | null = null as number | null;

  // Apply raises for each Jan between startYear and monthISO's year, plus any events that have fired.
  let cursorYear = startYear;
  while (cursorYear <= yyyy) {
    if (cursorYear > startYear) {
      currentSalary *= 1 + plan.annualRaiseRate;
    }
    // Apply events that fire in this cursor year, in order
    for (const ev of sortedEvents) {
      const eyy = Number(ev.when.slice(0, 4));
      const emm = Number(ev.when.slice(5, 7));
      if (eyy !== cursorYear) continue;
      if (cursorYear === yyyy && emm > mm) continue; // event still in the future of monthISO
      applyEvent(ev);
    }
    cursorYear++;
  }

  // Check if we're inside a sabbatical at monthISO
  if (sabbaticalEndISO && monthISO < sabbaticalEndISO) {
    return 0;
  }
  if (sabbaticalEndISO && monthISO >= sabbaticalEndISO && sabbaticalResumeAt !== null) {
    currentSalary = sabbaticalResumeAt;
    sabbaticalEndISO = null;
  } else if (sabbaticalEndISO && monthISO >= sabbaticalEndISO) {
    currentSalary = preSabbaticalSalary;
    sabbaticalEndISO = null;
  }

  return currentSalary / 12;

  function applyEvent(ev: IncomeEvent) {
    switch (ev.type) {
      case 'raise':
        currentSalary += ev.deltaAmount;
        break;
      case 'promotion':
      case 'cut':
      case 'job_change':
        currentSalary = ev.newSalary;
        break;
      case 'sabbatical': {
        preSabbaticalSalary = currentSalary;
        const startDate = new Date(`${ev.when}T00:00:00Z`);
        const endDate = new Date(startDate);
        endDate.setUTCMonth(endDate.getUTCMonth() + ev.durationMonths);
        sabbaticalEndISO = endDate.toISOString().slice(0, 7);
        sabbaticalResumeAt = ev.resumesAt ?? null;
        break;
      }
    }
  }
}
