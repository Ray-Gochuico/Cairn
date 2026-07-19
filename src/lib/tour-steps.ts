/**
 * Tour step content + the curated-core flag, decoupled from the overlay so
 * the selection logic (deriveTourSteps) is pure and unit-testable — jsdom
 * can't measure geometry, so this is where the tour's testable behavior lives.
 *
 * One entry per DEFAULT_SECTIONS tab (kept in lockstep with the sidebar — a
 * test asserts full coverage). `core: true` marks the six tabs the forced
 * walk visits: Dashboard, Net Worth, Budget, Investments, Calculators,
 * Settings (the rest are reachable only via "See the rest →").
 */
export interface TourStep {
  /** Matches a SidebarLink `to` / `data-tour-id` and a TOUR config order. */
  to: string;
  title: string;
  body: string;
  /** True for the six curated-core tabs the forced tour always visits. */
  core: boolean;
}

/**
 * Authoring order MUST mirror DEFAULT_SECTIONS (Overview → Money → Planning
 * → System) so deriveTourSteps yields sidebar order without re-sorting. A
 * test (`tour-steps.test.ts`) fails if a tab is added to the sidebar without
 * a matching step here.
 */
export const TOUR_STEPS: TourStep[] = [
  // Overview
  {
    to: '/',
    title: 'Your dashboard',
    body: 'Your financial home base — net worth, recent activity, and your next suggested move, all in one place.',
    core: true,
  },
  {
    to: '/net-worth',
    title: 'Net worth',
    body: 'Everything you own and owe, over time — flip the hero to "Investment accounts" for that slice alone.',
    core: true,
  },
  {
    to: '/budget',
    title: 'Budget',
    body: 'Plan spending by category and compare your plan against what actually happened each month.',
    core: true,
  },
  // Money
  {
    to: '/investments',
    title: 'Investments',
    body: 'Allocation, drift, and growth — and manage accounts, holdings, and tickers on this page too.',
    core: true,
  },
  {
    to: '/loans',
    title: 'Loans',
    body: 'Mortgages, auto, and student loans — payoff timelines, with add and edit right here.',
    core: false,
  },
  {
    to: '/property',
    title: 'Property',
    body: 'Homes and real estate you own, edited where you see them.',
    core: false,
  },
  {
    to: '/vehicles',
    title: 'Vehicles',
    body: 'Cars and other vehicles, including leases — add or edit them right here.',
    core: false,
  },
  {
    to: '/equity-grants',
    title: 'Equity grants',
    body: 'RSUs, options, and other equity comp, with vesting schedules — managed right here.',
    core: false,
  },
  {
    to: '/spending',
    title: 'Spending',
    body: 'Your transactions, categorized — the raw activity behind your budget.',
    core: false,
  },
  // Planning
  {
    to: '/goals',
    title: 'Goals',
    body: 'Savings targets and 529 plans — set and edit each one in place.',
    core: false,
  },
  {
    to: '/roadmap',
    title: 'Roadmap',
    body: 'A prioritized sequence of money moves tailored to your situation.',
    core: false,
  },
  {
    to: '/learn',
    title: 'Learn',
    body: 'A few quick questions each day to sharpen your financial know-how.',
    core: false,
  },
  {
    to: '/calculators',
    title: 'Calculators',
    body: 'Paycheck, FIRE, compound interest, and more — model the numbers behind your decisions.',
    core: true,
  },
  {
    to: '/what-if',
    title: 'What-If',
    body: 'Compare scenarios side by side to see how a raise, a move, or a market change plays out.',
    core: false,
  },
  // Wave 18 C9: the dedicated Backtest sidebar entry (and so its tour step)
  // is retired — the tool is reached through the Calculators waymark card.
  // System
  {
    to: '/monthly',
    title: 'Monthly check-in',
    body: "Once a month, confirm last month's balances here — a dot on this tab means input is waiting.",
    core: false,
  },
  {
    to: '/inputs',
    title: 'Setup',
    body: 'The shared basics — your household, people, dependents, and spending categories. Everything else is edited where you see it.',
    core: false,
  },
  {
    to: '/settings',
    title: 'Settings',
    body: "Appearance, notifications, and which tabs and tools you see. You can replay this tour here anytime.",
    core: true,
  },
];

/**
 * The ordered step list for the current tour pass.
 *
 *   - 'core':    the curated-core tabs that are also currently visible
 *                (core ∩ visibleTos) — the forced walk, ≤6 steps.
 *   - 'all':     every visible tab that has a config entry (visibleTos ∩ config)
 *                — full set including core; used only for computing counts and
 *                finding the first non-core index.
 *   - 'noncore': visible tabs that are NOT core (visibleTos ∩ config ∩ !core)
 *                — the step list actually walked after "See the rest →".
 *
 * Iterates TOUR_STEPS (not visibleTos), so the result is always in sidebar
 * (config) order, an *intersection* (a visible `to` with no step is dropped),
 * and duplicate-safe regardless of the caller's input order. `visibleTos`
 * comes from `applySidebarLayout(DEFAULT_SECTIONS, settings.sidebarLayout)`.
 */
export function deriveTourSteps(
  visibleTos: string[],
  mode: 'core' | 'all' | 'noncore',
): TourStep[] {
  const visible = new Set(visibleTos);
  return TOUR_STEPS.filter((step) => {
    if (!visible.has(step.to)) return false;
    if (mode === 'core') return step.core;
    if (mode === 'noncore') return !step.core;
    return true; // 'all'
  });
}
