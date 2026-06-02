import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// Recharts mock — Option A jsdom pattern (matches BacktestChart.test.tsx).
// ResponsiveContainer in jsdom measures 0×0 and emits nothing; mock the
// primitives we care about so chart-containing pages can render in tests.
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
    Line: (props: { dataKey: string; stroke?: string; strokeOpacity?: number; strokeDasharray?: string; strokeWidth?: number }) =>
      React.createElement('div', {
        className: 'recharts-line-curve',
        'data-key': props.dataKey,
        'data-testid': `rc-line-${props.dataKey}`,
      }),
    Area: (props: { dataKey: string; fill?: string; fillOpacity?: number; stackId?: string }) =>
      React.createElement('div', {
        className: 'recharts-area-area',
        'data-key': props.dataKey,
        'data-testid': `rc-area-${props.dataKey}`,
      }),
    Bar: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'rc-bar' }, children),
    Cell: () => null,
  };
});

vi.mock('@/legal/useDisclosureGate', () => ({
  useDisclosureGate: () => ({ state: 'ready' }),
}));

vi.mock('@/components/whatif/useRealState', () => ({
  useRealState: () => ({
    accounts: [{ id: 1, name: 'B', type: 'BROKERAGE', excludedFromNetWorth: false }],
    holdings: [], loans: [], loanPayments: [],
    household: { id: 1, filingStatus: 'SINGLE' },
    persons: [{ id: 1, dateOfBirth: '1960-01-01', annualSalaryPretax: 0, targetRetirementAge: 0 }],
    accountsByBucket: { taxAdvantaged: [], brokerage: [], cash: [] },
    initialCash: 0, initialInvestmentsByAccount: { 1: 1_500_000 },
    cashAccountsWithBalances: [],
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

const renderPage = () => render(<MemoryRouter><Backtest /></MemoryRouter>);

describe('Backtest page', () => {
  // No shared beforeEach needed: tests that need real timers call vi.useRealTimers()
  // inline; tests that don't run any timers at all can use the default (real) timers.

  it('shows a pre-run empty-state prompt before the first run (SF-3)', () => {
    renderPage();
    // Summary/histogram absent until Run; an explicit prompt is shown instead.
    expect(screen.queryByTestId('backtest-summary')).not.toBeInTheDocument();
    // The empty-state heading is a div (not a heading/p) — query by its unique text fragment.
    expect(screen.getAllByText(/no backtest run yet/i).length).toBeGreaterThan(0);
  });

  it('renders params, runs a backtest, and shows summary + histogram + callout', async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    renderPage();
    expect(screen.getByLabelText(/goal ending amount/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /run backtest/i }));
    // run() defers the (sync) engine to a 0ms timeout so the "Running…" pending
    // state paints first (BT-8); findBy* awaits the result render.
    expect(await screen.findByTestId('backtest-summary')).toBeInTheDocument();
    expect(screen.getByTestId('backtest-histogram')).toBeInTheDocument();
    expect(screen.getByTestId('backtest-disclosure-callout')).toBeInTheDocument();
    // BT-8 (UX F3) — the run-meta caption renders under the headline hero.
    expect(screen.getByTestId('backtest-run-meta')).toHaveTextContent(/historical periods .* real dollars .* 1871/i);
  });

  it('populates multiple histogram buckets at the DEFAULT goal of $0 (SF-4 guard)', async () => {
    // The mocked seed defaults goalAmount to 0. With the goal-relative edges
    // bug, every survivor above $0 falls through the bucket scan and the only
    // populated bucket is "$0" → data-bucket-count === 1. The fix uses fixed
    // absolute edges when goal <= 0, so survivors spread across buckets.
    vi.useRealTimers();
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /run backtest/i }));
    const hist = await screen.findByTestId('backtest-histogram');
    expect(Number(hist.getAttribute('data-bucket-count'))).toBeGreaterThan(1);
  });

  it('always shows the disclosure callout even before running', () => {
    renderPage();
    expect(screen.getByTestId('backtest-disclosure-callout')).toBeInTheDocument();
  });

  it('notes that survival is counted before withdrawal tax (Task 4 copy)', () => {
    // The subhead must inform users the backtest models pre-tax survival so
    // they don't read a "success rate" as a tax-inclusive guarantee.
    renderPage();
    expect(screen.getByText(/before withdrawal tax/i)).toBeInTheDocument();
  });

  it('toggles the chart between Lines and Bands', async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: /run backtest/i }));
    await screen.findByTestId('backtest-summary'); // wait for the deferred run
    const bandsBtn = screen.getByRole('button', { name: /^bands$/i });
    await user.click(bandsBtn);
    expect(bandsBtn).toHaveAttribute('aria-pressed', 'true');
  });

  // BT-4 — run() can NEVER crash the page. An invalid config (min>max with the
  // variable strategy, or an empty/NaN portfolio) renders a calm inline alert
  // and the page survives; the summary never appears; a later valid run clears
  // the alert. Without the guard these threw to the route errorElement → 404.
  it('surfaces an inline error (not a route crash) on min>max and clears it on a valid run (BT-4)', async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    renderPage();
    // Force an invalid variable-strategy band: switch to Variable, set min>max.
    await user.selectOptions(screen.getByLabelText(/withdrawal strategy/i), 'variable');
    const min = screen.getByLabelText(/minimum withdrawal/i);
    const max = screen.getByLabelText(/maximum withdrawal/i);
    await user.clear(max); await user.type(max, '40000');
    await user.clear(min); await user.type(min, '90000');
    await user.click(screen.getByRole('button', { name: /run backtest/i }));
    // Inline alert shown, page intact, no results.
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByTestId('backtest-page')).toBeInTheDocument();
    expect(screen.queryByTestId('backtest-summary')).not.toBeInTheDocument();
    // Fix the band (max ≥ min) → a valid run clears the alert + renders results.
    await user.clear(min); await user.type(min, '40000');
    await user.click(screen.getByRole('button', { name: /run backtest/i }));
    expect(await screen.findByTestId('backtest-summary')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('surfaces an inline error on an empty/NaN starting portfolio (BT-4)', async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    renderPage();
    const portfolio = screen.getByLabelText(/starting portfolio/i);
    await user.clear(portfolio); // empties → num('') = 0 → schema min(1) rejects
    await user.click(screen.getByRole('button', { name: /run backtest/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByTestId('backtest-summary')).not.toBeInTheDocument();
  });
});
