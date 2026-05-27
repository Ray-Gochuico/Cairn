import type { Account, AccountSnapshot, Holding, Loan, LoanPayment, Transaction, Household, Person, TaxRule, JurisdictionType } from '@/types/schema';
import type { Bracket } from '@/lib/tax';
import { AccountType, type FilingStatus } from '@/types/enums';
import { taxBucketForAccount } from '@/lib/account-tax-classification';

export interface AppSettingsSlice {
  defaultInflation: number;
  defaultReturnRate: number;
  defaultCashApy: number | null;
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
}

export interface RealStateTaxBrackets {
  federal: Bracket[];
  state: Bracket[];
  city: Bracket[] | null;
  standardDeduction: number;
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
  };
  startISO: string;
  taxBrackets: RealStateTaxBrackets;
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

function pickStandardDeduction(rules: TaxRule[], filingStatus: FilingStatus): number {
  const fed = rules.find(
    (r) => r.jurisdictionType === 'FEDERAL' && r.filingStatus === filingStatus,
  );
  return fed?.standardDeduction ?? 0;
}

export function captureRealState(inputs: RealStateInputs): RealState {
  const filingStatus = inputs.household.filingStatus as FilingStatus;
  const state = (inputs.household as { state?: string | null }).state ?? null;
  const city = (inputs.household as { city?: string | null }).city ?? null;

  const federal = pickBrackets(inputs.taxRules, 'FEDERAL', 'US', filingStatus);
  const stateBrackets = state ? pickBrackets(inputs.taxRules, 'STATE', state, filingStatus) : [];
  const cityBrackets = city ? pickBrackets(inputs.taxRules, 'CITY', city, filingStatus) : [];

  const taxBrackets: RealStateTaxBrackets = {
    federal,
    state: stateBrackets,
    city: cityBrackets.length > 0 ? cityBrackets : null,
    standardDeduction: pickStandardDeduction(inputs.taxRules, filingStatus),
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
    },
    startISO: inputs.startISO,
    taxBrackets,
  };
}
