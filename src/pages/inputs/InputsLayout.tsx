import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { getGlossaryEntry } from '@/lib/glossary';

interface TabDef {
  path: string;
  label: string;
  /**
   * Optional glossary key. If set, the tab's label gets a native-`title`
   * hover hint sourced from `src/lib/glossary.ts` so a non-financial friend
   * can hover/tap and learn what "Tickers" / "529 Plans" mean without
   * losing the literal label — per user directive, no rename.
   */
  glossaryTerm?: string;
}

const tabs: TabDef[] = [
  { path: 'household', label: 'Household' },
  { path: 'persons', label: 'Persons' },
  { path: 'dependents', label: 'Dependents' },
  { path: 'accounts', label: 'Accounts' },
  { path: 'holdings', label: 'Holdings' },
  { path: 'contributions', label: 'Contributions' },
  { path: 'loans', label: 'Loans' },
  { path: 'equity-grants', label: 'Equity Grants', glossaryTerm: 'RSU' },
  { path: 'properties', label: 'Properties' },
  { path: 'housing-payments', label: 'Rent / Housing' },
  { path: 'vehicles', label: 'Vehicles' },
  { path: 'vehicle-leases', label: 'Vehicle Leases' },
  { path: 'goals', label: 'Goals' },
  { path: 'plans-529', label: '529 Plans', glossaryTerm: '529 PLAN' },
  { path: 'growth-tax', label: 'Growth & Tax', glossaryTerm: 'GROWTH & TAX' },
  { path: 'categories', label: 'Categories' },
  { path: 'tickers', label: 'Tickers', glossaryTerm: 'TICKERS' },
];

export default function InputsLayout() {
  return (
    <div className="flex h-full">
      <nav className="w-48 border-r p-2 flex flex-col gap-1 overflow-y-auto">
        <div className="px-3 pt-2 pb-1 text-xs uppercase tracking-wider text-muted-foreground">
          Input categories
        </div>
        {tabs.map((t) => {
          const entry = t.glossaryTerm ? getGlossaryEntry(t.glossaryTerm) : null;
          return (
            <NavLink
              key={t.path}
              to={`/inputs/${t.path}`}
              title={entry ? entry.shortDefinition : undefined}
              className={({ isActive }) =>
                cn(
                  'px-3 py-1.5 rounded-md text-sm transition',
                  isActive
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'hover:bg-accent text-foreground'
                )
              }
            >
              {t.label}
            </NavLink>
          );
        })}
      </nav>
      <div className="flex-1 min-w-0 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}
