import { useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings-store';
import { applySidebarLayout } from '@/lib/sidebar-layout';
import { getGlossaryEntry } from '@/lib/glossary';

interface NavItem {
  to: string;
  label: string;
  icon: string;
  /**
   * Optional glossary lookup key. When set, the nav item gets a native
   * `title` tooltip with the term's short definition — keeps the proper
   * label visible (per user directive) while giving non-financial friends
   * an explanation on hover/tap.
   */
  glossaryTerm?: string;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

export const DEFAULT_SECTIONS: NavSection[] = [
  {
    label: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: '📊' },
      { to: '/net-worth', label: 'Net Worth', icon: '💎' },
      { to: '/budget', label: 'Budget', icon: '📋' },
    ],
  },
  {
    label: 'Money',
    items: [
      { to: '/investments', label: 'Investments', icon: '📈' },
      { to: '/loans', label: 'Loans', icon: '💳' },
      { to: '/property', label: 'Property', icon: '🏠' },
      { to: '/vehicles', label: 'Vehicles', icon: '🚗' },
      { to: '/equity-grants', label: 'Equity Grants', icon: '🎁', glossaryTerm: 'RSU' },
      { to: '/spending', label: 'Spending', icon: '💸' },
    ],
  },
  {
    label: 'Planning',
    items: [
      { to: '/goals', label: 'Goals', icon: '🎯' },
      { to: '/roadmap', label: 'Roadmap', icon: '🧭' },
      { to: '/calculators', label: 'Calculators', icon: '🧮' },
      { to: '/what-if', label: 'What-If', icon: '🔀' },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/inputs', label: 'Inputs', icon: '📝' },
      { to: '/settings', label: 'Settings', icon: '⚙️' },
    ],
  },
];

export default function Sidebar() {
  const layout = useSettingsStore((s) => s.settings?.sidebarLayout ?? null);
  const load = useSettingsStore((s) => s.load);

  // Sidebar is always mounted (PageShell), so loading the settings store
  // here makes the layout overlay take effect on every page. load()
  // swallows its own errors — a missing DB during tests is harmless.
  useEffect(() => {
    void load();
  }, [load]);

  const sections = applySidebarLayout(DEFAULT_SECTIONS, layout);

  return (
    <aside className="w-56 border-r bg-card p-2 flex flex-col gap-1 overflow-y-auto">
      {sections.map((s) => (
        <div key={s.label} className="mb-2">
          <div className="px-3 pt-3 pb-1 text-xs uppercase tracking-wider text-muted-foreground">
            {s.label}
          </div>
          {s.items.map((i) => {
            const entry = i.glossaryTerm ? getGlossaryEntry(i.glossaryTerm) : null;
            return (
              <NavLink
                key={i.to}
                to={i.to}
                end={i.to === '/'}
                title={entry ? entry.shortDefinition : undefined}
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
            );
          })}
        </div>
      ))}
    </aside>
  );
}
