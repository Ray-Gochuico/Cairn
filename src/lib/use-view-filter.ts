import { useSearchParams } from 'react-router-dom';
import { usePersonsStore } from '@/stores/persons-store';

export type ViewFilter = 'household' | 'p1' | 'p2' | 'joint';

/**
 * Reactive view filter used by Dashboard / NetWorth / Investments / Spending
 * / Loans / Vehicles / Goals (and other per-person/joint splits). Reads the
 * `?view=` query param and the current persons list.
 *
 * Selector hygiene (Wave-5 frontend A+ #2 / four-wave repeat finding):
 * the original `const { persons } = usePersonsStore()` destructured the
 * whole store on every render, which made every consuming page re-render
 * whenever ANY other persons-store field changed (isLoading flipping during
 * a load, error being cleared, etc.) — a measurable hot path because
 * Dashboard alone calls this hook + several `filterByView` helpers each
 * render. Narrowing to `s.persons` restricts the subscription to the only
 * field this hook actually reads.
 */
export function useViewFilter() {
  const [params, setParams] = useSearchParams();
  const persons = usePersonsStore((s) => s.persons);

  const raw = params.get('view');
  const filter: ViewFilter = raw === 'p1' || raw === 'p2' || raw === 'joint' ? raw : 'household';
  const isAvailable = persons.length === 2;

  const setFilter = (v: ViewFilter) => {
    if (!isAvailable) return;
    if (v === 'household') params.delete('view');
    else params.set('view', v);
    setParams(params);
  };

  return {
    filter: isAvailable ? filter : 'household',
    setFilter,
    isAvailable,
    persons,
  };
}
