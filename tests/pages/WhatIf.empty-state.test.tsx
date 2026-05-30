import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import WhatIf from '@/pages/WhatIf';
import { FiPillsPosition } from '@/types/enums';
import { useSettingsStore } from '@/stores/settings-store';
import type { Household, Person } from '@/types/schema';

// W7-UX MF-1: when the projection cache returns rows whose monetary
// fields are all 0 (a sentinel state — e.g., seeded baseline scenario
// before any accounts / persons are wired up), Recharts auto-domains
// the y-axis from those zeros and paints raw-dollar $0/$1/$2/$3/$4
// ticks. The empty-state CTA must render instead.

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
vi.mock('@/components/whatif/FiCards', () => ({
  default: () => <div data-testid="whatif-fi-cards-wrap" />,
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
    investmentsByAccount: {},
    homeEquity: 0,
    incomeAfterTax: 0,
    expenses: 0,
    debtByLoan: {},
    loans: [],
    persons: [personFixture],
    inflation: 0.025,
    defaultReturnRate: 0.07,
  }),
}));

// Build a sentinel MonthlyState with all monetary fields = 0 — this
// mirrors what the engine emits before any accounts are wired up.
function makeZeroState(monthISO: string) {
  return {
    monthISO,
    investmentsByAccount: {},
    homeEquity: 0,
    cash: 0,
    debtByLoan: {},
    netWorth: 0,
    incomeAfterTax: 0,
    expenses: 0,
    savings: 0,
    events: [],
  };
}

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

// Mutable projection holder so tests can swap state shapes per case.
const __projectionState = {
  rows: [makeZeroState('2026-05'), makeZeroState('2026-06'), makeZeroState('2026-07')] as Array<ReturnType<typeof makeZeroState>>,
};

vi.mock('@/stores/scenarios-store', () => {
  return {
    useScenariosStore: (selector?: any) => {
      const state = {
        scenarios: [baseline],
        activeScenario: () => baseline,
        visibleScenarioIds: () => [1],
        load: vi.fn(),
        projectedScenarios: () =>
          new Map<number, ReturnType<typeof makeZeroState>[]>([[1, __projectionState.rows]]),
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

function seedSettings() {
  useSettingsStore.setState({
    settings: {
      id: 1,
      sidebarLayout: null,
      notificationsEnabled: true,
      notificationDay: 1,
      refreshCadence: 'EVERY_LAUNCH',
      lastRefreshAt: null,
      statementsFolderPath: null,
      defaultInflation: null,
      defaultReturnRate: null,
      defaultFiPillsPosition: FiPillsPosition.ABOVE,
    },
    isLoading: false,
    error: null,
    load: async () => {},
    update: async () => {},
  } as any);
}

describe('WhatIf — empty-state guard rejects sentinel zero-data projections (W7-UX MF-1)', () => {
  beforeEach(() => {
    seedSettings();
    // Default to all-zero sentinel rows; individual tests can replace.
    __projectionState.rows = [
      makeZeroState('2026-05'),
      makeZeroState('2026-06'),
      makeZeroState('2026-07'),
    ];
  });

  it('renders the empty-state CTA when every projection row has zero monetary fields', () => {
    render(
      <MemoryRouter>
        <WhatIf />
      </MemoryRouter>,
    );
    // The CTA is on screen, the chart stub is not.
    expect(screen.getByTestId('whatif-projection-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('projection-chart-stub')).not.toBeInTheDocument();
  });

  it('still renders the chart when at least one state has positive cash', () => {
    __projectionState.rows = [
      makeZeroState('2026-05'),
      { ...makeZeroState('2026-06'), cash: 1000 },
    ];
    render(
      <MemoryRouter>
        <WhatIf />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('projection-chart-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('whatif-projection-empty')).not.toBeInTheDocument();
  });

  it('still renders the chart when at least one state has positive netWorth', () => {
    __projectionState.rows = [
      { ...makeZeroState('2026-05'), netWorth: 250_000 },
      makeZeroState('2026-06'),
    ];
    render(
      <MemoryRouter>
        <WhatIf />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('projection-chart-stub')).toBeInTheDocument();
  });

  it('still renders the chart when at least one state has positive investments', () => {
    __projectionState.rows = [
      { ...makeZeroState('2026-05'), investmentsByAccount: { 7: 5000 } },
    ];
    render(
      <MemoryRouter>
        <WhatIf />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('projection-chart-stub')).toBeInTheDocument();
  });
});
