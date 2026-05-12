import { NavLink, Routes, Route, Navigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import HouseholdTab from './HouseholdTab';
import PersonsTab from './PersonsTab';
import DependentsTab from './DependentsTab';
import ComingSoonTab from './tabs-coming-soon';

interface TabDef {
  path: string;
  label: string;
  element: React.ReactNode;
}

const tabs: TabDef[] = [
  { path: 'household', label: 'Household', element: <HouseholdTab /> },
  { path: 'persons', label: 'Persons', element: <PersonsTab /> },
  { path: 'dependents', label: 'Dependents', element: <DependentsTab /> },
  { path: 'accounts', label: 'Accounts', element: <ComingSoonTab name="Accounts" phase={2} /> },
  { path: 'holdings', label: 'Holdings', element: <ComingSoonTab name="Holdings" phase={2} /> },
  { path: 'contributions', label: 'Contributions', element: <ComingSoonTab name="Contributions" phase={2} /> },
  { path: 'loans', label: 'Loans', element: <ComingSoonTab name="Loans" phase={2} /> },
  { path: 'equity-grants', label: 'Equity Grants', element: <ComingSoonTab name="Equity Grants" phase={3} /> },
  { path: 'properties', label: 'Properties', element: <ComingSoonTab name="Properties" phase={2} /> },
  { path: 'vehicles', label: 'Vehicles', element: <ComingSoonTab name="Vehicles" phase={2} /> },
  { path: 'goals', label: 'Goals', element: <ComingSoonTab name="Goals" phase={3} /> },
  { path: 'plans-529', label: '529 Plans', element: <ComingSoonTab name="529 Plans" phase={3} /> },
  { path: 'growth-tax', label: 'Growth & Tax', element: <ComingSoonTab name="Growth & Tax" phase={3} /> },
  { path: 'categories', label: 'Categories', element: <ComingSoonTab name="Categories" phase={4} /> },
  { path: 'tickers', label: 'Tickers', element: <ComingSoonTab name="Tickers" phase={3} /> },
];

export default function InputsLayout() {
  return (
    <div className="flex h-full">
      <nav className="w-48 border-r p-2 flex flex-col gap-1 overflow-y-auto">
        <div className="px-3 pt-2 pb-1 text-xs uppercase tracking-wider text-muted-foreground">
          Input categories
        </div>
        {tabs.map((t) => (
          <NavLink
            key={t.path}
            to={t.path}
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
        ))}
      </nav>
      <div className="flex-1 overflow-y-auto">
        <Routes>
          <Route index element={<Navigate to="household" replace />} />
          {tabs.map((t) => (
            <Route key={t.path} path={t.path} element={t.element} />
          ))}
        </Routes>
      </div>
    </div>
  );
}
