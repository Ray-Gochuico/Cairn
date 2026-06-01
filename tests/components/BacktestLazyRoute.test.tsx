import React, { Suspense, lazy } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

// Recharts mock — must be before any component import.
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
    Line: (props: { dataKey: string }) =>
      React.createElement('div', { 'data-testid': `rc-line-${props.dataKey}` }),
    Area: (props: { dataKey: string }) =>
      React.createElement('div', { 'data-testid': `rc-area-${props.dataKey}` }),
    Bar: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'rc-bar' }, children),
    Cell: () => null,
  };
});

// Mock the gate to 'ready' and the seed so the lazily-loaded page renders.
vi.mock('@/legal/useDisclosureGate', () => ({
  useDisclosureGate: () => ({ state: 'ready' }),
}));
vi.mock('@/components/whatif/useRealState', () => ({
  useRealState: () => ({
    accounts: [], holdings: [], loans: [], loanPayments: [],
    household: { id: 1, filingStatus: 'SINGLE' }, persons: [],
    accountsByBucket: { taxAdvantaged: [], brokerage: [], cash: [] },
    initialCash: 0, initialInvestmentsByAccount: { 1: 1_000_000 }, cashAccountsWithBalances: [],
    defaults: { inflation: 0, returnRate: 0, defaultCashApy: null, defaultDrawdownTaxRate: null },
    startISO: '2026-01',
    taxBrackets: { federal: [], state: [], city: null, ltcg: [], standardDeduction: { federal: 0, state: 0, city: 0 } },
    housingPayments: [], vehicleLeases: [],
  }),
}));
vi.mock('@/stores/household-store', () => ({
  useHouseholdStore: (selector?: any) => {
    const state = { household: { id: 1, filingStatus: 'SINGLE' }, acceptDisclaimer: vi.fn() };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

import Backtest from '@/pages/calculators/Backtest';

describe('Backtest route', () => {
  it('mounts at /calculators/backtest and renders the page heading', () => {
    render(
      <MemoryRouter initialEntries={['/calculators/backtest']}>
        <Routes>
          <Route path="/calculators/backtest" element={<Backtest />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: /historical backtest/i })).toBeInTheDocument();
  });

  it('renders the full page (not the stub) with backtest-page testid', () => {
    render(
      <MemoryRouter>
        <Backtest />
      </MemoryRouter>,
    );
    // The full page renders data-testid="backtest-page" (replaces the Task-8 stub).
    expect(screen.getByTestId('backtest-page')).toBeInTheDocument();
    // Stub is gone.
    expect(screen.queryByTestId('backtest-stub')).not.toBeInTheDocument();
  });
});

describe('Backtest lazy route (B6 — dynamic-import chain)', () => {
  it('resolves the lazily-imported route chunk (page + backtest lib + Shiller data) and renders', async () => {
    // The same dynamic import App.tsx uses: this pulls the route chunk →
    // @/lib/backtest → @/data/shiller-schema → @/data/shiller at runtime.
    const LazyBacktest = lazy(() => import('@/pages/calculators/Backtest'));
    render(
      <MemoryRouter>
        <Suspense fallback={<div>loading…</div>}>
          <LazyBacktest />
        </Suspense>
      </MemoryRouter>,
    );
    // Suspense fallback shows first, then the resolved chunk renders the page.
    await waitFor(() => expect(screen.getByTestId('backtest-page')).toBeInTheDocument());
    // W2 / BT-6 — the inline back-nav (byte-identical to the paycheck page) is
    // present on the detail route and points at /calculators.
    const back = screen.getByRole('link', { name: /back to calculators/i });
    expect(back).toHaveAttribute('href', '/calculators');
  });

  it('loads + Zod-validates the lazily-imported Shiller data chunk', async () => {
    // Directly exercise the data chunk's async import + validation path.
    const { loadShillerAnnual } = await import('@/data/shiller-schema');
    const rows = loadShillerAnnual();
    expect(rows.length).toBeGreaterThan(140);
    expect(rows[0].year).toBe(1871);
  });
});
