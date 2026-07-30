import { useViewFilter, type ViewFilter } from './use-view-filter';

export interface ViewScope {
  filter: ViewFilter;
  /** true when any p1/p2/joint view is active. */
  isFiltered: boolean;
  /** Selected person's name in p1/p2 views; null in household/joint. */
  personName: string | null;
  /** The non-selected person's name in p1/p2 views; null otherwise. */
  otherName: string | null;
  /** 'Household' | person name | 'Joint' — the label captions build from. */
  scopeLabel: string;
  isAvailable: boolean;
  persons: ReturnType<typeof useViewFilter>['persons'];
  setFilter: (v: ViewFilter) => void;
}

/**
 * Thin caption-vocabulary wrapper over useViewFilter (Wave A). Derives
 * names/labels every consumer used to hand-roll. Deliberately does NOT
 * load any store (shared-store gate boot-loop gotcha) — persons are loaded
 * once in PageShell; this hook only reads.
 */
export function useViewScope(): ViewScope {
  const { filter, setFilter, isAvailable, persons } = useViewFilter();
  const p1 = persons[0]?.name ?? 'Person 1';
  const p2 = persons[1]?.name ?? 'Person 2';
  const personName = filter === 'p1' ? p1 : filter === 'p2' ? p2 : null;
  const otherName = filter === 'p1' ? p2 : filter === 'p2' ? p1 : null;
  const scopeLabel = filter === 'joint' ? 'Joint' : (personName ?? 'Household');
  return { filter, isFiltered: filter !== 'household', personName, otherName, scopeLabel, isAvailable, persons, setFilter };
}
