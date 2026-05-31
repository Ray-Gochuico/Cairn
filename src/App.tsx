import { lazy, Suspense } from 'react';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import PageShell from './components/layout/PageShell';
import PageLoadingSpinner from './components/layout/PageLoadingSpinner';

// All page-level routes are code-split via React.lazy(). Each becomes its own
// chunk under dist/assets/, downloaded on first visit. Suspense wraps every
// lazy element below with a <PageLoadingSpinner /> skeleton so the layout
// shell (sidebar + header) stays mounted while the page chunk arrives.
//
// PageShell itself is eagerly imported because it owns the persistent layout
// — lazy-loading the shell would defeat the point (the user would see a
// blank screen on first paint instead of the sidebar).
// Each lazy() is wrapped in lazyWithRetry: a failed dynamic import is almost
// always a STALE CHUNK — a new build / dev-server HMR re-hashed the chunk URLs,
// so a not-yet-loaded route's old URL now 404s ("Importing a module script
// failed"). Reload once to fetch the current manifest; a sessionStorage guard
// prevents a reload loop if a chunk is genuinely missing.
function lazyWithRetry<T extends React.ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    const RELOAD_KEY = 'lazy-chunk-reloaded';
    try {
      const mod = await importer();
      sessionStorage.removeItem(RELOAD_KEY); // success — reset for a future stale chunk
      return mod;
    } catch (err) {
      if (typeof window !== 'undefined' && !sessionStorage.getItem(RELOAD_KEY)) {
        sessionStorage.setItem(RELOAD_KEY, '1');
        window.location.reload();
        // Hold the Suspense fallback up while the reload happens.
        return new Promise<{ default: T }>(() => {});
      }
      throw err; // already reloaded once — surface the real error
    }
  });
}

const Dashboard = lazyWithRetry(() => import('./pages/Dashboard'));
const NetWorth = lazyWithRetry(() => import('./pages/NetWorth'));
const Investments = lazyWithRetry(() => import('./pages/Investments'));
const Loans = lazyWithRetry(() => import('./pages/Loans'));
const Property = lazyWithRetry(() => import('./pages/Property'));
const Vehicles = lazyWithRetry(() => import('./pages/Vehicles'));
const EquityGrants = lazyWithRetry(() => import('./pages/EquityGrants'));
const Spending = lazyWithRetry(() => import('./pages/Spending'));
const SpendingTransactions = lazyWithRetry(() => import('./pages/SpendingTransactions'));
const Budget = lazyWithRetry(() => import('./pages/Budget'));
const Goals = lazyWithRetry(() => import('./pages/Goals'));
const Roadmap = lazyWithRetry(() => import('./pages/Roadmap'));
const Learn = lazyWithRetry(() => import('./pages/Learn'));
const CalculatorsLayout = lazyWithRetry(() => import('./pages/calculators/CalculatorsLayout'));
const WhatIf = lazyWithRetry(() => import('./pages/WhatIf'));
const Settings = lazyWithRetry(() => import('./pages/Settings'));
const MonthlyMiniWindow = lazyWithRetry(() => import('./pages/MonthlyMiniWindow'));
const InputsLayout = lazyWithRetry(() => import('./pages/inputs/InputsLayout'));
const HouseholdTab = lazyWithRetry(() => import('./pages/inputs/HouseholdTab'));
const PersonsTab = lazyWithRetry(() => import('./pages/inputs/PersonsTab'));
const DependentsTab = lazyWithRetry(() => import('./pages/inputs/DependentsTab'));
const AccountsTab = lazyWithRetry(() => import('./pages/inputs/AccountsTab'));
const HoldingsTab = lazyWithRetry(() => import('./pages/inputs/HoldingsTab'));
const ContributionsTab = lazyWithRetry(() => import('./pages/inputs/ContributionsTab'));
const LoansTab = lazyWithRetry(() => import('./pages/inputs/LoansTab'));
const PropertiesTab = lazyWithRetry(() => import('./pages/inputs/PropertiesTab'));
const HousingPaymentsTab = lazyWithRetry(() => import('./pages/inputs/HousingPaymentsTab'));
const VehiclesTab = lazyWithRetry(() => import('./pages/inputs/VehiclesTab'));
const VehicleLeasesTab = lazyWithRetry(() => import('./pages/inputs/VehicleLeasesTab'));
const GoalsTab = lazyWithRetry(() => import('./pages/inputs/GoalsTab'));
const EquityGrantsTab = lazyWithRetry(() => import('./pages/inputs/EquityGrantsTab'));
const Plan529Tab = lazyWithRetry(() => import('./pages/inputs/Plan529Tab'));
const TickersTab = lazyWithRetry(() => import('./pages/inputs/TickersTab'));
const ComingSoonTab = lazyWithRetry(() => import('./pages/inputs/tabs-coming-soon'));
const CategoriesTab = lazyWithRetry(() => import('./pages/inputs/CategoriesTab'));
const SetupWizard = lazyWithRetry(() => import('./pages/setup/SetupWizard'));
const NotFound = lazyWithRetry(() => import('./pages/NotFound'));

// Tiny helper: each route element renders inside a Suspense boundary so a
// download-in-progress shows the skeleton, not a blank tree. Putting the
// boundary at the element level (not just one above <Outlet />) means the
// PageShell layout never disappears.
const lazyRoute = (Element: React.ComponentType) => (
  <Suspense fallback={<PageLoadingSpinner />}>
    <Element />
  </Suspense>
);

const router = createBrowserRouter([
  {
    path: '/setup',
    element: lazyRoute(SetupWizard),
    errorElement: lazyRoute(NotFound),
  },
  {
    // Top-level catch-all for unmatched URLs. Without this, react-router
    // falls back to its built-in "Hey developer 👋" 404 message. Lives at
    // the same level as `/` so deep-link rot lands on NotFound regardless
    // of which path segment is wrong.
    path: '*',
    element: lazyRoute(NotFound),
  },
  {
    path: '/',
    element: <PageShell />,
    // errorElement: catches uncaught render errors from descendant routes
    // — the inner ErrorBoundary in PageShell handles most in-page errors
    // first, so this is the belt-and-suspenders for anything that escapes.
    errorElement: lazyRoute(NotFound),
    children: [
      { index: true, element: lazyRoute(Dashboard) },
      { path: 'net-worth', element: lazyRoute(NetWorth) },
      { path: 'investments', element: lazyRoute(Investments) },
      { path: 'loans', element: lazyRoute(Loans) },
      { path: 'property', element: lazyRoute(Property) },
      { path: 'vehicles', element: lazyRoute(Vehicles) },
      { path: 'equity-grants', element: lazyRoute(EquityGrants) },
      { path: 'spending', element: lazyRoute(Spending) },
      { path: 'spending/transactions', element: lazyRoute(SpendingTransactions) },
      { path: 'budget', element: lazyRoute(Budget) },
      { path: 'goals', element: lazyRoute(Goals) },
      { path: 'roadmap', element: lazyRoute(Roadmap) },
      { path: 'learn', element: lazyRoute(Learn) },
      { path: 'calculators', element: lazyRoute(CalculatorsLayout) },
      { path: 'what-if', element: lazyRoute(WhatIf) },
      { path: 'settings', element: lazyRoute(Settings) },
      { path: 'monthly', element: lazyRoute(MonthlyMiniWindow) },
      {
        path: 'inputs',
        element: lazyRoute(InputsLayout),
        children: [
          { index: true, element: <Navigate to="household" replace /> },
          { path: 'household', element: lazyRoute(HouseholdTab) },
          { path: 'persons', element: lazyRoute(PersonsTab) },
          { path: 'dependents', element: lazyRoute(DependentsTab) },
          { path: 'accounts', element: lazyRoute(AccountsTab) },
          { path: 'holdings', element: lazyRoute(HoldingsTab) },
          { path: 'contributions', element: lazyRoute(ContributionsTab) },
          { path: 'loans', element: lazyRoute(LoansTab) },
          { path: 'equity-grants', element: lazyRoute(EquityGrantsTab) },
          { path: 'properties', element: lazyRoute(PropertiesTab) },
          { path: 'housing-payments', element: lazyRoute(HousingPaymentsTab) },
          { path: 'vehicles', element: lazyRoute(VehiclesTab) },
          { path: 'vehicle-leases', element: lazyRoute(VehicleLeasesTab) },
          { path: 'goals', element: lazyRoute(GoalsTab) },
          { path: 'plans-529', element: lazyRoute(Plan529Tab) },
          {
            path: 'growth-tax',
            element: (
              <Suspense fallback={<PageLoadingSpinner />}>
                <ComingSoonTab name="Growth & Tax" phase={3} />
              </Suspense>
            ),
          },
          { path: 'categories', element: lazyRoute(CategoriesTab) },
          { path: 'tickers', element: lazyRoute(TickersTab) },
        ],
      },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
