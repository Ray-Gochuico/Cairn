import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import WhatIf from '@/pages/WhatIf';
import { seedWhatIfRealStores } from './whatif-store-seed';
import type { Household, Person } from '@/types/schema';

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

vi.mock('@/stores/scenarios-store', () => {
  const baseline = {
    id: 1,
    name: 'Baseline',
    isBaseline: true,
    color: '#4f86f7',
    lineStyle: 'solid',
    visible: true,
    isActive: true,
    sortOrder: 0,
    leverPayload: {
      extraLoanPayments: [],
      lumpSums: [],
      expensePeriods: [],
      returns: { defaultRate: 0.07, overrides: {} },
      income: { perPerson: [{ annualRaiseRate: 0.03, events: [] }] },
      contributions: [],
    },
    createdAt: '',
    updatedAt: '',
  };
  const seedState = {
    monthISO: '2026-05',
    investmentsByAccount: { 1: 200_000 },
    homeEquity: 0,
    cash: 50_000,
    debtByLoan: {},
    netWorth: 250_000,
    incomeAfterTax: 0,
    expenses: 0,
    savings: 0,
    events: [],
  };
  return {
    useScenariosStore: (selector?: any) => {
      const state = {
        scenarios: [baseline],
        activeScenario: () => baseline,
        visibleScenarioIds: () => [1],
        load: vi.fn(),
        projectedScenarios: () => new Map([[1, [seedState]]]),
        dollarMode: 'nominal',
        inflation: 0.025,
        horizonMonths: 360,
        toggleVisibility: vi.fn(),
        setActive: vi.fn(),
        duplicate: vi.fn(),
        remove: vi.fn(),
        rename: vi.fn(),
        saveCurrentAsScenario: vi.fn().mockResolvedValue(2),
      };
      return typeof selector === 'function' ? selector(state) : state;
    },
  };
});

vi.mock('@/stores/loans-store', () => ({
  useLoansStore: (selector?: any) => {
    const state = { loans: [], isLoading: false, error: null, load: vi.fn() };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

vi.mock('@/stores/household-store', () => ({
  useHouseholdStore: (selector?: any) => {
    const state = { household: householdFixture, load: vi.fn() };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

vi.mock('@/stores/persons-store', () => ({
  usePersonsStore: (selector?: any) => {
    const state = { persons: [personFixture], load: vi.fn() };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

describe('WhatIf page — FI cards integration', () => {
  beforeEach(() => {
    seedWhatIfRealStores();
  });

  it('renders the Financial Independence number + Coast FI cards above the chart', () => {
    render(
      <MemoryRouter>
        <WhatIf />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('whatif-fi-cards')).toBeInTheDocument();
    expect(screen.getByTestId('whatif-fi-number')).toBeInTheDocument();
    expect(screen.getByTestId('whatif-coastfi-number')).toBeInTheDocument();
  });

  it('Financial Independence number reflects 4% rule × monthly expenses × 12', () => {
    render(
      <MemoryRouter>
        <WhatIf />
      </MemoryRouter>,
    );
    // 4000 * 12 / 0.04 = 1,200,000
    expect(screen.getByTestId('whatif-fi-number')).toHaveTextContent('$1,200,000');
  });

  it('progress row uses liquid NW (investments + cash) from the active scenario seed state', () => {
    render(
      <MemoryRouter>
        <WhatIf />
      </MemoryRouter>,
    );
    // Liquid NW = 200,000 + 50,000 = 250,000 (homeEquity is NOT included)
    const progress = screen.getByTestId('whatif-fi-number-progress');
    expect(progress).toHaveTextContent('$250,000');
  });
});
