import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { seedWhatIfRealStores } from './whatif-store-seed';
import type { Household, Person } from '@/types/schema';
import type { Milestones, MonthlyState } from '@/lib/scenarios';

// Capture the milestones map handed to ProjectionChart so each test
// can introspect what detectMilestones was called with (indirectly —
// the WhatIf component's useMemo runs the real detectMilestones).
let capturedMilestones: Map<number, Milestones> | null = null;

vi.mock('@/components/whatif/ProjectionChart', () => ({
  default: (props: { milestones: Map<number, Milestones> }) => {
    capturedMilestones = props.milestones;
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
vi.mock('@/components/whatif/ScenariosPanel', () => ({
  default: () => <div data-testid="scenarios-panel-stub" />,
  ScenariosPanel: () => <div data-testid="scenarios-panel-stub" />,
}));
vi.mock('@/components/whatif/FiCards', () => ({
  default: () => <div data-testid="fi-cards-stub" />,
}));

const householdBase: Household = {
  id: 1,
  name: null,
  filingStatus: 'SINGLE',
  state: 'CA',
  city: null,
  monthlyExpenseBaseline: 4000,
  withdrawalRate: 0.04,
  inflationAssumption: 0.025,
  growthScenarios: [{ label: 'Moderate', rate: 0.06 }],
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
    investments: 100000,
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

vi.mock('@/stores/loans-store', () => ({
  useLoansStore: (selector?: any) => {
    const state = { loans: [], isLoading: false, error: null, load: vi.fn() };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

// Variable household / scenarios per test, mutated via setHouseholdRate / setScenarioOverride.
let householdRate = 0.04;
let scenarioOverride: number | null = null;

vi.mock('@/stores/household-store', () => ({
  useHouseholdStore: (selector?: any) => {
    const state = {
      household: { ...householdBase, withdrawalRate: householdRate },
      load: vi.fn(),
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

vi.mock('@/stores/persons-store', () => ({
  usePersonsStore: (selector?: any) => {
    const state = { persons: [personFixture], load: vi.fn() };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

// Build a 24-month projection where investments cross a clear threshold:
// month 0:    $1,000,000
// month 12:   $1,100,000
// month 23:   $1,300,000
// So at SWR 0.04 (FI = 4000*12/0.04 = 1.2M), the FI ISO falls in months 13-23.
// At SWR 0.05 (FI = 960k), FI is crossed at month 0.
// At SWR 0.035 (FI ≈ 1.371M), FI is never reached (no ISO).
function buildStates(): MonthlyState[] {
  const states: MonthlyState[] = [];
  for (let i = 0; i < 24; i++) {
    const investments = 1_000_000 + i * 12_500;
    const monthIndex = i + 4; // start May (05)
    const year = 2026 + Math.floor(monthIndex / 12);
    const month = ((monthIndex % 12) + 1).toString().padStart(2, '0');
    states.push({
      monthISO: `${year}-${month}`,
      investmentsByAccount: { 1: investments },
      homeEquity: 0,
      cash: 0,
      debtByLoan: {},
      netWorth: investments,
      incomeAfterTax: 0,
      expenses: 4000,
      savings: 0,
      events: [],
    } as MonthlyState);
  }
  return states;
}

vi.mock('@/stores/scenarios-store', () => {
  return {
    useScenariosStore: (selector?: any) => {
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
          retirementAgeOverride: null,
          swrOverride: scenarioOverride,
        },
        createdAt: '',
        updatedAt: '',
      };
      const state = {
        scenarios: [baseline],
        activeScenario: () => baseline,
        visibleScenarioIds: () => [1],
        load: vi.fn(),
        projectedScenarios: () => new Map([[1, buildStates()]]),
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

// Import WhatIf AFTER mocks are set up.
import WhatIf from '@/pages/WhatIf';

describe('WhatIf — milestone params derive from household.withdrawalRate (was hardcoded 0.04)', () => {
  beforeEach(() => {
    seedWhatIfRealStores();
    capturedMilestones = null;
    householdRate = 0.04;
    scenarioOverride = null;
  });

  it('detectMilestones uses household.withdrawalRate=0.04 → FI crossed mid-projection (financialIndependenceISO is set)', () => {
    householdRate = 0.04; // FI target = $1,200,000; crossed around month 16.
    render(
      <MemoryRouter>
        <WhatIf />
      </MemoryRouter>,
    );
    expect(capturedMilestones).not.toBeNull();
    const m = capturedMilestones!.get(1);
    expect(m).toBeDefined();
    expect(m!.financialIndependenceISO).toBeDefined();
  });

  it('detectMilestones uses household.withdrawalRate=0.035 → FI target = $1,371k, never crossed in 24mo projection', () => {
    householdRate = 0.035; // FI = 4000*12/0.035 = ~1.37M; max investments = 1.288M → NEVER crossed.
    render(
      <MemoryRouter>
        <WhatIf />
      </MemoryRouter>,
    );
    expect(capturedMilestones).not.toBeNull();
    const m = capturedMilestones!.get(1);
    expect(m).toBeDefined();
    // If detectMilestones still used hardcoded 0.04, FI ISO would be set.
    // With the fix using household rate 0.035 → never crossed.
    expect(m!.financialIndependenceISO).toBeUndefined();
  });

  it('scenario.leverPayload.swrOverride beats household.withdrawalRate', () => {
    // Household says 0.035 (FI = 1.37M, never crossed). Scenario override
    // says 0.05 (FI = 960k, crossed at month 0). FI should be set.
    householdRate = 0.035;
    scenarioOverride = 0.05;
    render(
      <MemoryRouter>
        <WhatIf />
      </MemoryRouter>,
    );
    expect(capturedMilestones).not.toBeNull();
    const m = capturedMilestones!.get(1);
    expect(m).toBeDefined();
    expect(m!.financialIndependenceISO).toBeDefined();
    // FI was crossed at the very first state (May 2026)
    expect(m!.financialIndependenceISO).toBe('2026-05');
  });
});
