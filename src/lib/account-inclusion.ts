/**
 * Net-worth inclusion semantics for accounts, shared by every aggregate that
 * must honor the "Excluded from net worth" checkbox (AccountForm). The
 * AssetValueChart already filters `excludedFromNetWorth` when building its
 * eligible-entity set; these helpers give every OTHER seam — dashboard pills,
 * growth cards, the roadmap cash reserve — the same one-line semantics so
 * the numbers agree across surfaces. (Calculator prefills do NOT use these:
 * they need the retirement-FI INCLUDED set — see src/lib/fi-portfolio.ts.)
 *
 * Excluded-SET (not included-set) filtering: `filterSnapshotsForNetWorth`
 * drops only snapshots that provably belong to an excluded account. Snapshots
 * whose accountId is not present in `accounts` pass through — so an empty /
 * not-yet-hydrated accounts store degrades to "no filtering" instead of
 * zeroing every aggregate while stores load.
 */

export interface NetWorthInclusionAccount {
  id?: number | null;
  excludedFromNetWorth: boolean;
}

/** Ids of accounts that count toward net-worth-style aggregates. */
export function includedAccountIds(
  accounts: ReadonlyArray<NetWorthInclusionAccount>,
): Set<number> {
  const out = new Set<number>();
  for (const a of accounts) {
    if (a.id != null && !a.excludedFromNetWorth) out.add(a.id);
  }
  return out;
}

/** Snapshot-shaped rows minus those belonging to excluded accounts. */
export function filterSnapshotsForNetWorth<S extends { accountId: number }>(
  snapshots: ReadonlyArray<S>,
  accounts: ReadonlyArray<NetWorthInclusionAccount>,
): S[] {
  const excluded = new Set<number>();
  for (const a of accounts) {
    if (a.id != null && a.excludedFromNetWorth) excluded.add(a.id);
  }
  return snapshots.filter((s) => !excluded.has(s.accountId));
}
