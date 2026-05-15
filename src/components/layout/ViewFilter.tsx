import { useViewFilter, type ViewFilter as ViewFilterType } from '@/lib/use-view-filter';
import { useLocation } from 'react-router-dom';

const HIDDEN_PATH_PREFIXES = ['/inputs', '/setup'];

export function ViewFilter() {
  const { filter, setFilter, isAvailable, persons } = useViewFilter();
  const location = useLocation();
  if (!isAvailable) return null;
  if (HIDDEN_PATH_PREFIXES.some((p) => location.pathname.startsWith(p))) return null;

  return (
    <select
      value={filter}
      onChange={(e) => setFilter(e.target.value as ViewFilterType)}
      className="text-sm border rounded-md px-2 py-1 bg-background"
      aria-label="Filter view by person"
    >
      <option value="household">Household</option>
      <option value="p1">{persons[0]?.name ?? 'Person 1'}</option>
      <option value="p2">{persons[1]?.name ?? 'Person 2'}</option>
      <option value="joint">Joint only</option>
    </select>
  );
}
