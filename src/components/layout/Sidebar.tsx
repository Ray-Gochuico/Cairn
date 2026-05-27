import { useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Gem,
  ClipboardList,
  TrendingUp,
  CreditCard,
  Home,
  Car,
  Gift,
  Wallet,
  Target,
  Compass,
  Calculator,
  GitBranch,
  PenSquare,
  Settings as SettingsIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings-store';
import { applySidebarLayout, type SidebarSectionShape } from '@/lib/sidebar-layout';
import { getGlossaryEntry } from '@/lib/glossary';

/**
 * Default sidebar grouping. The icons swapped from emoji to lucide-react
 * components in the 2026-05-27 design polish — lucide gives consistent
 * stroke weight + size and survives font-fallback (some Linux/X11 setups
 * rendered the old emoji as monochrome glyphs that visually clashed with
 * the rest of the chrome). `aria-hidden` is set at the render site since
 * the text label carries semantics.
 */
export const DEFAULT_SECTIONS: SidebarSectionShape[] = [
  {
    label: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/net-worth', label: 'Net Worth', icon: Gem },
      { to: '/budget', label: 'Budget', icon: ClipboardList },
    ],
  },
  {
    label: 'Money',
    items: [
      { to: '/investments', label: 'Investments', icon: TrendingUp },
      { to: '/loans', label: 'Loans', icon: CreditCard },
      { to: '/property', label: 'Property', icon: Home },
      { to: '/vehicles', label: 'Vehicles', icon: Car },
      { to: '/equity-grants', label: 'Equity Grants', icon: Gift, glossaryTerm: 'RSU' },
      { to: '/spending', label: 'Spending', icon: Wallet },
    ],
  },
  {
    label: 'Planning',
    items: [
      { to: '/goals', label: 'Goals', icon: Target },
      { to: '/roadmap', label: 'Roadmap', icon: Compass },
      { to: '/calculators', label: 'Calculators', icon: Calculator },
      { to: '/what-if', label: 'What-If', icon: GitBranch },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/inputs', label: 'Inputs', icon: PenSquare },
      { to: '/settings', label: 'Settings', icon: SettingsIcon },
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
            const Icon = i.icon;
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
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{i.label}</span>
              </NavLink>
            );
          })}
        </div>
      ))}
    </aside>
  );
}
