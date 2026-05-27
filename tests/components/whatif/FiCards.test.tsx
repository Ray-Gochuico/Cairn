import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import FiCards from '@/components/whatif/FiCards';
import { emptyLeverPayload } from '@/lib/scenarios';
import type { MonthlyState } from '@/lib/scenarios';
import type { Scenario } from '@/types/scenario';
import type { Household, Person } from '@/types/schema';

function makeHousehold(overrides: Partial<Household> = {}): Household {
  return {
    id: 1,
    name: null,
    filingStatus: 'SINGLE',
    state: 'CA',
    city: null,
    monthlyExpenseBaseline: 4000, // → fiTarget = 48000 / 0.04 = 1,200,000
    withdrawalRate: 0.04,
    inflationAssumption: 0.025,
    growthScenarios: [
      { label: 'Conservative', rate: 0.04 },
      { label: 'Moderate', rate: 0.06 },
      { label: 'Aggressive', rate: 0.08 },
    ],
    disclaimerAcceptedAt: null,
    disclaimerVersionAccepted: null,
    roadmapDisclaimerAcceptedAt: null,
    roadmapDisclaimerVersionAccepted: null,
    interestThresholdLowPct: null,
    interestThresholdHighPct: null,
    hasWrittenIps: null,
    hasHsaQualifiedHdhp: null,
    makesCharitableGifts: null,
    upcomingLargePurchase: null,
    upcomingPurchaseAmount: null,
    upcomingPurchaseMonths: null,
    ...overrides,
  } as Household;
}

function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    id: 1,
    householdId: 1,
    name: 'P1',
    dateOfBirth: '1990-01-01',     // ~35y old at 2025/2026
    targetRetirementAge: 65,
    annualSalaryPretax: 100000,
    expectedBonus: 0,
    ...overrides,
  } as unknown as Person;
}

function makeScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: 1,
    name: 'Baseline',
    isBaseline: true,
    color: '#4f86f7',
    lineStyle: 'solid',
    visible: true,
    isActive: true,
    sortOrder: 0,
    leverPayload: emptyLeverPayload(),
    createdAt: '2026-05-24T00:00:00Z',
    updatedAt: '2026-05-24T00:00:00Z',
    ...overrides,
  };
}

function seedState(investments: number, cash: number): MonthlyState[] {
  // Engine produces MonthlyState[] keyed by month. For the cards we only
  // read states[0] (the seed snapshot).
  return [
    {
      monthISO: '2026-05',
      investmentsByAccount: { 1: investments },
      homeEquity: 0,
      cash,
      debtByLoan: {},
      netWorth: investments + cash,
      incomeAfterTax: 0,
      expenses: 0,
      savings: 0,
      events: [],
    },
  ];
}

describe('FiCards', () => {
  it('renders Financial Independence number = annual_expenses / withdrawal_rate', () => {
    const projections = new Map<number, MonthlyState[]>([[1, seedState(100_000, 50_000)]]);
    render(
      <FiCards
        scenarios={[makeScenario()]}
        projections={projections}
        household={makeHousehold()}
        persons={[makePerson()]}
      />,
    );
    // 4000 * 12 / 0.04 = 1,200,000
    const fi = screen.getByTestId('whatif-fi-number');
    expect(fi).toHaveTextContent('$1,200,000');
    expect(fi).toHaveTextContent('4.0% rule');
  });

  it('renders Coast FI target derived from the moderate growth rate', () => {
    const projections = new Map<number, MonthlyState[]>([[1, seedState(100_000, 50_000)]]);
    render(
      <FiCards
        scenarios={[makeScenario()]}
        projections={projections}
        household={makeHousehold()}
        persons={[makePerson()]}
      />,
    );
    // Coast FI = 1,200,000 / (1.06 ^ yearsUntilRetirement). Don't depend on
    // current calendar time precisely — just check the card renders and
    // contains a dollar figure plus the explainer fragment.
    // Note: "Coast FI" is now wrapped in <TermTooltip>, which inserts an
    // inline ⓘ icon between "Coast FI" and " target today". Match the two
    // halves independently rather than as a contiguous substring.
    const coast = screen.getByTestId('whatif-coastfi-number');
    expect(coast).toHaveTextContent(/Coast FI/);
    expect(coast).toHaveTextContent(/target today/);
    expect(coast).toHaveTextContent('Moderate 6.0% growth');
    expect(coast).toHaveTextContent('$');
  });

  it('progress row shows liquid NW (investments + cash, no home equity)', () => {
    // Liquid NW must equal investments + cash. Set investments=200k, cash=100k
    // → liquid = 300k. Home equity (here baked into the seed snapshot at 0
    // anyway) MUST NOT be included.
    const projections = new Map<number, MonthlyState[]>([[1, seedState(200_000, 100_000)]]);
    render(
      <FiCards
        scenarios={[makeScenario()]}
        projections={projections}
        household={makeHousehold()}
        persons={[makePerson()]}
      />,
    );
    const fiProgress = screen.getByTestId('whatif-fi-number-progress');
    expect(fiProgress).toHaveTextContent('$300,000');
    expect(fiProgress).toHaveTextContent('25%'); // 300k / 1.2M
  });

  it('returns null when household has no growth scenarios', () => {
    const projections = new Map<number, MonthlyState[]>([[1, seedState(100_000, 50_000)]]);
    const { container } = render(
      <FiCards
        scenarios={[makeScenario()]}
        projections={projections}
        household={makeHousehold({ growthScenarios: [] })}
        persons={[makePerson()]}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('falls back to 4% rule when household.withdrawalRate is zero (no scenario override)', () => {
    // effectiveSwr() defensively falls back to 0.04 when both scenario override
    // and household.withdrawalRate are unset/zero. This keeps the FI / Coast FI
    // cards renderable during cold-start instead of disappearing.
    const projections = new Map<number, MonthlyState[]>([[1, seedState(100_000, 50_000)]]);
    render(
      <FiCards
        scenarios={[makeScenario()]}
        projections={projections}
        household={makeHousehold({ withdrawalRate: 0 })}
        persons={[makePerson()]}
      />,
    );
    const fi = screen.getByTestId('whatif-fi-number');
    expect(fi).toHaveTextContent('$1,200,000'); // 4000 * 12 / 0.04
    expect(fi).toHaveTextContent('4.0% rule');
  });

  it('returns null when there are no projections for the active scenario', () => {
    const { container } = render(
      <FiCards
        scenarios={[makeScenario()]}
        projections={new Map()}
        household={makeHousehold()}
        persons={[makePerson()]}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the retirement-age control with the person default when no override is set', () => {
    const projections = new Map<number, MonthlyState[]>([[1, seedState(100_000, 50_000)]]);
    render(
      <FiCards
        scenarios={[makeScenario()]}
        projections={projections}
        household={makeHousehold()}
        persons={[makePerson({ targetRetirementAge: 60 })]}
      />,
    );
    const control = screen.getByTestId('whatif-retirement-age-control');
    expect(control).toBeInTheDocument();
    const input = screen.getByLabelText('Retirement age') as HTMLInputElement;
    expect(input.value).toBe('60');
    // Override-tag only shown when override is set.
    expect(control).not.toHaveTextContent('override');
  });

  it('retirement-age control reflects the override when present', () => {
    const projections = new Map<number, MonthlyState[]>([[1, seedState(100_000, 50_000)]]);
    const lp = emptyLeverPayload();
    lp.retirementAgeOverride = 55;
    render(
      <FiCards
        scenarios={[makeScenario({ leverPayload: lp })]}
        projections={projections}
        household={makeHousehold()}
        persons={[makePerson({ targetRetirementAge: 65 })]}
      />,
    );
    const input = screen.getByLabelText('Retirement age') as HTMLInputElement;
    expect(input.value).toBe('55');
    expect(screen.getByTestId('whatif-retirement-age-control')).toHaveTextContent('override');
  });

  describe('SWR override routing', () => {
    it('FI target reflects scenario.leverPayload.swrOverride when set, not household.withdrawalRate', () => {
      const projections = new Map<number, MonthlyState[]>([[1, seedState(100_000, 50_000)]]);
      const lp = emptyLeverPayload();
      lp.swrOverride = 0.05; // 4000 * 12 / 0.05 = 960,000
      render(
        <FiCards
          scenarios={[makeScenario({ leverPayload: lp })]}
          projections={projections}
          household={makeHousehold()} // withdrawalRate = 0.04 → would give $1,200,000
          persons={[makePerson()]}
        />,
      );
      const fi = screen.getByTestId('whatif-fi-number');
      expect(fi).toHaveTextContent('$960,000');
      // The household-default-derived target ($1,200,000) MUST NOT appear:
      expect(fi).not.toHaveTextContent('$1,200,000');
    });

    it('FI target reflects household.withdrawalRate when scenario.swrOverride is null', () => {
      const projections = new Map<number, MonthlyState[]>([[1, seedState(100_000, 50_000)]]);
      render(
        <FiCards
          scenarios={[makeScenario()]} // empty payload → swrOverride: null
          projections={projections}
          household={makeHousehold()} // withdrawalRate = 0.04
          persons={[makePerson()]}
        />,
      );
      const fi = screen.getByTestId('whatif-fi-number');
      expect(fi).toHaveTextContent('$1,200,000');
    });

    it('displayed withdrawal-rate label reflects the effective SWR (override)', () => {
      const projections = new Map<number, MonthlyState[]>([[1, seedState(100_000, 50_000)]]);
      const lp = emptyLeverPayload();
      lp.swrOverride = 0.035;
      render(
        <FiCards
          scenarios={[makeScenario({ leverPayload: lp })]}
          projections={projections}
          household={makeHousehold()} // withdrawalRate = 0.04
          persons={[makePerson()]}
        />,
      );
      const fi = screen.getByTestId('whatif-fi-number');
      expect(fi).toHaveTextContent('3.5% rule');
      // Should not show 4.0% (the household-default rate)
      expect(fi).not.toHaveTextContent('4.0% rule');
    });
  });

  it('prefers active scenario over baseline when both are present', () => {
    // Active scenario has different liquid NW than baseline. Card should
    // display the active one's liquid NW in the progress row.
    const baseline = makeScenario({ id: 1, isBaseline: true, isActive: false });
    const active = makeScenario({
      id: 2,
      name: 'Aggressive',
      isBaseline: false,
      isActive: true,
    });
    const projections = new Map<number, MonthlyState[]>([
      [1, seedState(50_000, 25_000)],   // baseline liquid = 75k
      [2, seedState(500_000, 100_000)], // active liquid = 600k
    ]);
    render(
      <FiCards
        scenarios={[baseline, active]}
        projections={projections}
        household={makeHousehold()}
        persons={[makePerson()]}
      />,
    );
    const fiProgress = screen.getByTestId('whatif-fi-number-progress');
    expect(fiProgress).toHaveTextContent('$600,000');
  });
});
