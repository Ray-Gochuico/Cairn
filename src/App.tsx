import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import PageShell from './components/layout/PageShell';
import Dashboard from './pages/Dashboard';
import NetWorth from './pages/NetWorth';
import Investments from './pages/Investments';
import Loans from './pages/Loans';
import PropertyVehicles from './pages/PropertyVehicles';
import EquityGrants from './pages/EquityGrants';
import Spending from './pages/Spending';
import Goals from './pages/Goals';
import Calculators from './pages/Calculators';
import WhatIf from './pages/WhatIf';
import Profile from './pages/Profile';
import InputsLayout from './pages/inputs/InputsLayout';
import HouseholdTab from './pages/inputs/HouseholdTab';
import PersonsTab from './pages/inputs/PersonsTab';
import DependentsTab from './pages/inputs/DependentsTab';
import AccountsTab from './pages/inputs/AccountsTab';
import HoldingsTab from './pages/inputs/HoldingsTab';
import ContributionsTab from './pages/inputs/ContributionsTab';
import LoansTab from './pages/inputs/LoansTab';
import PropertiesTab from './pages/inputs/PropertiesTab';
import VehiclesTab from './pages/inputs/VehiclesTab';
import ComingSoonTab from './pages/inputs/tabs-coming-soon';

const router = createBrowserRouter([
  {
    path: '/',
    element: <PageShell />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'net-worth', element: <NetWorth /> },
      { path: 'investments', element: <Investments /> },
      { path: 'loans', element: <Loans /> },
      { path: 'property-vehicles', element: <PropertyVehicles /> },
      { path: 'equity-grants', element: <EquityGrants /> },
      { path: 'spending', element: <Spending /> },
      { path: 'goals', element: <Goals /> },
      { path: 'calculators', element: <Calculators /> },
      { path: 'what-if', element: <WhatIf /> },
      { path: 'profile', element: <Profile /> },
      {
        path: 'inputs',
        element: <InputsLayout />,
        children: [
          { index: true, element: <Navigate to="household" replace /> },
          { path: 'household', element: <HouseholdTab /> },
          { path: 'persons', element: <PersonsTab /> },
          { path: 'dependents', element: <DependentsTab /> },
          { path: 'accounts', element: <AccountsTab /> },
          { path: 'holdings', element: <HoldingsTab /> },
          { path: 'contributions', element: <ContributionsTab /> },
          { path: 'loans', element: <LoansTab /> },
          { path: 'equity-grants', element: <ComingSoonTab name="Equity Grants" phase={3} /> },
          { path: 'properties', element: <PropertiesTab /> },
          { path: 'vehicles', element: <VehiclesTab /> },
          { path: 'goals', element: <ComingSoonTab name="Goals" phase={3} /> },
          { path: 'plans-529', element: <ComingSoonTab name="529 Plans" phase={3} /> },
          { path: 'growth-tax', element: <ComingSoonTab name="Growth & Tax" phase={3} /> },
          { path: 'categories', element: <ComingSoonTab name="Categories" phase={4} /> },
          { path: 'tickers', element: <ComingSoonTab name="Tickers" phase={3} /> },
        ],
      },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
