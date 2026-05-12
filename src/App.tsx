import { createBrowserRouter, RouterProvider } from 'react-router-dom';
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
      { path: 'inputs/*', element: <InputsLayout /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
