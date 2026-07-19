/**
 * Wave 18 C9 — the example-plan badge: with NO real portfolio data the page
 * falls back to the $1M demo seed, and the params header must say so.
 * Separate file because the useRealState mock is file-scoped (the main
 * Backtest.test.tsx mocks a $1.5M portfolio).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('recharts', () => {
  const passthrough =
    (testId: string) =>
    ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': testId }, children);
  return {
    ResponsiveContainer: passthrough('rc-responsive'),
    LineChart: passthrough('rc-linechart'),
    ComposedChart: passthrough('rc-composed'),
    BarChart: passthrough('rc-barchart'),
    CartesianGrid: () => null,
    XAxis: () => null,
    YAxis: () => null,
    Tooltip: () => null,
    ReferenceLine: () => null,
    Line: () => null,
    Area: () => null,
    Bar: () => null,
    Cell: () => null,
  };
});

vi.mock('@/legal/useDisclosureGate', () => ({
  useDisclosureGate: () => ({ state: 'ready' }),
}));

// EMPTY profile: zero investments + zero cash → the || 1_000_000 demo seed.
vi.mock('@/components/whatif/useRealState', () => ({
  useRealState: () => ({
    accounts: [],
    holdings: [], loans: [], loanPayments: [],
    household: { id: 1, filingStatus: 'SINGLE' },
    persons: [],
    accountsByBucket: { taxAdvantaged: [], brokerage: [], cash: [] },
    initialCash: 0, initialInvestmentsByAccount: {},
    cashAccountsWithBalances: [],
    defaults: { inflation: 0, returnRate: 0, defaultCashApy: null, defaultDrawdownTaxRate: null },
    startISO: '2026-01',
    taxBrackets: { federal: [], state: [], city: null, ltcg: [], standardDeduction: { federal: 0, state: 0, city: 0 } },
    housingPayments: [], vehicleLeases: [],
  }),
}));

vi.mock('@/stores/household-store', () => ({
  useHouseholdStore: (selector?: (s: unknown) => unknown) => {
    const state = {
      household: {
        id: 1, filingStatus: 'SINGLE',
        monthlyExpenseBaseline: 0, withdrawalRate: 0.04,
        inflationAssumption: 0.03, growthScenarios: [],
      },
      acceptDisclaimer: vi.fn(),
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

import Backtest from '@/pages/calculators/Backtest';
import { __resetScenarioAssumptionsForTests } from '@/lib/calculators/use-scenario-assumptions';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';

describe('Backtest example-plan badge (Wave 18 C9)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    __resetScenarioAssumptionsForTests();
    const noop = async () => {};
    useAccountsStore.setState({ accounts: [], isLoading: false, error: null, load: noop } as never);
    useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null, load: noop } as never);
  });

  it('an empty profile shows the example-plan badge next to the params title', () => {
    render(<MemoryRouter><Backtest /></MemoryRouter>);
    expect(
      screen.getByText(/example plan — add Inputs to use your data/i),
    ).toBeInTheDocument();
  });
});
