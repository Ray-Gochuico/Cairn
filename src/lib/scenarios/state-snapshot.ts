import type { Account, AccountSnapshot, Holding, Loan, LoanPayment, Transaction, Household, Person, TaxRule, JurisdictionType, HousingPayment, VehicleLease, Category } from '@/types/schema';
import type { Bracket } from '@/lib/tax';
import { AccountType, type FilingStatus } from '@/types/enums';
import { taxBucketForAccount } from '@/lib/account-tax-classification';
import { latestCompleteMonthBaseline, rolling12mBaseline } from '@/lib/expense-baseline';

export interface AppSettingsSlice {
  defaultInflation: number;
  defaultReturnRate: number;
  defaultCashApy: number | null;
  /**
   * Household-default blended effective tax rate applied to gross-up Trad
   * 401k / Trad IRA / HSA / 529 withdrawals under the SEQUENTIAL drawdown
   * strategy. Stored as a fraction (0.22 = 22%). null = unset; the engine
   * falls through to the per-scenario lever value (which itself defaults
   * to 0 = legacy net-equals-gross behavior).
   *
   * Surfaced via Settings → Advanced. See Finance Wave-5 review NEW-W5-1.
   */
  defaultDrawdownTaxRate: number | null;
}

export interface RealStateInputs {
  accounts: Account[];
  accountSnapshots?: AccountSnapshot[];
  holdings: Holding[];
  loans: Loan[];
  loanPayments: LoanPayment[];
  transactions: Transaction[];
  household: Household;
  persons: Person[];
  appSettings: AppSettingsSlice;
  startISO: string;
  taxRules: TaxRule[];
  /**
   * Recurring monthly housing obligations (rent). Optional — defaults to
   * empty array. Engine sums active items into per-month expenses via
   * monthlyHousingObligation in src/lib/recurring-obligations.ts.
   */
  housingPayments?: HousingPayment[];
  /**
   * Recurring monthly vehicle leases. Same shape + treatment as
   * housingPayments.
   */
  vehicleLeases?: VehicleLease[];
  /**
   * All categories — used to compute the Feature B real-spending expense basis
   * via isRealSpending (excludes TRANSFER/INCOME, nets reimbursements). Optional
   * + defaults to [] so legacy engine fixtures that pre-date Feature B still
   * construct (their expenseBasis resolves to {0,0}, the custom-mode no-op).
   */
  categories?: Category[];
}

export interface RealStateTaxBrackets {
  federal: Bracket[];
  state: Bracket[];
  city: Bracket[] | null;
  /**
   * Long-term capital gains + qualified dividend federal schedule
   * (0% / 15% / 20%). Pre-2026-05-27 the engine treated cap gains as
   * ordinary income, applying the 10–37% federal schedule. Now sourced
   * from tax_rules where jurisdiction_type = 'FEDERAL_LTCG' (seeded by
   * migration 0032). Empty array when no LTCG row is seeded for the
   * filing status (back-compat for fixtures + older tax-year fall-throughs).
   */
  ltcg: Bracket[];
  /**
   * Per-jurisdiction standard deduction. Pre-fix this was a single scalar
   * sourced from the FEDERAL row and applied to state/city tax as well —
   * MA (state SD = $0) was getting the federal $32,200 SD against its
   * 5% bracket, under-collecting ~$1,460/year for a $300k MFJ household.
   * Now each jurisdiction's own seeded SD is consulted (see
   * pickStandardDeductionFor below).
   *
   * Cities that tax gross wages (Ohio cities, Kentucky cities, the PA
   * EIT cities, NYC) seed standardDeduction = 0 and that 0 flows through
   * here cleanly.
   */
  standardDeduction: {
    federal: number;
    state: number;
    city: number;
  };
}

export interface RealState {
  accounts: Account[];
  holdings: Holding[];
  loans: Loan[];
  loanPayments: LoanPayment[];
  household: Household;
  persons: Person[];
  /**
   * Accounts grouped by their tax-bucket classification (via taxBucketForAccount).
   * Used by applyGapAllocation to route surplus into the right bucket. Cash
   * accounts (CHECKING + SAVINGS) live in the `cash` bucket; they're informational
   * only — the engine routes leftover gap dollars into `s.cash` directly, not
   * per-account.
   *
   * Excluded-from-NW accounts are filtered out (consistent with
   * computeInitialBalances).
   */
  accountsByBucket: {
    taxAdvantaged: Account[];
    brokerage:     Account[];
    cash:          Account[];
  };
  /** Total cash bucket (CASH + SAVINGS) at projection start, from latest per-account snapshot. */
  initialCash: number;
  /** Per-account investment balances at projection start. Key = Account.id. */
  initialInvestmentsByAccount: Record<number, number>;
  /**
   * Cash and savings accounts with their balance at projection start.
   * Used by effectiveCashApy() to compute the balance-weighted APY, frozen at
   * projection start. Only includes accounts not excluded from net worth.
   */
  cashAccountsWithBalances: Array<{ account: Account; balance: number }>;
  defaults: {
    inflation: number;
    returnRate: number;
    defaultCashApy: number | null;
    /**
     * Household-level fallback for the Trad-bucket gross-up rate when a
     * scenario's per-lever value is 0 (the schema default). null = unset
     * (engine treats as 0 — legacy behavior). Sourced from
     * AppSettings.defaultDrawdownTaxRate, surfaced via Settings → Advanced.
     */
    defaultDrawdownTaxRate: number | null;
  };
  startISO: string;
  taxBrackets: RealStateTaxBrackets;
  /**
   * Recurring monthly housing obligations active during the projection. The
   * engine sums per-month active items into step.expenses via
   * monthlyRecurringObligation (see src/lib/recurring-obligations.ts), so a
   * rental with an endDate in the past stops contributing automatically.
   */
  housingPayments: HousingPayment[];
  /** Recurring monthly vehicle leases — same treatment as housingPayments. */
  vehicleLeases: VehicleLease[];
  /**
   * Feature B — both data-driven monthly expense bases, pre-computed ONCE at
   * capture and frozen at projection start. The engine reads the selected one at
   * the expense seam; the popover shows it as the resolved base. Transient —
   * never serialized; a saved scenario stores only `expenseSource` and re-derives
   * this on the next capture.
   */
  expenseBasis: {
    /** Total real spending in the latest COMPLETE month (in-progress month excluded). */
    latestMonth: number;
    /** Trailing-12-month average monthly real spending (distinct-months divisor). */
    rolling12m: number;
  };
}

const CASH_ACCOUNT_TYPES = new Set<string>([
  AccountType.ACCOUNT_CASH,
  AccountType.ACCOUNT_SAVINGS,
]);

function isCashAccount(account: Account): boolean {
  return CASH_ACCOUNT_TYPES.has(account.type);
}

/**
 * Returns the latest snapshot for each account on or before `startISO`. The
 * startISO is 'YYYY-MM' or 'YYYY-MM-DD'; we trim to month-precision and accept
 * any snapshot whose snapshotDate (YYYY-MM-DD) starts with a month <= startMonth.
 */
function latestSnapshotPerAccount(
  snapshots: AccountSnapshot[],
  startISO: string,
): Map<number, AccountSnapshot> {
  const startMonth = startISO.slice(0, 7);
  const byAccount = new Map<number, AccountSnapshot>();
  for (const snap of snapshots) {
    const snapMonth = snap.snapshotDate.slice(0, 7);
    if (snapMonth > startMonth) continue;
    const existing = byAccount.get(snap.accountId);
    if (!existing || existing.snapshotDate < snap.snapshotDate) {
      byAccount.set(snap.accountId, snap);
    }
  }
  return byAccount;
}

/**
 * Compute initial cash and invested-asset balances from the latest snapshot per
 * account. Falls back to summing holdings (shareCount * costBasis) only when a
 * non-cash account has no snapshot — this preserves the legacy behavior for the
 * narrow case where a user entered per-line holdings but never recorded a
 * snapshot. Excluded-from-NW accounts are skipped entirely.
 */
function computeInitialBalances(
  accounts: Account[],
  snapshots: AccountSnapshot[],
  holdings: Holding[],
  startISO: string,
): {
  initialCash: number;
  initialInvestmentsByAccount: Record<number, number>;
  cashAccountsWithBalances: Array<{ account: Account; balance: number }>;
} {
  const byAccount = latestSnapshotPerAccount(snapshots, startISO);
  let cash = 0;
  const investmentsByAccount: Record<number, number> = {};
  const cashAccountsWithBalances: Array<{ account: Account; balance: number }> = [];
  const accountsWithSnapshot = new Set<number>();
  for (const account of accounts) {
    if (account.id === undefined) continue;
    if (account.excludedFromNetWorth) continue;
    const snap = byAccount.get(account.id);
    if (snap) {
      accountsWithSnapshot.add(account.id);
      if (isCashAccount(account)) {
        cash += snap.totalValue;
        cashAccountsWithBalances.push({ account, balance: snap.totalValue });
      } else {
        investmentsByAccount[account.id] =
          (investmentsByAccount[account.id] ?? 0) + snap.totalValue;
      }
    }
  }

  // Fallback: for non-cash accounts without a snapshot, fall back to the legacy
  // holdings-based valuation (shareCount * costBasis) so older fixtures keep
  // working. Cash accounts without snapshots stay at zero — we have no other
  // signal for their balance.
  for (const account of accounts) {
    if (account.id === undefined) continue;
    if (account.excludedFromNetWorth) continue;
    if (accountsWithSnapshot.has(account.id)) continue;
    if (isCashAccount(account)) continue;
    const accountHoldings = holdings.filter((h) => h.accountId === account.id);
    let holdingsValue = 0;
    for (const h of accountHoldings) {
      holdingsValue += h.shareCount * (h.costBasis ?? 0);
    }
    if (holdingsValue > 0) {
      investmentsByAccount[account.id] =
        (investmentsByAccount[account.id] ?? 0) + holdingsValue;
    }
  }

  return { initialCash: cash, initialInvestmentsByAccount: investmentsByAccount, cashAccountsWithBalances };
}

function pickBrackets(
  rules: TaxRule[],
  jurisdictionType: JurisdictionType,
  jurisdictionCode: string,
  filingStatus: FilingStatus,
): Bracket[] {
  const match = rules.find(
    (r) =>
      r.jurisdictionType === jurisdictionType &&
      r.jurisdictionCode === jurisdictionCode &&
      r.filingStatus === filingStatus,
  );
  return match ? match.brackets : [];
}

/**
 * Look up the standard deduction for a specific jurisdiction (federal / state /
 * city). Returns 0 when no rule matches — that's the correct fall-through for
 * no-state-tax states (TX, FL) and for cities that tax gross wages.
 */
function pickStandardDeductionFor(
  rules: TaxRule[],
  jurisdictionType: JurisdictionType,
  jurisdictionCode: string,
  filingStatus: FilingStatus,
): number {
  const match = rules.find(
    (r) =>
      r.jurisdictionType === jurisdictionType &&
      r.jurisdictionCode === jurisdictionCode &&
      r.filingStatus === filingStatus,
  );
  return match?.standardDeduction ?? 0;
}

export function captureRealState(inputs: RealStateInputs): RealState {
  const filingStatus = inputs.household.filingStatus as FilingStatus;
  const state = (inputs.household as { state?: string | null }).state ?? null;
  const city = (inputs.household as { city?: string | null }).city ?? null;

  const federal = pickBrackets(inputs.taxRules, 'FEDERAL', 'US', filingStatus);
  const stateBrackets = state ? pickBrackets(inputs.taxRules, 'STATE', state, filingStatus) : [];
  const cityBrackets = city ? pickBrackets(inputs.taxRules, 'CITY', city, filingStatus) : [];
  // LTCG schedule seeded by migration 0032 under jurisdiction_type
  // 'FEDERAL_LTCG'. Fixtures + older tax years that don't seed it fall
  // through to []; computeTotalTax treats an empty/absent ltcgBrackets
  // as "no LTCG schedule — taxed at ordinary brackets like the legacy code".
  const ltcgBrackets = pickBrackets(inputs.taxRules, 'FEDERAL_LTCG', 'US', filingStatus);

  const taxBrackets: RealStateTaxBrackets = {
    federal,
    state: stateBrackets,
    city: cityBrackets.length > 0 ? cityBrackets : null,
    ltcg: ltcgBrackets,
    standardDeduction: {
      federal: pickStandardDeductionFor(inputs.taxRules, 'FEDERAL', 'US', filingStatus),
      state: state ? pickStandardDeductionFor(inputs.taxRules, 'STATE', state, filingStatus) : 0,
      city: city ? pickStandardDeductionFor(inputs.taxRules, 'CITY', city, filingStatus) : 0,
    },
  };

  const { initialCash, initialInvestmentsByAccount, cashAccountsWithBalances } = computeInitialBalances(
    inputs.accounts,
    inputs.accountSnapshots ?? [],
    inputs.holdings,
    inputs.startISO,
  );

  // Group accounts by tax bucket. Cash accounts (CHECKING + SAVINGS) end up in
  // the `cash` bucket and are informational only — applyGapAllocation routes
  // leftover dollars into `s.cash` (a scalar), not per-cash-account.
  const accountsByBucket = {
    taxAdvantaged: [] as Account[],
    brokerage:     [] as Account[],
    cash:          [] as Account[],
  };
  for (const account of inputs.accounts) {
    if (account.excludedFromNetWorth) continue;
    const bucket = taxBucketForAccount(account);
    if (bucket === 'taxAdvantaged') accountsByBucket.taxAdvantaged.push(account);
    else if (bucket === 'taxable')   accountsByBucket.brokerage.push(account);
    else if (isCashAccount(account)) accountsByBucket.cash.push(account);
    // null + non-cash (rare — e.g., property accounts) are intentionally
    // dropped; they're not part of the surplus-routing model.
  }

  const categories = inputs.categories ?? [];
  const expenseBasis = {
    latestMonth: latestCompleteMonthBaseline(inputs.transactions, categories, inputs.startISO),
    rolling12m: rolling12mBaseline(inputs.transactions, categories, inputs.startISO),
  };

  return {
    accounts: inputs.accounts,
    holdings: inputs.holdings,
    loans: inputs.loans,
    loanPayments: inputs.loanPayments,
    household: inputs.household,
    persons: inputs.persons,
    accountsByBucket,
    initialCash,
    initialInvestmentsByAccount,
    cashAccountsWithBalances,
    defaults: {
      inflation: inputs.appSettings.defaultInflation,
      returnRate: inputs.appSettings.defaultReturnRate,
      defaultCashApy: inputs.appSettings.defaultCashApy ?? null,
      defaultDrawdownTaxRate: inputs.appSettings.defaultDrawdownTaxRate ?? null,
    },
    startISO: inputs.startISO,
    taxBrackets,
    housingPayments: inputs.housingPayments ?? [],
    vehicleLeases: inputs.vehicleLeases ?? [],
    expenseBasis,
  };
}
