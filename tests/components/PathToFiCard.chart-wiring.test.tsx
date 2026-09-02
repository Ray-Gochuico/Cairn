import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { FilingStatus, ContributionSource, SnapshotSource, AccountType } from '@/types/enums';
import { PathToFiCard } from '@/pages/calculators/PathToFiCard';
import { __resetScenarioAssumptionsForTests } from '@/lib/calculators/use-scenario-assumptions';
import { __resetCalcScopeForTests } from '@/lib/calculators/calc-view-scope';
import {
  CALCULATORS_PAGE_ID,
  __resetDollarBasisForTests,
  useDollarBasisStore,
} from '@/lib/calculators/dollar-basis';
import type { Account, GrowthScenario, Person } from '@/types/schema';

// Probe: replace InlineChart with a JSON dump of its `data` prop — the render
// sweep cannot see plotted values (spec m4); this pins the wiring instead.
vi.mock('@/components/charts/InlineChart', () => ({
  InlineChart: (props: {
    data: Array<Record<string, unknown>>;
    label?: string;
    labelTestId?: string;
    testId?: string;
  }) => (
    <div data-testid={props.testId ?? 'chart'}>
      <div data-testid={props.labelTestId}>{props.label}</div>
      <pre data-testid={`${props.testId ?? 'chart'}-data-probe`}>{JSON.stringify(props.data)}</pre>
    </div>
  ),
}));

// Fixture copied verbatim from tests/components/PathToFiCard.test.tsx.
const PINNED_DATE = new Date('2026-05-14T12:00:00Z');

const basePerson = {
  id: 1,
  householdId: 1,
  name: 'Alice',
  dateOfBirth: '1990-01-01',
  targetRetirementAge: 65,
  annualSalaryPretax: 100000,
  expectedBonus: 0,
  expectedBonusFrequency: 'ANNUAL' as const,
  bonusIsConsistent: true,
  expectedCommission: 0,
  expectedCommissionFrequency: 'MONTHLY' as const,
  employmentType: 'SALARY_NO_OT' as const,
  hourlyRate: null,
  regularHoursPerWeek: 40,
  otThresholdHoursPerWeek: 40,
  pretax401kPct: 0,
  healthInsuranceMonthlyPremium: 0,
  dependentCareFsaMonthly: 0,
  hsaMonthlyContribution: 0,
  hsaEligible: false,
};

function mkAccount(id: number, type: AccountType = AccountType.ACCOUNT_BROKERAGE): Account {
  return {
    id,
    householdId: 1,
    ownerPersonId: null,
    beneficiaryDependentId: null,
    name: `Acct ${id}`,
    institution: null,
    type,
    cryptoWalletAddress: null,
    autoFetchEnabled: false,
    excludedFromNetWorth: false,
    stateOfPlan: null,
    accentColor: null,
  } as unknown as Account;
}

function resetStores() {
  useHouseholdStore.setState({ household: null, isLoading: false, error: null });
  usePersonsStore.setState({ persons: [], isLoading: false, error: null });
  useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null });
  useContributionsStore.setState({ contributions: [], isLoading: false, error: null });
  useAccountsStore.setState({ accounts: [], isLoading: false, error: null });
}

function primeStores(opts?: { scenarios?: GrowthScenario[] }) {
  useHouseholdStore.setState({
    household: {
      filingStatus: FilingStatus.SINGLE,
      state: 'CA',
      city: null,
      monthlyExpenseBaseline: 5000,
      withdrawalRate: 0.04,
      inflationAssumption: 0.03,
      growthScenarios: opts?.scenarios ?? [{ label: 'Moderate', rate: 0.06 }],
    },
    isLoading: false,
    error: null,
  });
  usePersonsStore.setState({
    persons: [basePerson as Person],
    isLoading: false,
    error: null,
  });
  useSnapshotsStore.setState({
    snapshots: [
      {
        id: 1,
        accountId: 1,
        snapshotDate: '2026-04-01',
        totalValue: 200000,
        source: SnapshotSource.MANUAL,
      },
    ],
    isLoading: false,
    error: null,
  });
  useAccountsStore.setState({ accounts: [mkAccount(1)], isLoading: false, error: null });
  useContributionsStore.setState({
    contributions: Array.from({ length: 12 }, (_, i) => {
      const d = new Date(PINNED_DATE);
      d.setMonth(d.getMonth() - i);
      return {
        id: i + 1,
        accountId: 1,
        personId: 1,
        date: d.toISOString().slice(0, 10),
        amount: 2000,
        source: ContributionSource.MANUAL,
      };
    }),
    isLoading: false,
    error: null,
  });
}

const renderCard = () =>
  render(
    <MemoryRouter>
      <PathToFiCard />
    </MemoryRouter>,
  );

describe('W5 chart wiring (m4 layer b): the RENDERED PathToFi target line', () => {
  beforeEach(() => {
    resetStores();
    sessionStorage.clear();
    __resetScenarioAssumptionsForTests();
    __resetCalcScopeForTests();
    __resetDollarBasisForTests();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(PINNED_DATE);
  });
  afterEach(() => vi.useRealTimers());

  it('plotted target line: flat at $1,500,000 under Today, grows by 1.03^t under Future (both from the RENDERED card)', () => {
    primeStores({ scenarios: [{ label: 'Moderate', rate: 0.06 }] });
    renderCard();
    const data = () =>
      JSON.parse(screen.getByTestId('path-to-fi-chart-data-probe').textContent ?? '[]') as Array<{
        year: number;
        target: number;
      }>;

    const today = data();
    expect(today[0].target).toBeCloseTo(1_500_000, 6);
    expect(today[today.length - 1].target).toBeCloseTo(1_500_000, 6); // REAL: flat

    act(() => useDollarBasisStore.getState().setBasis(CALCULATORS_PAGE_ID, 'future'));
    const future = data();
    const last = future.length - 1;
    expect(future[0].target).toBeCloseTo(1_500_000, 6);
    expect(future[last].target).toBeCloseTo(1_500_000 * Math.pow(1.03, future[last].year), 4); // NOMINAL: grown
  });
});
