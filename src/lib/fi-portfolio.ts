import { AccountType } from '@/types/enums';
import type { Account } from '@/types/schema';
import { includedAccountIds } from '@/lib/account-inclusion';
import { sumLatestOnOrBefore } from '@/lib/growth-horizons';

/**
 * THE shared definition of "current portfolio" for retirement-FI surfaces
 * (Wave 2 trust-seams §1). Before this existed, four surfaces disagreed:
 * the FI/Coast/Compound calculator defaults summed EVERY account with a
 * snapshot (excluded-from-net-worth accounts and 529s included), while the
 * What-If FiCards used the projection seed (non-excluded, all types).
 *
 * FI-eligible = NOT excludedFromNetWorth, and NOT a 529:
 *  - excludedFromNetWorth is the user's "don't count this" — honored everywhere.
 *  - 529s are education-earmarked; retirement spend-down carries tax+penalty,
 *    so they can't back a retirement-FI number.
 *  - Cash/savings ARE eligible: FI targets measure liquid spend-down capacity,
 *    and the What-If FiCards' liquidNw counts cash — one definition, not two.
 *  - HSA and crypto are eligible for the same What-If-parity reason (HSA is
 *    a de-facto retirement account post-65).
 *
 * Deliberate outliers (documented at their definitions, not silently divergent):
 *  - Investments-page growth card: the ASSET-VALUE-CHART universe (wave-6
 *    round-2 A2) — every view-visible account that isn't excluded from net
 *    worth, ALL types (cash and 529 included), so the card can never
 *    disagree with the chart stacked above it. The chart's transient
 *    "Included" picker does not drive it. Not FI readiness.
 *  - What-If FiCards: derived from the projection seed (non-excluded, all
 *    types incl. 529) — restructuring the engine seed is out of scope.
 */
const FI_INELIGIBLE_TYPES: ReadonlySet<AccountType> = new Set([AccountType.ACCOUNT_529]);

export function fiEligibleAccountIds(accounts: ReadonlyArray<Account>): Set<number> {
  // Wave 1's shared excluded-from-net-worth filter handles the id/excluded
  // rules; this module only layers the retirement-FI type exclusion on top.
  const included = includedAccountIds(accounts);
  const ids = new Set<number>();
  for (const a of accounts) {
    if (a.id == null || !included.has(a.id)) continue;
    if (FI_INELIGIBLE_TYPES.has(a.type)) continue;
    ids.add(a.id);
  }
  return ids;
}

/**
 * Latest-snapshot-per-account sum across the FI-eligible set, as of
 * `todayIso`. Returns 0 (not null) when there is no qualifying history —
 * callers use this as an editable form default, where 0 is the honest
 * "nothing yet" prefill.
 */
export function fiEligiblePortfolioValue(
  accounts: ReadonlyArray<Account>,
  snapshots: ReadonlyArray<{ accountId: number; snapshotDate: string; totalValue: number }>,
  todayIso: string,
): number {
  // Always pass the id set — an undefined accountIds means "all accounts"
  // to sumLatestOnOrBefore, which is exactly the bug this module fixes.
  return sumLatestOnOrBefore(snapshots, todayIso, fiEligibleAccountIds(accounts)) ?? 0;
}
