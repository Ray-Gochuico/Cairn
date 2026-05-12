import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';

interface NavItem {
  to: string;
  label: string;
  icon: string;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const sections: NavSection[] = [
  {
    label: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: '📊' },
      { to: '/net-worth', label: 'Net Worth', icon: '💎' },
    ],
  },
  {
    label: 'Money',
    items: [
      { to: '/investments', label: 'Investments', icon: '📈' },
      { to: '/loans', label: 'Loans', icon: '💳' },
      { to: '/property-vehicles', label: 'Property & Vehicles', icon: '🏠' },
      { to: '/equity-grants', label: 'Equity Grants', icon: '🎁' },
      { to: '/spending', label: 'Spending', icon: '💸' },
    ],
  },
  {
    label: 'Planning',
    items: [
      { to: '/goals', label: 'Goals', icon: '🎯' },
      { to: '/calculators', label: 'Calculators', icon: '🧮' },
      { to: '/what-if', label: 'What-If', icon: '🔀' },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/inputs', label: 'Inputs', icon: '📝' },
      { to: '/profile', label: 'Profile', icon: '⚙️' },
    ],
  },
];

export default function Sidebar() {
  return (
    <aside className="w-56 border-r bg-card p-2 flex flex-col gap-1 overflow-y-auto">
      {sections.map((s) => (
        <div key={s.label} className="mb-2">
          <div className="px-3 pt-3 pb-1 text-xs uppercase tracking-wider text-muted-foreground">
            {s.label}
          </div>
          {s.items.map((i) => (
            <NavLink
              key={i.to}
              to={i.to}
              end={i.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 px-3 py-2 rounded-md text-sm transition',
                  isActive
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'hover:bg-accent text-foreground'
                )
              }
            >
              <span>{i.icon}</span>
              <span>{i.label}</span>
            </NavLink>
          ))}
        </div>
      ))}
    </aside>
  );
}
