import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { SqliteAdapter } from '@/db/sqlite-adapter';
import { setDatabase } from '@/db/db';
import { loadAllMigrations, runMigrations } from '@/db/migrations';
import { useScenariosStore } from '@/stores/scenarios-store';
import { useHouseholdStore } from '@/stores/household-store';
import { useLoansStore } from '@/stores/loans-store';
import { useHoldingsStore } from '@/stores/holdings-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useTransactionsStore } from '@/stores/transactions-store';
import { FilingStatus } from '@/types/enums';

// Mock recharts as in ProjectionChart.test.tsx
vi.mock('recharts', () => {
  const passthrough = (testId: string) => ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', { 'data-testid': testId }, children);

  return {
    ResponsiveContainer: passthrough('rc-responsive'),
    ComposedChart: passthrough('rc-composed'),
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    Area: (props: { dataKey: string }) =>
      React.createElement('div', { className: 'recharts-area-area', 'data-key': props.dataKey }),
    Line: (props: { dataKey: string }) =>
      React.createElement('div', { className: 'recharts-line-curve', 'data-key': props.dataKey }),
    ReferenceLine: (props: { x?: string }) =>
      React.createElement('div', { className: 'recharts-reference-line-line', 'data-x': props.x }),
  };
});

import WhatIf from '@/pages/WhatIf';

describe('WhatIf page', () => {
  let db: SqliteAdapter;

  beforeEach(async () => {
    db = new SqliteAdapter();
    await runMigrations(db, await loadAllMigrations());
    setDatabase(db);

    useHouseholdStore.setState({
      household: {
        filingStatus: FilingStatus.SINGLE, state: 'CA', city: null,
        monthlyExpenseBaseline: 4500,
        withdrawalRate: 0.04, inflationAssumption: 0.025,
        growthScenarios: [], persons: [{ id: 1, annualSalaryPretax: 135000 }],
      } as any,
      isLoading: false, error: null,
    });
    useLoansStore.setState({
      loans: [{ id: 1, householdId: 1, name: 'Auto', type: 'AUTO', currentBalance: 18400, interestRate: 0.059, monthlyPayment: 425, termMonths: 60, firstPaymentDate: '2026-05-01' } as any],
      isLoading: false, error: null, load: async () => {},
    } as any);
    useHoldingsStore.setState({
      holdings: [{ id: 1, accountId: 1, ticker: 'VTI', shareCount: 1000, costBasis: 200, targetAllocationPct: null } as any],
      isLoading: false, error: null, load: async () => {},
    } as any);
    useAccountsStore.setState({ accounts: [], isLoading: false, error: null, load: async () => {} } as any);
    useTransactionsStore.setState({ transactions: [], isLoading: false, error: null, load: async () => {} } as any);
    useScenariosStore.setState({
      scenarios: [], isLoading: false, error: null,
      horizonMonths: 360, dollarMode: 'nominal',
      inflation: 0.025, defaultReturnRate: 0.07,
      projectionCache: new Map(),
    });
  });

  it('renders the page header', async () => {
    render(<MemoryRouter><WhatIf /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('heading', { name: /what-if/i })).toBeInTheDocument());
  });

  it('auto-creates baseline scenario and renders the chart on first paint', async () => {
    render(<MemoryRouter><WhatIf /></MemoryRouter>);
    await waitFor(() => expect(useScenariosStore.getState().scenarios).toHaveLength(1));
    expect(screen.getByTestId('whatif-projection-chart')).toBeInTheDocument();
    expect(screen.getByTestId('whatif-chart-mode')).toHaveTextContent('composition');
  });

  it('milestone strip renders chips per visible scenario', async () => {
    render(<MemoryRouter><WhatIf /></MemoryRouter>);
    // Scenario name surfaces in both the floating ScenariosPanel and the
    // MilestoneStrip — assert at least one label exists.
    await waitFor(() => expect(screen.getAllByText('Baseline').length).toBeGreaterThan(0));
    expect(screen.getAllByText(/Debt-free/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/FIRE/).length).toBeGreaterThan(0);
  });

  it('horizon slider updates the store and re-projects', async () => {
    render(<MemoryRouter><WhatIf /></MemoryRouter>);
    await waitFor(() => expect(useScenariosStore.getState().scenarios.length).toBe(1));
    const slider = screen.getByLabelText(/horizon/i) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '120' } });
    expect(useScenariosStore.getState().horizonMonths).toBe(120);
  });

  it('dollar-mode toggle flips store state', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><WhatIf /></MemoryRouter>);
    await waitFor(() => expect(useScenariosStore.getState().scenarios.length).toBe(1));
    await user.click(screen.getByRole('button', { name: /^real/i }));
    expect(useScenariosStore.getState().dollarMode).toBe('real');
  });

  it('shows an empty-state message when household has not been set up', async () => {
    useHouseholdStore.setState({ household: null, isLoading: false, error: null });
    render(<MemoryRouter><WhatIf /></MemoryRouter>);
    expect(await screen.findByText(/set up your household/i)).toBeInTheDocument();
  });

  it('renders the lever bar with all five pills after baseline auto-creation', async () => {
    render(<MemoryRouter><WhatIf /></MemoryRouter>);
    await waitFor(() => expect(useScenariosStore.getState().scenarios.length).toBe(1));
    expect(screen.getByRole('button', { name: /loans/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /lump sums/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /expenses/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /returns/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /income/i })).toBeInTheDocument();
  });
});
