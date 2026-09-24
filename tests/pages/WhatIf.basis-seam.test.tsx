import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import WhatIf from '@/pages/WhatIf';
import type { ProjectionChartProps } from '@/components/whatif/ProjectionChart';
import {
  toDisplayMilestones,
  whatIfChartCaption,
  WHATIF_FUTURE_CAPTION,
} from '@/lib/calculators/basis-view';
import {
  WHATIF_PAGE_ID,
  __resetDollarBasisForTests,
  useDollarBasisStore,
} from '@/lib/calculators/dollar-basis';
import { formatCurrency } from '@/lib/format';
import { FiPillsPosition } from '@/types/enums';
import { useSettingsStore } from '@/stores/settings-store';
import { seedWhatIfRealStores } from './whatif-store-seed';
import type { Household, Person } from '@/types/schema';

// ---------------------------------------------------------------------------
// Review UPHELD 0 + 1 (B1): the PAGE seam. The component-level wiring probe
// (tests/components/ProjectionChart.basis.test.tsx) builds its own bundle, and
// every other page test stubs ProjectionChart inertly — so the page's hand-off
// of `basisView.displayProjections` / `.chartCaption` to the chart and of
// `.netWorth30yFmt` / `.suffix` to the scoreboard modal was asserted nowhere.
// This file pins both hand-offs where they happen: a props-CAPTURING chart
// mock, and the REAL ScenariosPanel → Manage… → ManageScenariosModal (a Radix
// portal on document.body, read through `screen`).
//
// Harness preamble from WhatIf.basis-sweep.test.tsx (same stores, same
// fixtures), minus the ScenariosPanel stub.
// ---------------------------------------------------------------------------

const h = vi.hoisted(() => ({
  chartProps: [] as ProjectionChartProps[],
  scenarios: [] as unknown[],
  projections: new Map<number, unknown[]>(),
}));

vi.mock('@/components/whatif/ProjectionChart', () => ({
  default: (p: ProjectionChartProps) => {
    h.chartProps.push(p);
    return <div data-testid="projection-chart-stub" />;
  },
}));
vi.mock('@/components/whatif/MilestoneStrip', () => ({
  default: () => <div data-testid="milestone-strip-stub" />,
}));
vi.mock('@/components/whatif/ChartToolbar', () => ({
  default: () => <div data-testid="chart-toolbar-stub" />,
}));
vi.mock('@/components/whatif/LeverBar', () => ({
  default: () => <div data-testid="lever-bar-stub" />,
}));
vi.mock('@/domain/roadmap/context', () => ({ useRoadmap: () => null }));

const householdFixture: Household = {
  id: 1,
  name: null,
  filingStatus: 'SINGLE',
  state: 'CA',
  city: null,
  monthlyExpenseBaseline: 4000,
  withdrawalRate: 0.04,
  // The page's display deflator (effectiveBaselineInflation → household).
  inflationAssumption: 0.025,
  growthScenarios: [
    { label: 'Conservative', rate: 0.04 },
    { label: 'Moderate', rate: 0.06 },
  ],
  interestThresholdLowPct: null,
  interestThresholdHighPct: null,
  hasWrittenIps: null,
  hasHsaQualifiedHdhp: null,
  makesCharitableGifts: null,
  upcomingLargePurchase: null,
  upcomingPurchaseAmount: null,
  upcomingPurchaseMonths: null,
} as Household;

const personFixture = {
  id: 1,
  householdId: 1,
  name: 'P1',
  dateOfBirth: '1990-01-01',
  targetRetirementAge: 65,
  annualSalaryPretax: 100000,
  expectedBonus: 0,
} as unknown as Person;

vi.mock('@/components/whatif/useRealState', () => ({
  useRealState: () => ({
    startISO: '2026-05', // RealState's own 'YYYY-MM' shape (useRealState.ts)
    cash: 0,
    investmentsByAccount: { 1: 100000 },
    homeEquity: 0,
    incomeAfterTax: 7000,
    expenses: 4000,
    debtByLoan: {},
    loans: [],
    persons: [personFixture],
    inflation: 0.025,
    defaultReturnRate: 0.07,
    cashAccountsWithBalances: [],
    // The ENGINE's settings leg — deliberately NOT the display deflator, so a
    // page that deflated with it would read 3% (anti-pinned below).
    defaults: { inflation: 0.03, defaultDrawdownTaxRate: null, defaultCashApy: null },
  }),
}));

const payload = (inflationDefault: number | null = null) => ({
  extraLoanPayments: [],
  lumpSums: [],
  expensePeriods: [],
  returns: { defaultRate: 0.07, overrides: {}, cashRate: null, compoundingFrequency: 'MONTHLY' },
  income: { perPerson: [{ annualRaiseRate: 0.03, events: [] }] },
  contributions: [],
  gapAllocation: { taxAdvantaged: null, brokerage: null },
  retirementAgeOverride: null,
  swrOverride: null,
  inflation: { defaultRate: inflationDefault, overrides: {} },
  withdrawalStrategy: 'proportional',
  annualLongTermGains: 0,
  annualQualifiedDividends: 0,
  annualNonQualifiedDividends: 0,
  effectiveDrawdownTaxRate: 0,
  expenseSource: 'custom',
  customMonthly: 0,
});

vi.mock('@/stores/scenarios-store', () => ({
  useScenariosStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = {
      scenarios: h.scenarios,
      activeScenario: () => h.scenarios[0],
      visibleScenarioIds: () => h.scenarios.map((s) => (s as { id: number }).id),
      load: vi.fn(),
      projectedScenarios: () => h.projections,
      inflation: 0.025,
      horizonMonths: 360,
      toggleVisibility: vi.fn(),
      setActive: vi.fn(async () => {}),
      duplicate: vi.fn(),
      remove: vi.fn(),
      rename: vi.fn(),
      saveCurrentAsScenario: vi.fn().mockResolvedValue(3),
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));
vi.mock('@/stores/loans-store', () => ({
  useLoansStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { loans: [], isLoading: false, error: null, load: vi.fn() };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));
vi.mock('@/stores/household-store', () => ({
  useHouseholdStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { household: householdFixture, load: vi.fn() };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));
vi.mock('@/stores/persons-store', () => ({
  usePersonsStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { persons: [personFixture], load: vi.fn() };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

const scenario = (id: number, name: string, inflationDefault: number | null = null) => ({
  id, name, isBaseline: id === 1, color: '#4f86f7', lineStyle: 'solid',
  visible: true, isActive: id === 1, sortOrder: id - 1, leverPayload: payload(inflationDefault),
  createdAt: '', updatedAt: '',
});

const state = (monthISO: string, netWorth: number) => ({
  monthISO,
  investmentsByAccount: { 1: netWorth },
  homeEquity: 0,
  cash: 0,
  debtByLoan: {},
  netWorth,
  incomeAfterTax: 0,
  expenses: 0,
  savings: 0,
  events: [],
});

// Month 0 = startISO (identity in both bases); month 12 = exactly 1.0 elapsed
// year, so at the page's 2.5% it deflates to a round figure. Fewer than 360
// states → netWorth30y is the horizon-end state (milestones.ts fallback).
const NOMINAL_1 = [state('2026-05', 900_000), state('2027-05', 1_025_000)];
const NOMINAL_2 = [state('2026-05', 400_000), state('2027-05', 512_500)];

function setSettings() {
  useSettingsStore.setState({
    settings: {
      id: 1, sidebarLayout: null, notificationsEnabled: true, notificationDay: 1,
      refreshCadence: 'EVERY_LAUNCH', lastRefreshAt: null, statementsFolderPath: null,
      defaultInflation: null, defaultReturnRate: null,
      defaultFiPillsPosition: FiPillsPosition.ABOVE,
    },
    isLoading: false, error: null, load: async () => {}, update: async () => {},
  } as never);
}

const lastChart = (): ProjectionChartProps => {
  expect(h.chartProps.length).toBeGreaterThan(0); // the chart really mounted
  return h.chartProps[h.chartProps.length - 1];
};
const renderPage = () => render(<MemoryRouter><WhatIf /></MemoryRouter>);
const flip = (b: 'today' | 'future') =>
  act(() => useDollarBasisStore.getState().setBasis(WHATIF_PAGE_ID, b));

describe('W5.1 page seam — the chart and the scoreboard receive the ONE bundle (review UPHELD 0 + 1)', () => {
  beforeEach(() => {
    seedWhatIfRealStores();
    setSettings();
    sessionStorage.clear();
    localStorage.clear(); // ScenariosPanel's collapse pref — keep it expanded
    __resetDollarBasisForTests();
    h.chartProps = [];
    h.scenarios = [scenario(1, 'Baseline'), scenario(2, 'Aggressive payoff')];
    h.projections = new Map<number, unknown[]>([[1, NOMINAL_1], [2, NOMINAL_2]]);
  });

  it("chart: Today plots the page's deflated map (not the raw engine map) under the Today caption; Future passes the engine map BY REFERENCE (P4)", () => {
    renderPage();

    // Today's $ (the default, D-T3).
    const today = lastChart();
    expect(today.displayProjections).not.toBe(h.projections); // never the raw nominal engine map
    const b = today.displayProjections.get(1)!;
    expect(b[0].netWorth).toBe(900_000); //                   month 0 — identity
    expect(b[1].netWorth).toBeCloseTo(1_000_000, 6); //       1,025,000 / 1.025^(12/12)
    expect(formatCurrency(b[1].netWorth)).not.toBe('$1,025,000'); // nominal anti-pin
    expect(formatCurrency(b[1].netWorth)).not.toBe('$995,146'); //   the engine's 3% leg anti-pin
    expect(today.displayProjections.get(2)![1].netWorth).toBeCloseTo(500_000, 6); // 512,500 / 1.025
    expect(today.basisCaption).toBe(whatIfChartCaption('today', 0.025));
    expect(today.basisCaption).toBe("All lines in today's dollars — one deflator, 2.5% inflation.");

    // Future $.
    flip('future');
    const future = lastChart();
    expect(future.displayProjections).toBe(h.projections); // P4: by reference, no copy
    expect(future.displayProjections.get(1)![1].netWorth).toBe(1_025_000);
    expect(future.basisCaption).toBe(whatIfChartCaption('future', 0.025));
    expect(future.basisCaption).toBe(WHATIF_FUTURE_CAPTION);

    // And back: the caption and the rows move together.
    flip('today');
    expect(lastChart().basisCaption).toBe("All lines in today's dollars — one deflator, 2.5% inflation.");
    expect(lastChart().displayProjections.get(1)![1].netWorth).toBeCloseTo(1_000_000, 6);
  });

  it("chart: ONE deflator — an active-scenario inflation lever (4%) moves the caption's rate AND the plotted rows together", () => {
    h.scenarios = [scenario(1, 'Baseline', 0.04), scenario(2, 'Aggressive payoff')];
    renderPage();
    const p = lastChart();
    expect(p.basisCaption).toBe("All lines in today's dollars — one deflator, 4% inflation.");
    expect(p.displayProjections.get(1)![1].netWorth).toBeCloseTo(1_025_000 / 1.04, 6); // 985,576.92
    expect(p.displayProjections.get(2)![1].netWorth).toBeCloseTo(512_500 / 1.04, 6); //  same deflator for every scenario
  });

  it("scoreboard (Manage…, a portal): each 30y NW cell is the bundle's figure under its OWN mark — never a nominal figure under (today's $)", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Manage…' }));
    expect(await screen.findByRole('heading', { name: 'Manage scenarios' })).toBeInTheDocument();
    const cells = () => screen.getAllByTestId('manage-nw30y').map((c) => c.textContent);

    // Today's $: the ONE 30-year recipe over the page's milestones (the
    // horizon-end states: 1,025,000 and 512,500) at the page's 2.5%.
    const recipe = toDisplayMilestones(
      new Map([[1, { netWorth30y: 1_025_000 }], [2, { netWorth30y: 512_500 }]]),
      'today',
      0.025,
    );
    expect(cells()).toEqual([
      `${formatCurrency(recipe.get(1)!.netWorth30y!)} (today's $)`,
      `${formatCurrency(recipe.get(2)!.netWorth30y!)} (today's $)`,
    ]);
    expect(cells()).toEqual(["$488,661 (today's $)", "$244,331 (today's $)"]); // ÷ 1.025^30 = 2.097567579
    for (const c of cells()) expect(c).not.toMatch(/\$1,025,000|\$512,500/); // no nominal figure under a today's mark

    // Future $ (the modal stays open; the page re-hands the bundle).
    flip('future');
    expect(cells()).toEqual(['$1,025,000 (future $)', '$512,500 (future $)']);
    for (const c of cells()) expect(c).not.toContain("(today's $)");
  });
});
