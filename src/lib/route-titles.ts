/**
 * Route → human title map for document.title (Wave-4 a11y: SPA route
 * changes are invisible to screen readers without a title change; SRs
 * announce the new title when focus moves into <main> — see PageShell).
 * Kept as a plain table (not derived from the router) so it is pure and
 * unit-testable; App.tsx's route list is the source — update BOTH when
 * adding a route. The tripwire is REAL (Wave-5 R4): tests/lib/
 * route-titles.test.ts walks the route paths actually registered in
 * App.tsx and fails when a registered route lacks an exact entry here or
 * an entry here goes stale. Display names mirror each page's h1 / sidebar label
 * (Sidebar.tsx, InputsLayout.tsx) so the announced title matches what
 * sighted users see.
 */
const TITLES: Record<string, string> = {
  '/': 'Dashboard',
  '/net-worth': 'Net Worth',
  '/investments': 'Investments',
  '/loans': 'Loans',
  '/property': 'Property',
  '/vehicles': 'Vehicles',
  '/equity-grants': 'Equity Grants',
  '/spending': 'Spending',
  '/spending/transactions': 'Transactions',
  '/budget': 'Budget',
  '/goals': 'Goals',
  '/roadmap': 'Roadmap',
  '/learn': 'Learn',
  '/calculators': 'Calculators',
  '/calculators/paycheck': 'Paycheck calculator',
  '/calculators/backtest': 'Historical Backtest',
  '/what-if': 'What-If',
  '/settings': 'Settings',
  '/monthly': 'Monthly check-in',
  '/setup': 'Setup',
  '/welcome': 'Welcome',
  '/inputs': 'Inputs',
  '/inputs/household': 'Inputs · Household',
  '/inputs/persons': 'Inputs · Persons',
  '/inputs/dependents': 'Inputs · Dependents',
  '/inputs/categories': 'Inputs · Categories',
  // W14 redirect stubs (App.tsx routes them via <Navigate> to each entity's
  // new home) — titled as their destinations so the tripwire stays exact and
  // a mid-redirect announcement never says a retired tab name.
  '/inputs/loans': 'Loans', // W14 redirect stub
  '/inputs/properties': 'Property', // W14 redirect stub
  '/inputs/housing-payments': 'Property', // W14 redirect stub
  '/inputs/vehicles': 'Vehicles', // W14 redirect stub
  '/inputs/vehicle-leases': 'Vehicles', // W14 redirect stub
  '/inputs/equity-grants': 'Equity Grants', // W14 redirect stub
  '/inputs/goals': 'Goals', // W14 redirect stub
  '/inputs/plans-529': 'Goals', // W14 redirect stub
  '/inputs/accounts': 'Investments', // W14 redirect stub
  '/inputs/holdings': 'Investments', // W14 redirect stub
  '/inputs/contributions': 'Investments', // W14 redirect stub
  '/inputs/tickers': 'Investments', // W14 redirect stub
};

/**
 * Read-only view of the exact-match keys, for the App.tsx↔TITLES parity
 * test (R4). `titleForPath`'s ancestor fallback would mask a missing entry
 * for a new nested route, so the tripwire needs exact-key visibility.
 */
export function knownTitlePaths(): string[] {
  return Object.keys(TITLES);
}

/** Exact match first, then walk up path segments; null when nothing matches. */
export function titleForPath(pathname: string): string | null {
  let p = pathname.replace(/\/+$/, '') || '/';
  const exact = TITLES[p];
  if (exact) return exact;
  // Walk up segments, but never fall back to the root — '/' (Dashboard)
  // is an exact match only, so unknown top-level paths return null and
  // documentTitleFor renders the bare app name instead of lying.
  while (true) {
    const cut = p.lastIndexOf('/');
    if (cut <= 0) return null;
    p = p.slice(0, cut);
    const hit = TITLES[p];
    if (hit) return hit;
  }
}

export function documentTitleFor(pathname: string): string {
  const title = titleForPath(pathname);
  return title ? `${title} · Cairn` : 'Cairn';
}
