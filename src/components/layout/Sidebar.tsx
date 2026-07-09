import { memo, useEffect } from 'react';
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
  CalendarCheck,
  GraduationCap,
  GitBranch,
  History,
  PenSquare,
  Settings as SettingsIcon,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings-store';
import { useHousingPaymentsStore } from '@/stores/housing-payments-store';
import { useVehicleLeasesStore } from '@/stores/vehicle-leases-store';
import { applySidebarLayout, type SidebarSectionShape } from '@/lib/sidebar-layout';
import { getGlossaryEntry } from '@/lib/glossary';
import { useMonthlyInputPending } from './use-monthly-input-pending';

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
      { to: '/learn', label: 'Learn', icon: GraduationCap },
      { to: '/calculators', label: 'Calculators', icon: Calculator },
      { to: '/what-if', label: 'What-If', icon: GitBranch },
      { to: '/calculators/backtest', label: 'Backtest', icon: History },
    ],
  },
  {
    label: 'System',
    items: [
      // Monthly check-in leads the group — it's a recurring ACTION, above
      // the configuration pages. For users with a customized sidebar
      // layout, applySidebarLayout treats '/monthly' as an unknown id and
      // appends it after their ordered System items — accepted (their
      // saved order wins; the entry still shows up).
      { to: '/monthly', label: 'Monthly check-in', icon: CalendarCheck },
      { to: '/inputs', label: 'Inputs', icon: PenSquare },
      { to: '/settings', label: 'Settings', icon: SettingsIcon },
    ],
  },
];

interface SidebarLinkProps {
  to: string;
  label: string;
  icon: LucideIcon;
  glossaryTerm?: string;
  /** Warning-toned pending dot (monthly check-in). Boolean keeps memo effective. */
  showDot?: boolean;
}

/**
 * Wave-5 frontend A+ #3: a memoized navigation link. Its props are
 * effectively stable across re-renders (the `to`/`label`/`icon` for every
 * sidebar item come from the static DEFAULT_SECTIONS constant or a
 * persisted layout); the only thing that changes on route nav is the
 * NavLink's internal `isActive`, which react-router handles inside this
 * component. Memo-ing means that when the surrounding Sidebar re-renders
 * (e.g. settings store update for an unrelated field), the 14 sidebar
 * links don't all reconcile.
 */
const SidebarLink = memo(function SidebarLink({
  to,
  label,
  icon: Icon,
  glossaryTerm,
  showDot = false,
}: SidebarLinkProps) {
  const entry = glossaryTerm ? getGlossaryEntry(glossaryTerm) : null;
  return (
    <NavLink
      to={to}
      end={to === '/'}
      data-tour-id={to}
      title={entry ? entry.shortDefinition : undefined}
      className={({ isActive }) =>
        cn(
          // Wave-12 Trailhead Stone: the active mark is a 2px blaze left
          // edge (a trail blaze), not a filled pill. Every link reserves
          // the 2px edge (transparent when inactive) so activation never
          // shifts layout. Left corners stay square so the blaze reads as
          // a carved edge; the right side keeps the soft radius.
          'flex items-center gap-2 px-3 py-2 rounded-r-md border-l-2 text-sm transition',
          isActive
            ? 'border-blaze bg-accent font-medium text-foreground'
            : 'border-transparent hover:bg-accent text-foreground'
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{label}</span>
      {showDot && (
        <>
          <span
            // --chart-warning, not --warning: the raw amber fill token is
            // 2.13:1 on the light card — below the 3:1 non-text floor for
            // a meaningful indicator. The chart-stroke amber clears 3:1 on
            // both themes (globals.css, BT-5 family).
            className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-[hsl(var(--chart-warning))]"
            aria-hidden="true"
          />
          <span className="sr-only">, monthly input pending</span>
        </>
      )}
    </NavLink>
  );
});

export default function Sidebar() {
  const layout = useSettingsStore((s) => s.settings?.sidebarLayout ?? null);
  const load = useSettingsStore((s) => s.load);
  const loadHousingPayments = useHousingPaymentsStore((s) => s.load);
  const loadVehicleLeases = useVehicleLeasesStore((s) => s.load);
  const monthlyPending = useMonthlyInputPending();

  // Sidebar is always mounted (PageShell), so loading the settings store
  // here makes the layout overlay take effect on every page. load()
  // swallows its own errors — a missing DB during tests is harmless.
  //
  // 2026-05-27 v1.1: housing-payments + vehicle-leases stores are also
  // loaded here so the What-If engine's useRealState sees populated
  // arrays from first render (otherwise the projection wouldn't reflect
  // new rentals/leases until the user navigated to Property/Vehicles
  // and back).
  useEffect(() => {
    void load();
    void loadHousingPayments();
    void loadVehicleLeases();
  }, [load, loadHousingPayments, loadVehicleLeases]);

  const sections = applySidebarLayout(DEFAULT_SECTIONS, layout);

  return (
    <aside className="w-56 border-r bg-card p-2 flex flex-col gap-1 overflow-y-auto">
      {/* Wave-4 a11y: labeled nav landmark so AT users can jump straight to
          the primary navigation (covers every section incl. Monthly). */}
      <nav aria-label="Primary" className="flex flex-col gap-1">
        {sections.map((s) => (
          <div key={s.label} className="mb-2">
            <div className="px-3 pt-3 pb-1 text-xs uppercase tracking-wider text-muted-foreground">
              {s.label}
            </div>
            {s.items.map((i) => (
              <SidebarLink
                key={i.to}
                to={i.to}
                label={i.label}
                icon={i.icon}
                glossaryTerm={i.glossaryTerm}
                showDot={i.to === '/monthly' && monthlyPending}
              />
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
