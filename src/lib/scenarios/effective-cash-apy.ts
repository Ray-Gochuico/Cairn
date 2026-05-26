import type { Account, AppSettings } from '@/types/schema';
import type { Scenario } from '@/types/scenario';

/**
 * Resolves the effective annual cash APY for a scenario.
 *
 * Resolution order:
 *  1. scenario.leverPayload.returns.cashRate (if set and non-null)
 *  2. Balance-weighted average across cash/savings accounts:
 *     Σ(balance × (account.apyRate ?? settings.defaultCashApy ?? 0)) / Σ(balance)
 *  3. 0 (zero growth fallback when no cash accounts or all balances are zero)
 *
 * The result is "frozen" at projection start — the engine does not re-weight
 * as balances shift during the projection.
 */
export function effectiveCashApy(
  scenario: Scenario | null,
  cashAccountsWithBalances: Array<{ account: Account; balance: number }>,
  settings: AppSettings | null,
): number {
  // Step 1: scenario-level override wins outright.
  if (scenario?.leverPayload?.returns?.cashRate != null) {
    return scenario.leverPayload.returns.cashRate;
  }

  // Step 2: balance-weighted average.
  const totalBalance = cashAccountsWithBalances.reduce((s, x) => s + x.balance, 0);
  if (totalBalance <= 0) return 0;

  const weighted = cashAccountsWithBalances.reduce((s, { account, balance }) => {
    const apy = account.apyRate ?? settings?.defaultCashApy ?? 0;
    return s + balance * apy;
  }, 0);

  return weighted / totalBalance;
}
