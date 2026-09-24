import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { seedWhatIfRealStores } from './whatif-store-seed';
import type { Household, Person } from '@/types/schema';
import type { Milestones, MonthlyState } from '@/lib/scenarios';

// C2 — the page wiring, pinned end to end: ONE resolution (authoredExpenseById)
// feeds the FI gate and the G11 row; "Open Expenses →" activates the named
// scenario and raises the LeverBar open request AFTER activation.
let capturedMilestones: Map<number, Milestones> | null = null;
const leverBarProps: unknown[] = [];

vi.mock('@/components/whatif/ProjectionChart', () => ({
  default: (props: { milestones: Map<number, Milestones> }) => {
    capturedMilestones = props.milestones;
    return <div data-testid="projection-chart-stub" />;
  },
}));
vi.mock('@/components/whatif/MilestoneStrip', () => ({ default: () => <div data-testid="milestone-strip-stub" /> }));
vi.mock('@/components/whatif/ChartToolbar', () => ({ default: () => <div data-testid="chart-toolbar-stub" /> }));
vi.mock('@/components/whatif/LeverBar', () => ({
  default: (props: unknown) => { leverBarProps.push(props); return <div data-testid="lever-bar-stub" />; },
}));
vi.mock('@/components/whatif/ScenariosPanel', () => ({
  default: () => <div data-testid="scenarios-panel-stub" />,
  ScenariosPanel: () => <div data-testid="scenarios-panel-stub" />,
}));
vi.mock('@/components/whatif/FiCards', () => ({ default: () => <div data-testid="fi-cards-stub" /> }));
vi.mock('@/components/whatif/CompareScenariosCard', () => ({ default: () => <div data-testid="compare-stub" /> }));
vi.mock('@/domain/roadmap/context', () => ({ useRoadmap: () => null }));

const household: Household = {
  id: 1, name: null, filingStatus: 'SINGLE', state: 'CA', city: null,
  monthlyExpenseBaseline: 4000, withdrawalRate: 0.04, inflationAssumption: 0.025,
  growthScenarios: [{ label: 'Moderate', rate: 0.06 }],
  interestThresholdLowPct: null, interestThresholdHighPct: null, hasWrittenIps: null,
  hasHsaQualifiedHdhp: null, makesCharitableGifts: null, upcomingLargePurchase: null,
  upcomingPurchaseAmount: null, upcomingPurchaseMonths: null,
} as Household;
const person = { id: 1, householdId: 1, name: 'P1', dateOfBirth: '1990-01-01', targetRetirementAge: 65, annualSalaryPretax: 100000 } as unknown as Person;

const h = vi.hoisted(() => ({
  baseline: 4000,
  expenseBasis: { latestMonth: 0, rolling12m: 0, rolling12mMonths: 0 },
  scenarios: [] as unknown[],
  setActive: vi.fn(),
}));

vi.mock('@/components/whatif/useRealState', () => ({
  useRealState: () => ({
    startISO: '2026-05',
    persons: [person],
    cashAccountsWithBalances: [],
    defaults: { inflation: 0.025, defaultDrawdownTaxRate: null, defaultCashApy: null },
    expenseBasis: h.expenseBasis,
  }),
}));
vi.mock('@/stores/loans-store', () => ({
  useLoansStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { loans: [], isLoading: false, error: null, load: vi.fn() };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));
vi.mock('@/stores/household-store', () => ({
  useHouseholdStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { household: { ...household, monthlyExpenseBaseline: h.baseline }, load: vi.fn() };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));
vi.mock('@/stores/persons-store', () => ({
  usePersonsStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { persons: [person], load: vi.fn() };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

// 24 months whose liquid crosses the $4,000-expense FI line at 4% (1.2M) around
// month 16 — the swr-milestone fixture; expenses here are RENT-shaped (2,505).
function states(): MonthlyState[] {
  const out: MonthlyState[] = [];
  for (let i = 0; i < 24; i++) {
    const investments = 1_000_000 + i * 12_500;
    const idx = i + 4;
    out.push({
      monthISO: `${2026 + Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`,
      investmentsByAccount: { 1: investments }, homeEquity: 0, cash: 0, debtByLoan: {},
      netWorth: investments, incomeAfterTax: 0, expenses: 2_505, savings: 0, events: [],
    } as MonthlyState);
  }
  return out;
}

const payload = (over: Record<string, unknown> = {}) => ({
  extraLoanPayments: [], lumpSums: [], expensePeriods: [],
  returns: { defaultRate: 0.07, overrides: {}, cashRate: null, compoundingFrequency: 'MONTHLY' },
  income: { perPerson: [{ annualRaiseRate: 0, events: [] }] }, contributions: [],
  gapAllocation: { taxAdvantaged: null, brokerage: null }, retirementAgeOverride: null, swrOverride: null,
  inflation: { defaultRate: null, overrides: {} }, withdrawalStrategy: 'proportional',
  annualLongTermGains: 0, annualQualifiedDividends: 0, annualNonQualifiedDividends: 0, effectiveDrawdownTaxRate: 0,
  expenseSource: 'custom', customMonthly: 0, ...over,
});
const scenario = (id: number, name: string, over: Record<string, unknown> = {}, lever: Record<string, unknown> = {}) => ({
  id, name, isBaseline: id === 1, color: '#4f86f7', lineStyle: 'solid', visible: true, isActive: id === 1,
  sortOrder: id - 1, leverPayload: payload(lever), createdAt: '', updatedAt: '', ...over,
});

vi.mock('@/stores/scenarios-store', () => {
  const stateOf = () => ({
    scenarios: h.scenarios,
    activeScenario: () => h.scenarios[0],
    visibleScenarioIds: () => h.scenarios.filter((s) => (s as { visible: boolean }).visible).map((s) => (s as { id: number }).id),
    load: vi.fn(),
    projectedScenarios: () => new Map(h.scenarios.filter((s) => (s as { visible: boolean }).visible).map((s) => [(s as { id: number }).id, states()])),
    inflation: 0.025, horizonMonths: 360,
    toggleVisibility: vi.fn(), setActive: h.setActive, duplicate: vi.fn(), remove: vi.fn(), rename: vi.fn(),
    saveCurrentAsScenario: vi.fn().mockResolvedValue(2),
  });
  const useScenariosStore = (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = stateOf();
    return typeof selector === 'function' ? selector(state) : state;
  };
  useScenariosStore.getState = stateOf;
  return { useScenariosStore };
});

import WhatIf from '@/pages/WhatIf';

const renderPage = () => render(<MemoryRouter><WhatIf /></MemoryRouter>);
const G11_BASELINE = "Baseline's expense base is $0 — the projection assumes nothing is spent, so no FI date is shown.";

describe('WhatIf — C2 page wiring: the per-scenario FI gate + G11 from ONE resolution', () => {
  beforeEach(() => {
    seedWhatIfRealStores();
    capturedMilestones = null;
    leverBarProps.length = 0;
    h.baseline = 4000;
    h.expenseBasis = { latestMonth: 0, rolling12m: 0, rolling12mMonths: 0 };
    h.setActive = vi.fn().mockResolvedValue(undefined);
    h.scenarios = [scenario(1, 'Baseline')];
  });

  it('a custom/$0 scenario reads NO FI even though its states cross (the hazard: rent-shaped expenses) — and G11 names it', () => {
    renderPage();
    expect(capturedMilestones!.get(1)!.financialIndependenceISO).toBeUndefined();
    expect(screen.getByText(G11_BASELINE)).toBeInTheDocument();
  });

  it('the gate reads the RESOLVED base: a rolling12m scenario with a captured average keeps its FI date, and G11 is silent', () => {
    h.expenseBasis = { latestMonth: 5000, rolling12m: 5000, rolling12mMonths: 3 };
    h.scenarios = [scenario(1, 'Baseline', {}, { expenseSource: 'rolling12m' })];
    renderPage();
    expect(capturedMilestones!.get(1)!.financialIndependenceISO).toBeDefined();
    expect(screen.queryByText(/expense base is \$0/)).toBeNull();
  });

  it('a rolling12m scenario with NO complete month resolves $0 — gated, named', () => {
    h.scenarios = [scenario(1, 'Baseline', {}, { expenseSource: 'rolling12m' })];
    renderPage();
    expect(capturedMilestones!.get(1)!.financialIndependenceISO).toBeUndefined();
    expect(screen.getByText(G11_BASELINE)).toBeInTheDocument();
  });

  it('periods COUNT (B5): a custom/$0 scenario with a period active in the start month keeps its FI date; G11 silent', () => {
    h.scenarios = [scenario(1, 'Baseline', {}, { expensePeriods: [{ start: '2026-05-01', monthlyDelta: 3_000, durationMonths: 480 }] })];
    renderPage();
    expect(capturedMilestones!.get(1)!.financialIndependenceISO).toBeDefined();
    expect(screen.queryByText(/expense base is \$0/)).toBeNull();
  });

  it('G11 is per VISIBLE scenario in strip order; a hidden $0 scenario is neither projected nor named', () => {
    h.scenarios = [
      scenario(1, 'Baseline', {}, { customMonthly: 4_000 }),
      scenario(2, 'Sent', {}),
      scenario(3, 'Hidden', { visible: false }),
    ];
    renderPage();
    expect(screen.getByText("Sent's expense base is $0 — the projection assumes nothing is spent, so no FI date is shown.")).toBeInTheDocument();
    expect(screen.queryByText(/Hidden's expense base/)).toBeNull();
    expect(screen.queryByText(/Baseline's expense base/)).toBeNull();
  });

  it('a $0 HOUSEHOLD baseline: G1, not G11 — and no FI either way', () => {
    h.baseline = 0;
    renderPage();
    expect(screen.getByText("No monthly expense baseline — FI dates can't be computed, so they aren't shown.")).toBeInTheDocument();
    expect(screen.queryByText(/expense base is \$0/)).toBeNull();
    expect(capturedMilestones!.get(1)!.financialIndependenceISO).toBeUndefined();
  });

  it('"Open Expenses →" activates the NAMED scenario first, then raises the Expenses open request on the LeverBar', async () => {
    h.scenarios = [scenario(1, 'Baseline', {}, { customMonthly: 4_000 }), scenario(2, 'Sent', {})];
    renderPage();
    expect((leverBarProps.at(-1) as { openRequest: unknown }).openRequest).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open Expenses →' }));
    expect(h.setActive).toHaveBeenCalledWith(2);
    await waitFor(() => {
      const last = leverBarProps.at(-1) as { openRequest: { lever: string; nonce: number } | null };
      expect(last.openRequest).toEqual({ lever: 'expenses', nonce: 1 });
    });
    // a second request carries a fresh nonce (the bar re-opens a dialog the user closed)
    fireEvent.click(screen.getByRole('button', { name: 'Open Expenses →' }));
    await waitFor(() => {
      expect((leverBarProps.at(-1) as { openRequest: { nonce: number } }).openRequest.nonce).toBe(2);
    });
  });

  it('the page carries no reserved phrase and no exclamation mark on the G11 surface', () => {
    renderPage();
    const card = screen.getByTestId('whatif-model-gaps-card');
    expect(card.textContent).not.toContain('Suggested next step');
    expect(card.textContent).not.toContain('!');
  });
});
