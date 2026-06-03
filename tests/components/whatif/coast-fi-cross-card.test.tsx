import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import FiCards from '@/components/whatif/FiCards';
import { CoastFiCard } from '@/pages/calculators/CoastFiCard';
import { coastFi } from '@/lib/coast-fi';
import { realRateOf } from '@/lib/calculators/real-rate';
import { formatCurrency } from '@/lib/format';
import { emptyLeverPayload } from '@/lib/scenarios';
import type { MonthlyState } from '@/lib/scenarios';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useSettingsStore } from '@/stores/settings-store';
import { FilingStatus, SnapshotSource } from '@/types/enums';
import type { GrowthScenario, Person, Household } from '@/types/schema';
import type { Scenario } from '@/types/scenario';

/**
 * N1 regression: the dashboard FI/Coast cards and the What-If FiCards must
 * produce IDENTICAL "Coast needed today" numbers for the same household.
 *
 * The bug this guards: the dashboard read inflation from
 * settings.defaultInflation (no floor) while What-If read
 * household.inflationAssumption (floored). With a household that SETS its own
 * inflation (the diverging case), the two surfaces disagreed ~2× (the maintainer
 * measured household 5% + settings 2.5% → dashboard ≈$566k vs What-If ≈$1.14M).
 *
 * The fix routes BOTH through effectiveBaselineInflation (household wins) and
 * the SINGLE shared realRateOf (same 0-floor). This test pins that they agree.
 */

// Single "Moderate" scenario so BOTH surfaces pick the same growth rate
// (dashboard reads household.growthScenarios; What-If's pickRate prefers
// "Moderate"). 7% nominal exercises the real-rate conversion meaningfully.
const MODERATE: GrowthScenario[] = [{ label: 'Moderate', rate: 0.07 }];

// Pinned so currentAge() is deterministic. Person born 1990-01-01 → age 36 →
// retire 65 → 29 years to retirement on BOTH surfaces (clearly positive, so
// What-If's Math.max(0, …) clamp and the dashboard default agree).
const PINNED = new Date('2026-05-14T12:00:00Z');

// THE DIVERGING CASE: household sets inflation 5%, settings default 2.5%.
// Pre-fix these produced ~2× different coast numbers.
const HOUSEHOLD_INFLATION = 0.05;
const SETTINGS_INFLATION = 0.025;

const MONTHLY_EXPENSES = 5000; // → annual 60,000
const SWR = 0.04; // → fiTarget = 60,000 / 0.04 = 1,500,000

function household(): Household {
  return {
    id: 1,
    name: null,
    filingStatus: FilingStatus.SINGLE,
    state: 'CA',
    city: null,
    monthlyExpenseBaseline: MONTHLY_EXPENSES,
    withdrawalRate: SWR,
    inflationAssumption: HOUSEHOLD_INFLATION,
    growthScenarios: MODERATE,
    interestThresholdLowPct: null,
    interestThresholdHighPct: null,
    hasWrittenIps: null,
    hasHsaQualifiedHdhp: null,
    makesCharitableGifts: null,
    upcomingLargePurchase: null,
    upcomingPurchaseAmount: null,
    upcomingPurchaseMonths: null,
  } as Household;
}

const person: Person = {
  id: 1,
  householdId: 1,
  name: 'Alice',
  dateOfBirth: '1990-01-01',
  targetRetirementAge: 65,
  annualSalaryPretax: 100000,
  expectedBonus: 0,
  expectedBonusFrequency: 'ANNUAL',
  bonusIsConsistent: true,
  expectedCommission: 0,
  expectedCommissionFrequency: 'MONTHLY',
  employmentType: 'SALARY_NO_OT',
  hourlyRate: null,
  regularHoursPerWeek: 40,
  otThresholdHoursPerWeek: 40,
  pretax401kPct: 0,
  healthInsuranceMonthlyPremium: 0,
  dependentCareFsaMonthly: 0,
  hsaMonthlyContribution: 0,
  hsaEligible: false,
} as Person;

function baselineScenario(): Scenario {
  return {
    id: 1,
    name: 'Baseline',
    isBaseline: true,
    isActive: true,
    visible: true,
    color: '#4f86f7',
    lineStyle: 'solid',
    sortOrder: 0,
    leverPayload: emptyLeverPayload(),
    createdAt: '2026-05-24T00:00:00Z',
    updatedAt: '2026-05-24T00:00:00Z',
  } as Scenario;
}

function seedState(): MonthlyState[] {
  return [
    {
      monthISO: '2026-05',
      investmentsByAccount: { 1: 300_000 },
      homeEquity: 0,
      cash: 0,
      debtByLoan: {},
      netWorth: 300_000,
      incomeAfterTax: 0,
      expenses: 0,
      savings: 0,
      events: [],
    },
  ];
}

function primeDashboardStores() {
  useHouseholdStore.setState({ household: household(), isLoading: false, error: null });
  usePersonsStore.setState({ persons: [person], isLoading: false, error: null });
  useSnapshotsStore.setState({
    snapshots: [
      { id: 1, accountId: 1, snapshotDate: '2026-04-01', totalValue: 300_000, source: SnapshotSource.MANUAL },
    ],
    isLoading: false,
    error: null,
  });
}

describe('N1: dashboard CoastFiCard ⇄ What-If FiCards coast agreement', () => {
  beforeEach(() => {
    useHouseholdStore.setState({ household: null, isLoading: false, error: null });
    usePersonsStore.setState({ persons: [], isLoading: false, error: null });
    useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null });
    // settings.defaultInflation = 2.5% — DIFFERENT from the household's 5% so a
    // regression to the settings source would change the number and fail.
    useSettingsStore.setState({
      settings: { id: 1, defaultInflation: SETTINGS_INFLATION } as never,
      isLoading: false,
      error: null,
    } as never);
    sessionStorage.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(PINNED);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('both surfaces show the SAME Coast-needed-today figure (household inflation wins on both)', () => {
    // ── Hand-derived expected (household inflation 5%, NOT settings 2.5%) ──────
    // fiTarget = 60,000 / 0.04 = 1,500,000 (today's dollars)
    // real rate = max(0, (1.07/1.05) − 1) = 0.0190476190...
    // years = 29 ; coast = 1,500,000 / 1.0190476190^29
    const fiTarget = (MONTHLY_EXPENSES * 12) / SWR;
    const realRate = realRateOf(0.07, HOUSEHOLD_INFLATION);
    const expectedCoast = coastFi({ requiredAtRetirement: fiTarget, annualRate: realRate, yearsUntilRetirement: 29 });
    const expectedStr = formatCurrency(expectedCoast); // e.g. "$867,…"

    // Sanity: the WRONG (settings-2.5%) answer must differ from the expected one,
    // otherwise this test couldn't detect the regression it guards.
    const wrongCoast = coastFi({
      requiredAtRetirement: fiTarget,
      annualRate: realRateOf(0.07, SETTINGS_INFLATION),
      yearsUntilRetirement: 29,
    });
    expect(formatCurrency(wrongCoast)).not.toBe(expectedStr);

    // ── What-If FiCards coast figure ─────────────────────────────────────────
    const projections = new Map<number, MonthlyState[]>([[1, seedState()]]);
    const { unmount } = render(
      <MemoryRouter>
        <FiCards
          scenarios={[baselineScenario()]}
          projections={projections}
          household={household()}
          persons={[person]}
        />
      </MemoryRouter>,
    );
    const whatIfCoastEl = screen.getByTestId('whatif-coastfi-number');
    // The big number is formatCurrency(coastFiTarget); assert it's the expected.
    expect(whatIfCoastEl).toHaveTextContent(expectedStr);
    unmount();

    // ── Dashboard CoastFiCard coast figure (Moderate row "Coast today") ──────
    primeDashboardStores();
    render(<MemoryRouter><CoastFiCard /></MemoryRouter>);
    // The single Moderate row renders formatCurrency(coastNeededToday).
    const moderateRow = screen.getByText('Moderate').closest('tr')!;
    expect(within(moderateRow).getByText(expectedStr)).toBeInTheDocument();
  });
});
