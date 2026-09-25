import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import WhatIf, { WHATIF_PAGE_BASIS_FIGURES } from '@/pages/WhatIf';
import { WHATIF_FI_BASIS_FIGURES } from '@/components/whatif/FiCards';
import { COMPARE_BASIS_FIGURES_BL3 } from '@/components/whatif/CompareScenariosCard';
import { expectBasisDiscipline } from '../helpers/basis-discipline';
import { WHATIF_PAGE_ID, __resetDollarBasisForTests } from '@/lib/calculators/dollar-basis';
import { FiPillsPosition } from '@/types/enums';
import { useSettingsStore } from '@/stores/settings-store';
import { seedWhatIfRealStores } from './whatif-store-seed';
import type { Household, Person } from '@/types/schema';

// Harness preamble copied from WhatIf.test.tsx (same stubs, same fixtures),
// with the scenario/projection state made mutable via vi.hoisted so each test
// can seed a different pair without a second file.
vi.mock('@/components/whatif/ProjectionChart', () => ({
  default: () => <div data-testid="projection-chart-stub" />,
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
vi.mock('@/components/whatif/ScenariosPanel', () => ({
  default: () => <div data-testid="scenarios-panel-stub" />,
  ScenariosPanel: () => <div data-testid="scenarios-panel-stub" />,
}));

// The roadmap context is inert by default (null → roadmapHasUnanswered false),
// exactly as the plan's Task 6 Step 3 prescribes. Review addition: it is now
// SETTABLE, and `evaluate` is stubbed with a controllable result map, so the
// page's own scan ('unanswered', and the ctx it passes) is pinned too — the
// lib only ever receives the finished boolean.
vi.mock('@/domain/roadmap/context', () => ({ useRoadmap: () => h.roadmapCtx }));
vi.mock('@/domain/roadmap/evaluate', () => ({
  evaluate: (ctx: unknown) => { h.evaluateCalls.push(ctx); return h.roadmapResults; },
}));

const householdFixture: Household = {
  id: 1,
  name: null,
  filingStatus: 'SINGLE',
  state: 'CA',
  city: null,
  monthlyExpenseBaseline: 4000,
  withdrawalRate: 0.04,
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
    startISO: '2026-05-01',
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
    // Review MAJOR 3: the CASH leg of the engine slice, settable per test.
    // The page is the only place that binds it into the parity fn's context,
    // and no page test observed it — both drop-mutants
    // (`cashAccountsWithBalances: []`, and deleting the `defaultCashApy`
    // line, which is optional and so tsc-clean) survived tests/pages.
    cashAccountsWithBalances: h.cashAccounts,
    // RealState.defaults IS the engine's settings leg (state-snapshot.ts:419)
    // — the page must pass it to the parity fn, never the display deflator
    // (household 2.5% here), or the CR-Y3a honesty appendix silently vanishes.
    defaults: {
      inflation: 0.03,
      defaultDrawdownTaxRate: null,
      defaultCashApy: h.defaultCashApy,
    },
  }),
}));

const payload = () => ({
  extraLoanPayments: [],
  lumpSums: [],
  expensePeriods: [],
  returns: { defaultRate: 0.07, overrides: {}, cashRate: null, compoundingFrequency: 'MONTHLY' },
  income: { perPerson: [{ annualRaiseRate: 0.03, events: [] }] },
  contributions: [],
  gapAllocation: { taxAdvantaged: null, brokerage: null },
  retirementAgeOverride: null,
  swrOverride: null,
  inflation: { defaultRate: null, overrides: {} },
  withdrawalStrategy: 'proportional',
  annualLongTermGains: 0,
  annualQualifiedDividends: 0,
  annualNonQualifiedDividends: 0,
  effectiveDrawdownTaxRate: 0,
  expenseSource: 'custom',
  customMonthly: 0,
});

const h = vi.hoisted(() => ({
  cashAccounts: [] as { account: unknown; balance: number }[],
  defaultCashApy: null as number | null,
  scenarios: [] as unknown[],
  projections: new Map<number, unknown[]>(),
  roadmapCtx: null as unknown,
  roadmapResults: new Map<string, { status: string }>(),
  evaluateCalls: [] as unknown[],
}));

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
      setActive: vi.fn(),
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

const scenario = (id: number, name: string, over: Record<string, unknown> = {}) => ({
  id, name, isBaseline: id === 1, color: '#4f86f7', lineStyle: 'solid',
  visible: true, isActive: id === 1, sortOrder: id - 1, leverPayload: payload(),
  createdAt: '', updatedAt: '', ...over,
});

const state = (netWorth: number) => ({
  monthISO: '2026-05',
  investmentsByAccount: { 1: 200_000 },
  homeEquity: 0,
  cash: 50_000,
  debtByLoan: {},
  netWorth,
  incomeAfterTax: 0,
  expenses: 0,
  // C2 review: the engine's per-month authored stamp — a custom/$0 scenario
  // authors (and here spends) nothing, so the G11 row renders and its $0 rides
  // this sweep (registered invariant in WHATIF_PAGE_BASIS_FIGURES).
  authoredExpenses: 0,
  savings: 0,
  events: [],
});

function setSettings(over: Record<string, unknown> = {}) {
  useSettingsStore.setState({
    settings: {
      id: 1, sidebarLayout: null, notificationsEnabled: true, notificationDay: 1,
      refreshCadence: 'EVERY_LAUNCH', lastRefreshAt: null, statementsFolderPath: null,
      defaultInflation: null, defaultReturnRate: null,
      defaultFiPillsPosition: FiPillsPosition.ABOVE,
      ...over,
    },
    isLoading: false, error: null, load: async () => {}, update: async () => {},
  } as never);
}


describe('W5.1 basis-audit sweep — the /what-if page (FI cards + Compare + prose; both bases)', () => {
  beforeEach(() => {
    seedWhatIfRealStores();
    setSettings();
    sessionStorage.clear();
    __resetDollarBasisForTests();
    h.cashAccounts = [];
    h.defaultCashApy = null;
    h.roadmapCtx = null;
    h.roadmapResults = new Map();
    h.evaluateCalls = [];
    h.scenarios = [scenario(1, 'Baseline'), scenario(2, 'Aggressive payoff')];
    h.projections = new Map<number, unknown[]>([[1, [state(900_000)]], [2, [state(400_000)]]]);
  });

  it('every registered figure obeys its class across the flip; no unregistered $ anywhere on the page', () => {
    expectBasisDiscipline(
      <MemoryRouter><WhatIf /></MemoryRouter>,
      {
        figures: [...WHATIF_FI_BASIS_FIGURES, ...COMPARE_BASIS_FIGURES_BL3, ...WHATIF_PAGE_BASIS_FIGURES],
        charts: [],
      },
      { pageId: WHATIF_PAGE_ID },
    );
  });

  it('C2 review: the G11 $0 rows render in this harness — the sweep above exercises their registration, never vacuously', () => {
    render(<MemoryRouter><WhatIf /></MemoryRouter>);
    expect(screen.getAllByTestId('whatif-model-gap-expense-base')).toHaveLength(2);
  });
});
