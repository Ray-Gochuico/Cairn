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
const Dashboard = lazy(() => import('./pages/Dashboard'));
const NetWorth = lazy(() => import('./pages/NetWorth'));
const Investments = lazy(() => import('./pages/Investments'));
const Loans = lazy(() => import('./pages/Loans'));
const Property = lazy(() => import('./pages/Property'));
const Vehicles = lazy(() => import('./pages/Vehicles'));
const EquityGrants = lazy(() => import('./pages/EquityGrants'));
const Spending = lazy(() => import('./pages/Spending'));
const SpendingTransactions = lazy(() => import('./pages/SpendingTransactions'));
const Budget = lazy(() => import('./pages/Budget'));
const Goals = lazy(() => import('./pages/Goals'));
const Roadmap = lazy(() => import('./pages/Roadmap'));
const Learn = lazy(() => import('./pages/Learn'));
const CalculatorsLayout = lazy(() => import('./pages/calculators/CalculatorsLayout'));
const WhatIf = lazy(() => import('./pages/WhatIf'));
const Settings = lazy(() => import('./pages/Settings'));
const MonthlyMiniWindow = lazy(() => import('./pages/MonthlyMiniWindow'));
const InputsLayout = lazy(() => import('./pages/inputs/InputsLayout'));
const HouseholdTab = lazy(() => import('./pages/inputs/HouseholdTab'));
const PersonsTab = lazy(() => import('./pages/inputs/PersonsTab'));
const DependentsTab = lazy(() => import('./pages/inputs/DependentsTab'));
const AccountsTab = lazy(() => import('./pages/inputs/AccountsTab'));
const HoldingsTab = lazy(() => import('./pages/inputs/HoldingsTab'));
const ContributionsTab = lazy(() => import('./pages/inputs/ContributionsTab'));
const LoansTab = lazy(() => import('./pages/inputs/LoansTab'));
const PropertiesTab = lazy(() => import('./pages/inputs/PropertiesTab'));
const HousingPaymentsTab = lazy(() => import('./pages/inputs/HousingPaymentsTab'));
const VehiclesTab = lazy(() => import('./pages/inputs/VehiclesTab'));
const VehicleLeasesTab = lazy(() => import('./pages/inputs/VehicleLeasesTab'));
const GoalsTab = lazy(() => import('./pages/inputs/GoalsTab'));
const EquityGrantsTab = lazy(() => import('./pages/inputs/EquityGrantsTab'));
const Plan529Tab = lazy(() => import('./pages/inputs/Plan529Tab'));
const TickersTab = lazy(() => import('./pages/inputs/TickersTab'));
const ComingSoonTab = lazy(() => import('./pages/inputs/tabs-coming-soon'));
const CategoriesTab = lazy(() => import('./pages/inputs/CategoriesTab'));
const SetupWizard = lazy(() => import('./pages/setup/SetupWizard'));
const NotFound = lazy(() => import('./pages/NotFound'));

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
