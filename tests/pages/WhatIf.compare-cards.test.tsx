import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import WhatIf from '@/pages/WhatIf';
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

// G9 inert: the roadmap scan is exercised at the lib level (model-gaps.test).
vi.mock('@/domain/roadmap/context', () => ({ useRoadmap: () => null }));

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
  scenarios: [] as unknown[],
  projections: new Map<number, unknown[]>(),
  dollarMode: 'nominal' as 'nominal' | 'real',
}));

vi.mock('@/stores/scenarios-store', () => ({
  useScenariosStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = {
      scenarios: h.scenarios,
      activeScenario: () => h.scenarios[0],
      visibleScenarioIds: () => h.scenarios.map((s) => (s as { id: number }).id),
      load: vi.fn(),
      projectedScenarios: () => h.projections,
      dollarMode: h.dollarMode,
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
  savings: 0,
  events: [],
});

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

const renderWhatIf = () => render(<MemoryRouter><WhatIf /></MemoryRouter>);

describe('WhatIf — W3 compare + model-gaps cards', () => {
  beforeEach(() => {
    seedWhatIfRealStores();
    setSettings();
    h.dollarMode = 'nominal';
    h.scenarios = [scenario(1, 'Baseline'), scenario(2, 'Aggressive payoff')];
    h.projections = new Map<number, unknown[]>([
      [1, [state(900_000)]],
      [2, [state(400_000)]],
    ]);
  });

  it('W3 placement: both cards sit between MilestoneStrip and the projection footnote', () => {
    renderWhatIf();
    const strip = screen.getByTestId('milestone-strip-stub');
    const compare = screen.getByTestId('whatif-compare-card');
    const gaps = screen.getByTestId('whatif-model-gaps-card');
    const footnote = screen.getByTestId('whatif-projection-footnote');
    expect(strip.compareDocumentPosition(compare) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(compare.compareDocumentPosition(gaps) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(gaps.compareDocumentPosition(footnote) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('W3: the picker renders both scenarios, and B never offers A', () => {
    renderWhatIf();
    const selA = screen.getByLabelText('Compare scenario A') as HTMLSelectElement;
    const selB = screen.getByLabelText('Compare scenario B') as HTMLSelectElement;
    expect([...selA.options].map((o) => o.textContent)).toEqual(['Baseline', 'Aggressive payoff']);
    expect([...selB.options].map((o) => o.textContent)).toEqual(['Aggressive payoff']);
  });

  it('W3: single scenario renders the quiet prompt', () => {
    h.scenarios = [scenario(1, 'Baseline')];
    h.projections = new Map<number, unknown[]>([[1, [state(900_000)]]]);
    renderWhatIf();
    expect(screen.getByText('Save a second scenario to compare plans side by side.')).toBeInTheDocument();
  });

  it('W3 scoreboard parity: the BL-3 delta equals the fmtNetWorth30y recipe over both sides', () => {
    h.dollarMode = 'real';
    renderWhatIf();
    // The modal's recipe (ManageScenariosModal.tsx:39-44): disp = n / 1.025^30
    // — displayInflation resolves to household.inflationAssumption here.
    const dispA = 900_000 / Math.pow(1.025, 30);
    const dispB = 400_000 / Math.pow(1.025, 30);
    const delta = `$${Math.round(Math.abs(dispB - dispA)).toLocaleString('en-US')}`;
    expect(delta).toBe('$238,371'); // hand-derived: 500,000 / 2.097567579081786
    expect(
      screen.getByText((_t, el) => el?.tagName === 'P'
        && el.textContent === `Baseline ends ${delta} higher at the 30-year mark (today's dollars).`),
    ).toBeInTheDocument();
  });

  it('W3 nominal mode: no deflator clause and no today\'s-dollars suffix', () => {
    renderWhatIf();
    const card = screen.getByTestId('whatif-compare-card');
    expect(card.textContent).not.toContain('One deflator');
    expect(card.textContent).not.toContain("today's dollars");
    expect(card.textContent).toContain('Same yardstick: dollars are nominal and the horizon is 30 years');
  });

  it('W3: cards absent without projection data (page empty state owns the moment)', () => {
    // hasProjectionData inspects cash / netWorth / investments — zero all three.
    h.projections = new Map<number, unknown[]>([
      [1, [{ ...state(0), cash: 0, investmentsByAccount: {} }]],
      [2, [{ ...state(0), cash: 0, investmentsByAccount: {} }]],
    ]);
    renderWhatIf();
    expect(screen.queryByTestId('whatif-compare-card')).toBeNull();
    expect(screen.queryByTestId('whatif-model-gaps-card')).toBeNull();
  });

  it('W3: the page carries no reserved phrase and no exclamation mark', () => {
    renderWhatIf();
    const page = screen.getByTestId('whatif-page-wrap');
    expect(page.textContent).not.toContain('Suggested next step');
    expect(page.textContent).not.toContain('Note — not a warning.');
    expect(screen.getByTestId('whatif-compare-card').textContent).not.toContain('!');
  });
});
