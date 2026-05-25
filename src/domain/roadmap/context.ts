import { useMemo } from 'react';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useLoansStore } from '@/stores/loans-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { useRoadmapOverridesStore } from '@/stores/roadmap-overrides-store';
import type { RoadmapContext } from '@/types/roadmap';
import { getInterestThresholds } from './thresholds';

/**
 * Assembles a fresh RoadmapContext from the stores. Returns `null` if
 * the household hasn't loaded yet (caller should fall through to a
 * "loading" affordance). Re-memoised whenever any source store
 * changes, so consumers get free reactivity.
 *
 * `today` is fixed at hook-mount time; the rule engine treats it as a
 * stable timestamp for the current evaluation pass. Time-of-day jitter
 * (rare across a single eval) is intentional — we want the value to be
 * deterministic per render.
 */
export function useRoadmap(): RoadmapContext | null {
  const household = useHouseholdStore((s) => s.household);
  const persons = usePersonsStore((s) => s.persons);
  const accounts = useAccountsStore((s) => s.accounts);
  const loans = useLoansStore((s) => s.loans);
  const contributions = useContributionsStore((s) => s.contributions);
  const snapshots = useSnapshotsStore((s) => s.snapshots);
  const transactions = useTransactionsStore((s) => s.transactions);
  const overrides = useRoadmapOverridesStore((s) => s.overridesByNodeId);

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
      overrides,
      thresholds: getInterestThresholds(household),
      taxYear: 2026 as const,
      today: new Date(),
    };
  }, [household, persons, accounts, loans, contributions, snapshots, transactions, overrides]);
}
