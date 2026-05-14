import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { FilingStatus, SnapshotSource } from '@/types/enums';
import { CoastFiCard } from '@/pages/calculators/CoastFiCard';
import type { GrowthScenario, Person } from '@/types/schema';

const fourScenarios: GrowthScenario[] = [
  { label: 'Conservative', rate: 0.05 },
  { label: 'Moderate', rate: 0.06 },
  { label: 'Optimistic', rate: 0.07 },
  { label: 'Bull', rate: 0.08 },
];

const basePerson: Person = {
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
};

function resetStores() {
  useHouseholdStore.setState({ household: null, isLoading: false, error: null });
  usePersonsStore.setState({ persons: [], isLoading: false, error: null });
  useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null });
}

function primeStores(opts?: {
  scenarios?: GrowthScenario[];
  monthlyExpenseBaseline?: number;
  withdrawalRate?: number;
  persons?: Person[];
  snapshotValues?: Array<{ accountId: number; snapshotDate: string; totalValue: number }>;
}) {
  useHouseholdStore.setState({
    household: {
      filingStatus: FilingStatus.SINGLE,
      state: 'CA',
      city: null,
      monthlyExpenseBaseline: opts?.monthlyExpenseBaseline ?? 5000,
      withdrawalRate: opts?.withdrawalRate ?? 0.04,
      inflationAssumption: 0.03,
      growthScenarios: opts?.scenarios ?? fourScenarios,
    },
    isLoading: false,
    error: null,
  });

  usePersonsStore.setState({
    persons: opts?.persons ?? [basePerson],
    isLoading: false,
    error: null,
  });

  // Default: $200k portfolio (one snapshot).
  const defaultSnapshots = opts?.snapshotValues ?? [
    { accountId: 1, snapshotDate: '2026-04-01', totalValue: 200000 },
  ];
  useSnapshotsStore.setState({
    snapshots: defaultSnapshots.map((s, i) => ({
      id: i + 1,
      accountId: s.accountId,
      snapshotDate: s.snapshotDate,
      totalValue: s.totalValue,
      source: SnapshotSource.MANUAL,
    })),
    isLoading: false,
    error: null,
  });
}

describe('CoastFiCard', () => {
  beforeEach(() => {
    resetStores();
    // Pin "today" to a stable date so currentAge is deterministic.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-14'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders empty state when household is not set', () => {
    render(
      <MemoryRouter>
        <CoastFiCard />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(/Add your inputs to see CoastFI/i),
    ).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders empty state when household has no growth scenarios', () => {
    primeStores({ scenarios: [] });
    render(
      <MemoryRouter>
        <CoastFiCard />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(/Add your inputs to see CoastFI/i),
    ).toBeInTheDocument();
  });

  it('renders empty state when persons list is empty', () => {
    primeStores({ persons: [] });
    render(
      <MemoryRouter>
        <CoastFiCard />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(/Add your inputs to see CoastFI/i),
    ).toBeInTheDocument();
  });

  it('renders headline "X% of CoastFI" when seeded with one person + snapshots', () => {
    primeStores();
    render(
      <MemoryRouter>
        <CoastFiCard />
      </MemoryRouter>,
    );

    const headline = screen.getByTestId('coastfi-headline');
    expect(headline.textContent).toMatch(/\d+(\.\d+)?%\s*of\s*CoastFI/i);
  });

  it('uses the shorter-horizon person for two-person households', () => {
    // Person A: 36 years old (born 1990-01-01), retire at 65 -> 29 years
    // Person B: 51 years old (born 1975-01-01), retire at 65 -> 14 years (shorter)
    // Coast amount needed today should reflect the 14-year horizon (more $).
    const personA = { ...basePerson, id: 1, dateOfBirth: '1990-01-01', targetRetirementAge: 65 };
    const personB: Person = {
      ...basePerson,
      id: 2,
      name: 'Bob',
      dateOfBirth: '1975-01-01',
      targetRetirementAge: 65,
    };
    primeStores({ persons: [personA, personB] });
    render(
      <MemoryRouter>
        <CoastFiCard />
      </MemoryRouter>,
    );

    // The years-until-retirement column for the Moderate row should show 14.
    // (We render years on every row, but the value is the same per scenario.)
    // Look for at least one cell containing "14" (years).
    const yearsCells = screen.getAllByText(/^14$/);
    expect(yearsCells.length).toBeGreaterThan(0);
  });

  it('caps headline at 100%+ when current portfolio already exceeds coast amount', () => {
    // 100-year-old at retirement age 65 => negative years -> coast hugely needed.
    // Inverse: massive portfolio with long horizon -> coast tiny -> >>100%.
    primeStores({
      snapshotValues: [
        { accountId: 1, snapshotDate: '2026-04-01', totalValue: 10_000_000 },
      ],
    });
    render(
      <MemoryRouter>
        <CoastFiCard />
      </MemoryRouter>,
    );

    const headline = screen.getByTestId('coastfi-headline');
    // Should be far above 100%
    const value = parseFloat(headline.textContent!.replace(/[^\d.]/g, ''));
    expect(value).toBeGreaterThanOrEqual(100);
  });

  it('renders all 4 scenarios from household.growthScenarios as table rows', () => {
    primeStores({ scenarios: fourScenarios });
    render(
      <MemoryRouter>
        <CoastFiCard />
      </MemoryRouter>,
    );

    expect(screen.getByText('Conservative')).toBeInTheDocument();
    expect(screen.getByText('Moderate')).toBeInTheDocument();
    expect(screen.getByText('Optimistic')).toBeInTheDocument();
    expect(screen.getByText('Bull')).toBeInTheDocument();

    expect(screen.getByText('5.0%')).toBeInTheDocument();
    expect(screen.getByText('6.0%')).toBeInTheDocument();
    expect(screen.getByText('7.0%')).toBeInTheDocument();
    expect(screen.getByText('8.0%')).toBeInTheDocument();
  });

  it('uses the latest snapshot per account when multiple are seeded', () => {
    // Two accounts, two snapshots each. pv = 100k + 200k = 300k.
    primeStores({
      snapshotValues: [
        { accountId: 1, snapshotDate: '2025-01-01', totalValue: 999_999 },
        { accountId: 1, snapshotDate: '2026-04-01', totalValue: 100_000 },
        { accountId: 2, snapshotDate: '2025-06-01', totalValue: 1 },
        { accountId: 2, snapshotDate: '2026-04-01', totalValue: 200_000 },
      ],
    });
    render(
      <MemoryRouter>
        <CoastFiCard />
      </MemoryRouter>,
    );

    // If older snapshots leaked in, pv would be ~1.3M and percent would skyrocket.
    // Correct pv=300k against a coast of (1.5M / 1.06^29) ~ $277k -> ~108%.
    const headline = screen.getByTestId('coastfi-headline');
    const value = parseFloat(headline.textContent!.replace(/[^\d.]/g, ''));
    expect(value).toBeGreaterThan(50);
    expect(value).toBeLessThan(500);
  });

  it('forwards cardId + onHide so the Hide button appears on the card', () => {
    primeStores();
    render(
      <MemoryRouter>
        <CoastFiCard cardId="coast-fi" onHide={() => {}} />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('button', { name: /hide coastfi card/i }),
    ).toBeInTheDocument();
  });

  it('shows the target portfolio derived from monthlyExpenseBaseline / withdrawalRate', () => {
    // 5000 * 12 / 0.04 = 1,500,000
    primeStores();
    render(
      <MemoryRouter>
        <CoastFiCard />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Target at retirement/i)).toBeInTheDocument();
    expect(screen.getByText(/\$1,500,000/)).toBeInTheDocument();
  });
});
