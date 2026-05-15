import { useSearchParams } from 'react-router-dom';
import { usePersonsStore } from '@/stores/persons-store';

export type ViewFilter = 'household' | 'p1' | 'p2' | 'joint';

export function useViewFilter() {
  const [params, setParams] = useSearchParams();
  const { persons } = usePersonsStore();

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
