import type { Contribution, Household } from '@/types/schema';
import { minusMonths } from '@/lib/growth-horizons';

/**
 * Round-3 E7: `pickModerateRate` and `monthlyContributionAvg` were
 * byte-identical page-local copies across Goals/Dashboard/Investments (with a
 * fourth inline near-copy in FinancialIndependenceCard) — one home so the
 * surfaces can literally never drift on which scenario drives projections.
 */

/**
 * Pick the "moderate" entry from a labeled list: an entry labelled
 * 'Moderate' wins; otherwise the second entry, then the first. Generic so
 * both Household.growthScenarios and the FI card's computed series use the
 * same selection rule.
 */
export function pickModerateEntry<T extends { label: string }>(list: T[]): T | undefined {
  return list.find((s) => s.label === 'Moderate') ?? list[1] ?? list[0];
}

/**
 * Pick the growth rate to project against. Prefers an entry labelled
 * "Moderate"; falls back to the 2nd entry, then the 1st, then 6% if the
 * household has no scenarios at all. Defensive defaults matter here because
 * pages render before household.load() resolves.
 */
export function pickModerateRate(household: Household | null): number {
  const FALLBACK = 0.06;
  if (!household || household.growthScenarios.length === 0) return FALLBACK;
  return pickModerateEntry(household.growthScenarios)?.rate ?? FALLBACK;
}

/**
 * Average monthly contribution to a set of accounts over the last `monthsBack`
 * months. We sum contributions whose date falls within the window and divide
 * by `monthsBack` — months with no contributions still count as 0, so a one-
 * off $6k deposit averages to $1k/mo over 6 months.
 */
export function monthlyContributionAvg(
  contributions: Contribution[],
  linkedIds: number[],
  today: Date,
  monthsBack = 6,
): number {
  if (linkedIds.length === 0 || monthsBack <= 0) return 0;
  const cutoffIso = minusMonths(today, monthsBack);
  const linkedSet = new Set(linkedIds);
  const total = contributions
    .filter((c) => linkedSet.has(c.accountId) && c.date >= cutoffIso)
    .reduce((sum, c) => sum + c.amount, 0);
  return total / monthsBack;
}
