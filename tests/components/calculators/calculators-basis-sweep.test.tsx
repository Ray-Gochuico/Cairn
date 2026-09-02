import { describe, it, beforeEach, afterEach, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { expectBasisDiscipline } from '../../helpers/basis-discipline';
import {
  CompoundInterestCard,
  COMPOUND_BASIS_FIGURES,
  COMPOUND_BASIS_CHARTS,
} from '@/pages/calculators/CompoundInterestCard';
import {
  PathToFiCard,
  PATH_TO_FI_BASIS_FIGURES,
  PATH_TO_FI_BASIS_CHARTS,
  PATH_TO_FI_HISTORY_BASIS_CHARTS,
} from '@/pages/calculators/PathToFiCard';
import { useAcceptancesStore } from '@/stores/disclosure-acceptances-store';
import { DISCLOSURES } from '@/legal/disclosures';
import { __resetDollarBasisForTests } from '@/lib/calculators/dollar-basis';
import { __resetScenarioAssumptionsForTests } from '@/lib/calculators/use-scenario-assumptions';
import { SCENARIO_STORAGE_KEY } from '@/lib/calculators/scenario-assumptions';
import { syncCalcScope, __resetCalcScopeForTests } from '@/lib/calculators/calc-view-scope';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSettingsStore } from '@/stores/settings-store';
import { FilingStatus, ContributionSource, SnapshotSource, AccountType } from '@/types/enums';
import type { Account, AppSettings, GrowthScenario, Person } from '@/types/schema';

/* ── Fixtures: verbatim copies of the two card test files' seeding, so the
      sweep runs on the SAME scenarios the anchor pairs pin. ─────────────── */

const PINNED_DATE = new Date('2026-05-14T12:00:00Z');

const fourScenarios: GrowthScenario[] = [
  { label: 'Conservative', rate: 0.05 },
  { label: 'Moderate', rate: 0.06 },
  { label: 'Optimistic', rate: 0.07 },
  { label: 'Bull', rate: 0.08 },
];

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
  useSettingsStore.setState({ settings: null, isLoading: false, error: null });
}

/** PathToFiCard.test.tsx's `primeStores` + `primeScoped` (person scope, so ALL
 *  five registered figures — the two exclusion figures included — render). */
function primeScoped() {
  useHouseholdStore.setState({
    household: {
      filingStatus: FilingStatus.SINGLE,
      state: 'CA',
      city: null,
      monthlyExpenseBaseline: 5000,
      withdrawalRate: 0.04,
      inflationAssumption: 0.03,
      growthScenarios: fourScenarios,
    },
    isLoading: false,
    error: null,
  });
  usePersonsStore.setState({
    persons: [
      { ...basePerson, id: 1, name: 'Alice', targetRetirementAge: 46 } as Person,
      { ...basePerson, id: 2, name: 'Bob', targetRetirementAge: 66 } as Person,
    ],
    isLoading: false,
    error: null,
  });
  useSnapshotsStore.setState({
    snapshots: [
      { accountId: 1, snapshotDate: '2026-04-01', totalValue: 100_000 },
      { accountId: 2, snapshotDate: '2026-04-01', totalValue: 40_000 },
      { accountId: 3, snapshotDate: '2026-04-01', totalValue: 8_000 },
    ].map((s, i) => ({
      id: i + 1,
      accountId: s.accountId,
      snapshotDate: s.snapshotDate,
      totalValue: s.totalValue,
      source: SnapshotSource.MANUAL,
    })),
    isLoading: false,
    error: null,
  });
  useAccountsStore.setState({
    accounts: [
      { ...mkAccount(1), ownerPersonId: 1 },
      { ...mkAccount(2), ownerPersonId: 2 },
      mkAccount(3),
    ],
    isLoading: false,
    error: null,
  });
  useContributionsStore.setState({
    contributions: [
      { id: 1, accountId: 2, personId: 2, date: '2026-04-15', amount: 1_200, source: ContributionSource.MANUAL },
      { id: 2, accountId: 3, personId: null, date: '2026-04-20', amount: 600, source: ContributionSource.MANUAL },
      { id: 3, accountId: 1, personId: 1, date: '2026-04-25', amount: 500, source: ContributionSource.MANUAL },
    ],
    isLoading: false,
    error: null,
  } as never);
}

/** CompoundInterestCard.test.tsx's `seedDemoScenario` (pv 1000, pmt 100/mo, 7% APY). */
function seedDemoScenario() {
  sessionStorage.setItem(
    SCENARIO_STORAGE_KEY,
    JSON.stringify({ portfolio: 1000, annualContribution: 1200, returnPct: 7 }),
  );
}

describe('W5 basis-audit render sweep (D-T5 guarantee 5)', () => {
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

  it('CompoundInterestCard: every registered figure obeys its class; no unregistered $ renders', () => {
    useSettingsStore.setState({
      settings: { defaultInflation: 0.025 } as AppSettings,
      isLoading: false,
      error: null,
    });
    seedDemoScenario();
    expectBasisDiscipline(<CompoundInterestCard />, {
      figures: COMPOUND_BASIS_FIGURES,
      charts: COMPOUND_BASIS_CHARTS,
    });
  });

  it('PathToFiCard (scoped, so ALL registered figures render): classes + completeness', () => {
    primeScoped();
    syncCalcScope(2);
    expectBasisDiscipline(
      <MemoryRouter initialEntries={['/calculators?view=p2']}>
        <PathToFiCard cardId="path-to-fi" />
      </MemoryRouter>,
      { figures: PATH_TO_FI_BASIS_FIGURES, charts: PATH_TO_FI_BASIS_CHARTS },
    );
  });

  /* ── W2 (D-UB13): the SAME sweep over the History view. The fan swaps the
        Assumed chart out, so the History pass registers its own chart list —
        PINNED today's dollars, byte-identical in both page bases — while every
        neighbouring figure keeps its landed class. Seeding the source key +
        the acceptance is what makes the gated view render. ───────────────── */

  const seedHistory = (cardId: string) => {
    sessionStorage.setItem(`calc-chart-source:${cardId}`, 'HISTORY');
    useAcceptancesStore.setState({
      acceptedVersions: { backtest: DISCLOSURES.backtest.version },
      status: 'ready',
      isLoading: false,
      error: null,
    });
  };

  it('PathToFiCard History view: the fan is a PINNED figure in both bases', () => {
    primeScoped();
    syncCalcScope(2);
    seedHistory('path-to-fi');
    expectBasisDiscipline(
      <MemoryRouter initialEntries={['/calculators?view=p2']}>
        <PathToFiCard cardId="path-to-fi" />
      </MemoryRouter>,
      { figures: PATH_TO_FI_BASIS_FIGURES, charts: PATH_TO_FI_HISTORY_BASIS_CHARTS },
    );
  });
});
