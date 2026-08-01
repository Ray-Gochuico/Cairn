import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { usePersonsStore } from '@/stores/persons-store';
import { useViewFilter } from '@/lib/use-view-filter';
import type { Person } from '@/types/schema';
import { getCalcScopePersonId, subscribeCalcScope, syncCalcScope } from './calc-view-scope';

export interface CalcScope {
  /** null = household scope (also the degraded state for a stale id). */
  personId: number | null;
  isScoped: boolean;
  person: Person | null;
  otherPerson: Person | null;
  personName: string | null;
  otherName: string | null;
}

/**
 * Router-free scope read for every calculators consumer (D-B10). Derives
 * names from the already-loaded persons store — NO store loads here
 * (shared-store gate boot-loop gotcha); CalculatorsLayout/Backtest hydrate.
 */
export function useCalcScope(): CalcScope {
  const mirroredId = useSyncExternalStore(subscribeCalcScope, getCalcScopePersonId);
  const persons = usePersonsStore((s) => s.persons);
  return useMemo(() => {
    const person = mirroredId != null ? (persons.find((p) => p.id === mirroredId) ?? null) : null;
    const personId = person?.id ?? null; // stale id degrades to household
    const otherPerson = person != null ? (persons.find((p) => p.id !== person.id) ?? null) : null;
    return {
      personId,
      isScoped: personId != null,
      person,
      otherPerson,
      personName: person?.name ?? null,
      otherName: otherPerson?.name ?? null,
    };
  }, [mirroredId, persons]);
}

/**
 * The URL → mirror bridge (D-B10). Mount ONCE per calculators route
 * (CalculatorsLayout, the Backtest page). p1/p2 → the person id;
 * joint → household (D-B2); unavailable (<2 persons) → household.
 * The URL is the single source of truth — nothing here writes it.
 */
export function useCalcScopeUrlSync(): void {
  const { filter, persons, isAvailable } = useViewFilter();
  const p1Id = persons[0]?.id ?? null;
  const p2Id = persons[1]?.id ?? null;
  useEffect(() => {
    const id = !isAvailable ? null : filter === 'p1' ? p1Id : filter === 'p2' ? p2Id : null;
    syncCalcScope(id);
  }, [filter, isAvailable, p1Id, p2Id]);
}
