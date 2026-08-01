import { useViewFilter, type ViewFilter as ViewFilterType } from '@/lib/use-view-filter';
import { useLocation } from 'react-router-dom';

const HIDDEN_PATH_PREFIXES = ['/inputs', '/setup', '/settings', '/learn', '/what-if', '/roadmap', '/calculators/paycheck'];
// Wave B (D-B12): /calculators (the grid) carries its OWN scope control in
// the ScenarioBar bound to the same ?view= state — hide only the redundant
// header copy there. EXACT match: /calculators/backtest keeps the header
// filter (it IS that page's scope control; the Backtest bridge honors it).
const HIDDEN_EXACT_PATHS = ['/calculators'];

export function ViewFilter() {
  const { filter, setFilter, isAvailable, persons } = useViewFilter();
  const location = useLocation();
  if (!isAvailable) return null;
  if (
    HIDDEN_PATH_PREFIXES.some((p) => location.pathname.startsWith(p)) ||
    HIDDEN_EXACT_PATHS.includes(location.pathname)
  )
    return null;

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
