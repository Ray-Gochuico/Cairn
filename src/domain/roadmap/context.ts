import { useMemo } from 'react';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useLoansStore } from '@/stores/loans-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useCategoriesStore } from '@/stores/categories-store';
import { useRoadmapOverridesStore } from '@/stores/roadmap-overrides-store';
import type { RoadmapContext } from '@/types/roadmap';
import { getInterestThresholds } from './thresholds';
import { useLocalToday } from '@/lib/use-local-today';
import { dateFromLocalISO } from '@/lib/dates';

/**
 * Assembles a fresh RoadmapContext from the stores. Returns `null` if
 * the household hasn't loaded yet (caller should fall through to a
 * "loading" affordance). Re-memoised whenever any source store
 * changes, so consumers get free reactivity.
 *
 * `today` follows useLocalToday (Wave 11 T10): the rule ENGINE stays
 * injected-date pure (it just reads ctx.today), while this page-side memo
 * re-derives the context at the local midnight flip.
 */
export function useRoadmap(): RoadmapContext | null {
  const household = useHouseholdStore((s) => s.household);
  const persons = usePersonsStore((s) => s.persons);
  const accounts = useAccountsStore((s) => s.accounts);
  const loans = useLoansStore((s) => s.loans);
  const contributions = useContributionsStore((s) => s.contributions);
  const snapshots = useSnapshotsStore((s) => s.snapshots);
  const transactions = useTransactionsStore((s) => s.transactions);
  const categories = useCategoriesStore((s) => s.categories);
  const overrides = useRoadmapOverridesStore((s) => s.overridesByNodeId);
  const todayISO = useLocalToday();

  return useMemo(() => {
    if (!household) return null;
    return {
      household,
      persons,
      accounts,
      loans,
      contributions,
      snapshots,
      transactions,
      categories,
      overrides,
      thresholds: getInterestThresholds(household),
      taxYear: 2026 as const,
      today: dateFromLocalISO(todayISO),
    };
  }, [household, persons, accounts, loans, contributions, snapshots, transactions, categories, overrides, todayISO]);
}
