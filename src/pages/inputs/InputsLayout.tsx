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

// W14 "one place per thing": every entity tab retired to its analysis page
// (loans → /loans, accounts/holdings/contributions/tickers → the Investments
// Manage surface, …). Only the truly-shared config remains — this hub is now
// the Setup residual.
const tabs: TabDef[] = [
  { path: 'household', label: 'Household' },
  { path: 'persons', label: 'Persons' },
  { path: 'dependents', label: 'Dependents' },
  { path: 'categories', label: 'Categories' },
];

export default function InputsLayout() {
  return (
    <div className="flex h-full">
      <nav aria-label="Setup" className="w-48 border-r p-2 flex flex-col gap-1 overflow-y-auto">
        <div className="px-3 pt-2 pb-1 text-xs uppercase tracking-wider text-muted-foreground">
          Setup
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
                  // Wave-12 Trailhead Stone: same 2px blaze left-edge active
                  // mark as the Sidebar (one nav system, one mark); every
                  // link reserves the edge so activation never shifts layout.
                  'px-3 py-1.5 rounded-r-md border-l-2 text-sm transition',
                  isActive
                    ? 'border-blaze bg-accent font-medium text-foreground'
                    : 'border-transparent hover:bg-accent text-foreground'
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
