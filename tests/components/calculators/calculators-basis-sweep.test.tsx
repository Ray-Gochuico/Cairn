import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ReactNode } from 'react';

// W-I: the house recharts mock (verbatim from the two *.history.test.tsx
// siblings). jsdom renders no recharts SVG, so the sweep's rows hook needs the
// mocked ComposedChart to expose the plotted rows as `data-rows` — the same
// element the history files pin. Chart interiors stay exempt from the
// completeness scan; captions live outside recharts and are unaffected.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ComposedChart: ({ children, data }: { children?: ReactNode; data?: unknown[] }) => (
    <div data-testid="rc-composed-chart" data-rows={JSON.stringify(data ?? [])}>
      {children}
    </div>
  ),
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Line: (p: Record<string, unknown>) => (
    <div
      data-testid={`rc-line-${String(p.dataKey)}`}
      data-stroke={String(p.stroke ?? '')}
      data-stroke-width={String(p.strokeWidth ?? '')}
      data-animation={String(p.isAnimationActive)}
    />
  ),
  Area: (p: Record<string, unknown>) => (
    <div
      data-testid={`rc-area-${String(p.dataKey)}`}
      data-stack={String(p.stackId ?? '')}
      data-fill={String(p.fill ?? '')}
      data-fill-opacity={String(p.fillOpacity ?? '')}
      data-animation={String(p.isAnimationActive)}
      data-tooltip-type={String(p.tooltipType ?? '')}
      data-legend-type={String(p.legendType ?? '')}
    />
  ),
  ReferenceDot: (p: Record<string, unknown>) => (
    <div data-testid="rc-refdot" data-x={String(p.x)} data-shape={p.shape ? 'custom' : ''} />
  ),
}));

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expectBasisDiscipline } from '../../helpers/basis-discipline';
import {
  CompoundInterestCard,
  COMPOUND_BASIS_FIGURES,
  COMPOUND_BASIS_CHARTS,
  COMPOUND_HISTORY_BASIS_CHARTS,
} from '@/pages/calculators/CompoundInterestCard';
import {
  PathToFiCard,
  PATH_TO_FI_BASIS_FIGURES,
  PATH_TO_FI_BASIS_CHARTS,
  PATH_TO_FI_HISTORY_BASIS_CHARTS,
} from '@/pages/calculators/PathToFiCard';
import {
  StressTestCard,
  STRESS_TEST_BASIS_FIGURES,
  STRESS_TEST_BASIS_CHARTS,
} from '@/pages/calculators/StressTestCard';
import {
  EarliestRetirementCard,
  RETIREMENT_AGE_BASIS_FIGURES,
} from '@/pages/calculators/EarliestRetirementCard';
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
function primeScoped(opts: { bobPortfolio?: number; bobContribution?: number } = {}) {
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
      { accountId: 2, snapshotDate: '2026-04-01', totalValue: opts.bobPortfolio ?? 40_000 },
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
      { id: 1, accountId: 2, personId: 2, date: '2026-04-15', amount: opts.bobContribution ?? 1_200, source: ContributionSource.MANUAL },
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

  it('CompoundInterestCard History view: the fan is a PINNED figure in both bases', () => {
    useSettingsStore.setState({
      settings: { defaultInflation: 0.025 } as AppSettings,
      isLoading: false,
      error: null,
    });
    seedDemoScenario();
    seedHistory('compound-interest');
    expectBasisDiscipline(<CompoundInterestCard cardId="compound-interest" />, {
      figures: COMPOUND_BASIS_FIGURES,
      charts: COMPOUND_HISTORY_BASIS_CHARTS,
    });
  });

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

  /* ── B2: the two W1 cards — PINNED today's dollars by construction (the
        stress replay is real, CP-18; the solver's target is today's expenses
        ÷ SWR, CP-31). Byte-identical in both page bases; the copy-law rows
        point at their card-level basis line through markTestId. Scoped
        fixtures, so the exclusions lines render and every registered figure
        is present (the PathToFi sweep's rule). ───────────────────────────── */

  it('StressTestCard (scoped, accepted): replay rows + baseline pinned today via CP-18; year-0 inputs invariant; the replay chart rows never re-inflate', () => {
    primeScoped(); // Bob $40k, $1,200/yr — 1929 · KEEP · 75/25: three down years, never outpaced
    syncCalcScope(2);
    localStorage.clear(); // no last Backtest run → the 75/25 default (CP-7)
    useAcceptancesStore.setState({
      acceptedVersions: { backtest: DISCLOSURES.backtest.version },
      status: 'ready',
      isLoading: false,
      error: null,
    });
    expectBasisDiscipline(
      <MemoryRouter initialEntries={['/calculators?view=p2']}>
        <StressTestCard cardId="stress-test" />
      </MemoryRouter>,
      { figures: STRESS_TEST_BASIS_FIGURES, charts: STRESS_TEST_BASIS_CHARTS },
    );
  });

  /* ── B2 review (MINOR 0): the default sweep renders ONE state. Two landed
        states render a different subset — the single-year 2022 window plots
        one point (below the two-point chart gate) and says CP-14's data-ends
        line; the contributions-outpaced state (CP-15 / DP-15) omits the
        recovery row. Each gets its own completeness scan, with a state guard
        so the fixture cannot drift back to a state the default sweep covers. ── */

  const acceptBacktest = () =>
    useAcceptancesStore.setState({
      acceptedVersions: { backtest: DISCLOSURES.backtest.version },
      status: 'ready',
      isLoading: false,
      error: null,
    });

  it('StressTestCard, single-year 2022 window (CP-14; chartless): every registered figure keeps its class; no unregistered $ renders', () => {
    primeScoped(); // Bob $40k, $1,200/yr — 2022 · KEEP · 75/25: a down year, never outpaced
    syncCalcScope(2);
    localStorage.clear(); // the 75/25 default (CP-7)
    sessionStorage.setItem('calc-window:stress-test', 'inflation-2022');
    acceptBacktest();
    expectBasisDiscipline(
      <MemoryRouter initialEntries={['/calculators?view=p2']}>
        <StressTestCard cardId="stress-test" />
      </MemoryRouter>,
      { figures: STRESS_TEST_BASIS_FIGURES, charts: [] }, // one plotted point — no chart renders
    );
    // state guard: the 2022 window, chartless, saying the CP-14 data-ends line
    expect(screen.getByRole('radio', { name: 'The 2022 inflation shock 2022' })).toBeChecked();
    expect(screen.queryByTestId('stress-test-chart')).not.toBeInTheDocument();
    expect(screen.getByTestId('stress-recovery')).toHaveTextContent(
      'Not back to its starting value by 2022, where the bundled data ends.',
    );
  });

  it('StressTestCard, contributions outpaced (CP-15 / DP-15): the recovery row is omitted, the rest keep their classes; the marker-less replay chart rows never re-inflate', () => {
    primeScoped({ bobContribution: 40_000 }); // $40,000/yr on Bob's $40k outpaces the 1929 window's losses
    syncCalcScope(2);
    localStorage.clear();
    acceptBacktest();
    expectBasisDiscipline(
      <MemoryRouter initialEntries={['/calculators?view=p2']}>
        <StressTestCard cardId="stress-test" />
      </MemoryRouter>,
      {
        figures: STRESS_TEST_BASIS_FIGURES.filter((f) => f.testId !== 'stress-recovery'), // DP-15 omits it
        charts: STRESS_TEST_BASIS_CHARTS,
      },
    );
    // state guard: the outpaced sentence replaces the CP-10 dollars, and the recovery row is gone
    expect(screen.getByTestId('stress-test-trough')).toHaveTextContent(
      "Never below its starting value at a year-end — contributions outpaced this window's losses.",
    );
    expect(screen.queryByTestId('stress-recovery')).not.toBeInTheDocument();
  });

  it('EarliestRetirementCard (scoped, age found): criterion + probe rows pinned today (the criterion states the basis); contributions + exclusions invariant', () => {
    primeScoped({ bobPortfolio: 400_000 }); // Bob's plan HOLDS (t ≈ 43.6 → age 80 ≤ 90) — the full bisection renders
    syncCalcScope(2);
    expectBasisDiscipline(
      <MemoryRouter initialEntries={['/calculators?view=p2']}>
        <EarliestRetirementCard cardId="retirement-age" />
      </MemoryRouter>,
      { figures: RETIREMENT_AGE_BASIS_FIGURES, charts: [] },
    );
  });
});

/* ── v1.7.1 A-5a (4), B1 review MINOR 10: REGISTRY-SHAPE pins. By the frozen
      W2 contract an ABSENT rowsTestId means caption-only, and a figure moved
      from 'pinned' to 'invariant' drops its mark clause — both edits leave
      every sweep above GREEN while it checks less. Each registration is pinned
      whole, beside the sweeps that read it, so any change to what a sweep
      checks is a review-visible diff of this file. ──────────────────────── */

describe('W5 basis registrations — shape pins (A-5a; a sweep cannot be downgraded in silence)', () => {
  it('inventory: the /calculators registrations live in exactly these four card modules', () => {
    const ROOT = path.resolve(__dirname, '..', '..', '..');
    const dir = path.join(ROOT, 'src/pages/calculators');
    const registering = readdirSync(dir)
      .filter((f) => /\.tsx?$/.test(f))
      .filter((f) => /Registered(?:Figure|Chart)\[\]/.test(readFileSync(path.join(dir, f), 'utf8')))
      .sort();
    expect(registering).toEqual([
      'CompoundInterestCard.tsx',
      'EarliestRetirementCard.tsx',
      'PathToFiCard.tsx',
      'StressTestCard.tsx',
    ]);
  });

  it('CompoundInterestCard: figures + the Assumed and History chart registrations, whole', () => {
    expect(COMPOUND_BASIS_FIGURES).toEqual([
      { testId: 'compound-headline', cls: 'convertible' },
      { testId: 'compound-total-contributed', cls: 'convertible' },
      { testId: 'compound-total-interest', cls: 'convertible' },
      { testId: 'compound-final-balance', cls: 'convertible' },
      { testId: 'compound-starting-provenance', cls: 'invariant' },
    ]);
    expect(COMPOUND_BASIS_CHARTS).toEqual([
      { chartTestId: 'compound-chart', captionTestId: 'compound-chart-caption', cls: 'convertible', rowsTestId: 'rc-composed-chart' },
    ]);
    expect(COMPOUND_HISTORY_BASIS_CHARTS).toEqual([
      {
        chartTestId: 'compound-history-chart',
        captionTestId: 'compound-history-chart-caption',
        cls: 'pinned',
        pinnedBasis: 'today',
        rowsTestId: 'rc-composed-chart',
      },
    ]);
  });

  it('PathToFiCard: figures + the Assumed and History chart registrations, whole', () => {
    expect(PATH_TO_FI_BASIS_FIGURES).toEqual([
      { testId: 'ptf-target-fv', cls: 'pinned', pinnedBasis: 'today' },
      { testId: 'ptf-monthly-expenses', cls: 'invariant' },
      { testId: 'ptf-joint-portfolio', cls: 'invariant' },
      { testId: 'ptf-unattributed-contribution', cls: 'invariant' },
      { testId: 'ptf-gap', cls: 'pinned', pinnedBasis: 'today' },
      { testId: 'ptf-gap-value', cls: 'invariant' },
    ]);
    expect(PATH_TO_FI_BASIS_CHARTS).toEqual([
      { chartTestId: 'path-to-fi-chart', captionTestId: 'path-to-fi-chart-caption', cls: 'convertible', rowsTestId: 'rc-composed-chart' },
    ]);
    expect(PATH_TO_FI_HISTORY_BASIS_CHARTS).toEqual([
      {
        chartTestId: 'path-to-fi-history-chart',
        captionTestId: 'path-to-fi-history-chart-caption',
        cls: 'pinned',
        pinnedBasis: 'today',
        rowsTestId: 'rc-composed-chart',
      },
    ]);
  });

  it('StressTestCard: figures (the three CP-18 mark pointers included) + the replay chart registration, whole', () => {
    expect(STRESS_TEST_BASIS_FIGURES).toEqual([
      { testId: 'stress-test-meaning', cls: 'invariant' },
      { testId: 'stress-test-trough', cls: 'pinned', pinnedBasis: 'today', markTestId: 'stress-test-basis-line' },
      { testId: 'stress-test-window-end', cls: 'pinned', pinnedBasis: 'today', markTestId: 'stress-test-basis-line' },
      { testId: 'stress-recovery', cls: 'invariant' },
      { testId: 'stress-test-baseline', cls: 'pinned', pinnedBasis: 'today', markTestId: 'stress-test-basis-line' },
      { testId: 'stress-test-scope-exclusions', cls: 'invariant' },
    ]);
    expect(STRESS_TEST_BASIS_CHARTS).toEqual([
      {
        chartTestId: 'stress-test-chart',
        captionTestId: 'stress-test-chart-caption',
        cls: 'pinned',
        pinnedBasis: 'today',
        rowsTestId: 'rc-composed-chart',
      },
    ]);
  });

  it('EarliestRetirementCard: figures (no chart registration), whole', () => {
    expect(RETIREMENT_AGE_BASIS_FIGURES).toEqual([
      { testId: 'retirement-age-criterion', cls: 'pinned', pinnedBasis: 'today' },
      { testId: 'retirement-age-probes', cls: 'pinned', pinnedBasis: 'today', markTestId: 'retirement-age-criterion' },
      { testId: 'retirement-age-contributions', cls: 'invariant' },
      { testId: 'retirement-age-scope-exclusions', cls: 'invariant' },
    ]);
  });
});
