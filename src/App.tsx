import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import PageShell from './components/layout/PageShell';
import Dashboard from './pages/Dashboard';
import NetWorth from './pages/NetWorth';
import Investments from './pages/Investments';
import Loans from './pages/Loans';
import Property from './pages/Property';
import Vehicles from './pages/Vehicles';
import EquityGrants from './pages/EquityGrants';
import Spending from './pages/Spending';
import Budget from './pages/Budget';
import Goals from './pages/Goals';
import CalculatorsLayout from './pages/calculators/CalculatorsLayout';
import WhatIf from './pages/WhatIf';
import Settings from './pages/Settings';
import MonthlyMiniWindow from './pages/MonthlyMiniWindow';
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
import GoalsTab from './pages/inputs/GoalsTab';
import EquityGrantsTab from './pages/inputs/EquityGrantsTab';
import Plan529Tab from './pages/inputs/Plan529Tab';
import TickersTab from './pages/inputs/TickersTab';
import ComingSoonTab from './pages/inputs/tabs-coming-soon';
import CategoriesTab from './pages/inputs/CategoriesTab';
import SetupWizard from './pages/setup/SetupWizard';
import BackupRestore from './pages/BackupRestore';

const router = createBrowserRouter([
  {
    path: '/setup',
    element: <SetupWizard />,
  },
  {
    path: '/',
    element: <PageShell />,
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'net-worth', element: <NetWorth /> },
      { path: 'investments', element: <Investments /> },
      { path: 'loans', element: <Loans /> },
      { path: 'property', element: <Property /> },
      { path: 'vehicles', element: <Vehicles /> },
      { path: 'equity-grants', element: <EquityGrants /> },
      { path: 'spending', element: <Spending /> },
      { path: 'budget', element: <Budget /> },
      { path: 'goals', element: <Goals /> },
      { path: 'calculators', element: <CalculatorsLayout /> },
      { path: 'what-if', element: <WhatIf /> },
      { path: 'settings', element: <Settings /> },
      { path: 'backup-restore', element: <BackupRestore /> },
      { path: 'monthly', element: <MonthlyMiniWindow /> },
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
          { path: 'equity-grants', element: <EquityGrantsTab /> },
          { path: 'properties', element: <PropertiesTab /> },
          { path: 'vehicles', element: <VehiclesTab /> },
          { path: 'goals', element: <GoalsTab /> },
          { path: 'plans-529', element: <Plan529Tab /> },
          { path: 'growth-tax', element: <ComingSoonTab name="Growth & Tax" phase={3} /> },
          { path: 'categories', element: <CategoriesTab /> },
          { path: 'tickers', element: <TickersTab /> },
        ],
      },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
