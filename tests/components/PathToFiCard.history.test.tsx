/**
 * W2 — PathToFiCard History view (Assumed | History return source).
 *
 * Sibling file by design (D-P7): it carries its own recharts mock, so the
 * landed post-W5 PathToFiCard.test.tsx baseline stays byte-identical and its
 * un-mocked assertions keep guarding the Assumed view.
 *
 * Seeding is the landed prologue with three inputs pinned so the copy-contract
 * literals below are byte-exact: portfolio 100,000 · monthly expenses 2,000
 * (⇒ targetFv 600,000 at the 4% SWR) · years-to-retirement 30 (dob 1990-01-01
 * + retirement age 66 at the pinned date 2026-05-14).
 */
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ComposedChart: ({ children, data }: { children?: React.ReactNode; data?: unknown[] }) => (
    <div data-testid="rc-composed-chart" data-rows={JSON.stringify(data ?? [])}>
      {children}
    </div>
  ),
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Legend: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
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
    <div
      data-testid="rc-refdot"
      data-x={String(p.x)}
      data-y={String(p.y)}
      data-shape={p.shape ? 'custom' : ''}
    />
  ),
}));

import { PathToFiCard } from '@/pages/calculators/PathToFiCard';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useAcceptancesStore } from '@/stores/disclosure-acceptances-store';
import { DISCLOSURES } from '@/legal/disclosures';
import { FilingStatus, ContributionSource, SnapshotSource, AccountType } from '@/types/enums';
import { __resetScenarioAssumptionsForTests } from '@/lib/calculators/use-scenario-assumptions';
import { __resetCalcScopeForTests, syncCalcScope } from '@/lib/calculators/calc-view-scope';
import {
  CALCULATORS_PAGE_ID,
  __resetDollarBasisForTests,
  useDollarBasisStore,
  type DollarBasis,
} from '@/lib/calculators/dollar-basis';
import { historyFan } from '@/lib/history-fan';
import { fanCaption, holdsLineKeep } from '@/lib/calculators/history-fan-copy';
import type { Account, Person } from '@/types/schema';

const PINNED_DATE = new Date('2026-05-14T12:00:00Z');

/** The seeded engine inputs the literals below depend on. */
const SEEDED_PORTFOLIO = 100_000;
const SEEDED_TARGET_FV = 600_000;
/** 12 monthly contributions of $2,000 ⇒ the KEEP-mode annual contribution. */
const SEEDED_ANNUAL_CONTRIBUTION = 24_000;

const basePerson = {
  id: 1,
  householdId: 1,
  name: 'Alice',
  dateOfBirth: '1990-01-01',
  // age 36 at the pinned date ⇒ years-to-retirement 30 (the STOP horizon).
  targetRetirementAge: 66,
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

function mkAccount(id: number): Account {
  return {
    id,
    householdId: 1,
    ownerPersonId: null,
    beneficiaryDependentId: null,
    name: `Acct ${id}`,
    institution: null,
    type: AccountType.ACCOUNT_BROKERAGE,
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

function primeStores(opts?: { persons?: Person[] }) {
  useHouseholdStore.setState({
    household: {
      filingStatus: FilingStatus.SINGLE,
      state: 'CA',
      city: null,
      monthlyExpenseBaseline: 2000, // ⇒ annualExpenses 24,000 ⇒ targetFv 600,000
      withdrawalRate: 0.04,
      inflationAssumption: 0.03,
      growthScenarios: [{ label: 'Moderate', rate: 0.06 }],
    },
    isLoading: false,
    error: null,
  });
  usePersonsStore.setState({
    persons: opts?.persons ?? [basePerson as Person],
    isLoading: false,
    error: null,
  });
  useSnapshotsStore.setState({
    snapshots: [
      {
        id: 1,
        accountId: 1,
        snapshotDate: '2026-04-01',
        totalValue: SEEDED_PORTFOLIO,
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

const renderCard = (initialEntries: string[] = ['/calculators']) =>
  render(
    <MemoryRouter initialEntries={initialEntries}>
      <PathToFiCard cardId="path-to-fi" />
    </MemoryRouter>,
  );

const acceptBacktest = () =>
  useAcceptancesStore.setState({
    acceptedVersions: { backtest: DISCLOSURES.backtest.version },
    status: 'ready',
    isLoading: false,
    error: null,
  });

const clickHistory = () => fireEvent.click(screen.getByRole('button', { name: 'History' }));
const toStop = () => fireEvent.click(screen.getByRole('button', { name: 'Stop today' }));
const setYears = (n: number) =>
  fireEvent.change(screen.getByLabelText('Years to retirement'), { target: { value: String(n) } });

beforeEach(() => {
  resetStores();
  sessionStorage.clear();
  useAcceptancesStore.setState({
    acceptedVersions: {},
    status: 'ready',
    isLoading: false,
    error: null,
  });
  __resetScenarioAssumptionsForTests();
  __resetCalcScopeForTests();
  __resetDollarBasisForTests();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(PINNED_DATE);
  primeStores();
});
afterEach(() => vi.useRealTimers());

describe('PathToFiCard — return-source control (D-UB3)', () => {
  it('defaults to Assumed: the assumed chart renders, zero fan Areas', () => {
    renderCard();
    expect(screen.getByTestId('path-to-fi-chart')).toBeInTheDocument();
    expect(screen.queryByTestId('rc-area-fan2575')).toBeNull();
    const group = screen.getByRole('group', { name: 'Return source' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Assumed' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('switching persists per card and never dirties overrides (a view switch is not an edit)', () => {
    acceptBacktest();
    renderCard();
    clickHistory();
    expect(sessionStorage.getItem('calc-chart-source:path-to-fi')).toBe('HISTORY');
    // No card override silo was written, and the scenario tick stays down.
    expect(sessionStorage.getItem('calc-state:path-to-fi')).toBeNull();
    expect(screen.queryByText('Reset to my data')).toBeNull();
    expect(screen.queryByTestId('path-to-fi-scenario-tick')).toBeNull();
    // The other card's key is untouched.
    expect(sessionStorage.getItem('calc-chart-source:compound-interest')).toBeNull();
  });

  it('the Assumed chart returns byte-identically after a round trip through History', () => {
    acceptBacktest();
    renderCard();
    const before = screen.getByTestId('rc-composed-chart').getAttribute('data-rows');
    clickHistory();
    fireEvent.click(screen.getByRole('button', { name: 'Assumed' }));
    expect(screen.getByTestId('path-to-fi-chart')).toBeInTheDocument();
    expect(screen.getByTestId('rc-composed-chart').getAttribute('data-rows')).toBe(before);
  });
});

describe('PathToFiCard — History fan rendering (D-UB8, CH-3, CH-9)', () => {
  beforeEach(() => acceptBacktest());

  it('fan + median + target render; no hero cairn on the median', () => {
    renderCard();
    clickHistory();
    const floor = screen.getByTestId('rc-area-fanFloor');
    const delta = screen.getByTestId('rc-area-fan2575');
    expect(floor.getAttribute('data-stack')).toBe('fan');
    expect(delta.getAttribute('data-stack')).toBe('fan');
    expect(delta.getAttribute('data-fill')).toBe('hsl(var(--chart-band))');
    expect(delta.getAttribute('data-fill-opacity')).toBe('0.28');
    // The fan never surfaces in the tooltip: a stacked delta is not a balance.
    for (const el of [floor, delta]) {
      expect(el.getAttribute('data-tooltip-type')).toBe('none');
      expect(el.getAttribute('data-legend-type')).toBe('none');
    }
    const p50 = screen.getByTestId('rc-line-p50');
    expect(p50.getAttribute('data-stroke')).toBe('hsl(var(--foreground))');
    expect(p50.getAttribute('data-stroke-width')).toBe('2.5');
    expect(screen.getByTestId('rc-line-target')).toBeInTheDocument();
    // No cairn terminal in History view (the median is an order statistic).
    for (const dot of screen.queryAllByTestId('rc-refdot')) {
      expect(dot.getAttribute('data-shape')).not.toBe('custom');
    }
    expect(screen.getByTestId('history-fan-legend')).toHaveTextContent('25th–75th percentile');
    expect(screen.getByTestId('history-fan-legend')).toHaveTextContent('Median (p50)');
  });

  it('the plotted rows ARE the engine census, encoded as the delta stack', () => {
    renderCard();
    toStop();
    clickHistory();
    const rows = JSON.parse(
      screen.getByTestId('rc-composed-chart').getAttribute('data-rows') ?? '[]',
    ) as Array<{ year: number; fanFloor: number; fan2575: number; p50: number; target: number }>;
    const expected = historyFan({
      pv: SEEDED_PORTFOLIO,
      annualContribution: 0,
      horizonYears: 30,
      target: SEEDED_TARGET_FV,
    });
    expect(rows).toHaveLength(31);
    expect(rows[0]).toMatchObject({ year: 0, fanFloor: 100_000, fan2575: 0, p50: 100_000 });
    expect(rows[30].fanFloor).toBe(expected.byYear.p25[30]);
    expect(rows[30].fan2575).toBe(expected.byYear.p75[30] - expected.byYear.p25[30]);
    expect(rows[30].p50).toBe(expected.byYear.p50[30]);
    expect(rows[30].target).toBe(SEEDED_TARGET_FV);
  });

  it('CH-3 caption renders byte-exact for the derived M and H', () => {
    renderCard();
    toStop();
    clickHistory();
    expect(screen.getByTestId('path-to-fi-history-caption')).toHaveTextContent(
      fanCaption({ M: 123, H: 30 }),
    );
    // CH-3 drift-guard: the caption paraphrases DISCLOSURES.backtest — a future
    // body edit bumps the version, trips this pin, and forces a conscious review.
    expect(DISCLOSURES.backtest.version).toBe('1.4');
  });

  it('STOP holds line is byte-exact (CH-2 worked literal)', () => {
    renderCard();
    toStop();
    clickHistory();
    expect(screen.getByTestId('path-to-fi-holds')).toHaveTextContent(
      'Reached the target within 30 years without further contributions in 63 of the 123 full 30-year stretches since 1871 — a count of past stretches, not a probability.',
    );
  });

  it('KEEP holds line uses the CH-1 builder with the KEEP-census values', () => {
    renderCard();
    clickHistory();
    const holdsEl = screen.getByTestId('path-to-fi-holds');
    // KEEP's horizon derives from the landed scenario solve — read it back and
    // recompute the census through the engine rather than pinning a magic H.
    const H = Number(/the \d+ full (\d+)-year/.exec(holdsEl.textContent ?? '')?.[1]);
    expect(Number.isInteger(H)).toBe(true);
    const expected = historyFan({
      pv: SEEDED_PORTFOLIO,
      annualContribution: SEEDED_ANNUAL_CONTRIBUTION,
      horizonYears: H,
      target: SEEDED_TARGET_FV,
    });
    expect(holdsEl).toHaveTextContent(
      holdsLineKeep({ H, J: expected.holds!.count, M: expected.m }),
    );
    // The KEEP line never carries the STOP premise.
    expect(holdsEl.textContent).not.toContain('without further contributions');
  });
});

describe('PathToFiCard — degradation (⚑F5, CH-5/CH-6)', () => {
  beforeEach(() => acceptBacktest());

  it('H=130 (STOP) renders the CH-5 line, no fan, no holds', () => {
    renderCard();
    toStop();
    setYears(130);
    clickHistory();
    expect(screen.getByTestId('path-to-fi-history-degraded')).toHaveTextContent(
      'Only 23 full 130-year stretches exist in the 1871–2022 data — too few to draw a meaningful middle half.',
    );
    expect(screen.queryByTestId('rc-area-fan2575')).toBeNull();
    expect(screen.queryByTestId('path-to-fi-holds')).toBeNull();
    expect(screen.queryByTestId('path-to-fi-history-caption')).toBeNull();
  });

  it('H=160 renders the CH-6 line', () => {
    renderCard();
    toStop();
    setYears(160);
    clickHistory();
    expect(screen.getByTestId('path-to-fi-history-degraded')).toHaveTextContent(
      'No full 160-year stretch exists in the 1871–2022 data.',
    );
    expect(screen.queryByTestId('rc-area-fan2575')).toBeNull();
  });

  it('H=123 still renders the fan (the M_MIN boundary is inclusive)', () => {
    renderCard();
    toStop();
    setYears(123);
    clickHistory();
    expect(screen.getByTestId('rc-area-fan2575')).toBeInTheDocument();
    expect(screen.getByTestId('path-to-fi-history-caption')).toHaveTextContent(
      fanCaption({ M: 30, H: 123 }),
    );
  });
});

describe('PathToFiCard — gate (D-UB10)', () => {
  it('first History click un-accepted opens the modal (diff box shows); cancel stays Assumed', () => {
    renderCard();
    clickHistory();
    expect(screen.getByTestId('disclosure-modal-body')).toBeInTheDocument();
    expect(screen.getByText('What changed since you last accepted:')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByTestId('disclosure-modal-body')).toBeNull();
    expect(screen.getByTestId('path-to-fi-chart')).toBeInTheDocument(); // still Assumed
    expect(sessionStorage.getItem('calc-chart-source:path-to-fi')).not.toBe('HISTORY');
  });

  it('Escape cancels the gate the same way (the modal default)', () => {
    renderCard();
    clickHistory();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('disclosure-modal-body')).toBeNull();
    expect(screen.queryByTestId('rc-area-fan2575')).toBeNull();
  });

  it('a stale acceptance still gates (exact-version compare)', () => {
    useAcceptancesStore.setState({
      acceptedVersions: { backtest: '1.2' },
      status: 'ready',
      isLoading: false,
      error: null,
    });
    renderCard();
    clickHistory();
    expect(screen.getByTestId('disclosure-modal-body')).toBeInTheDocument();
    expect(screen.getByText(`Version ${DISCLOSURES.backtest.version}`)).toBeInTheDocument();
  });

  it('accept switches to History AND records the shared backtest consent', async () => {
    const accept = vi.fn(async (id: string, version: string) => {
      useAcceptancesStore.setState((s) => ({
        acceptedVersions: { ...s.acceptedVersions, [id]: version },
      }));
    });
    useHouseholdStore.setState({ acceptDisclaimer: accept } as never);
    renderCard();
    clickHistory();
    fireEvent.click(
      screen.getByRole('checkbox', { name: DISCLOSURES.backtest.acceptanceCheckboxLabel }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByTestId('rc-area-fan2575')).toBeInTheDocument();
    // One consent, one machinery: the Backtest page + stress cards un-gate too.
    expect(accept).toHaveBeenCalledWith('backtest', DISCLOSURES.backtest.version);
    expect(useAcceptancesStore.getState().acceptedVersions.backtest).toBe(
      DISCLOSURES.backtest.version,
    );
  });

  it('restart-safe: stored HISTORY + un-accepted renders Assumed', () => {
    sessionStorage.setItem('calc-chart-source:path-to-fi', 'HISTORY');
    renderCard();
    expect(screen.getByTestId('path-to-fi-chart')).toBeInTheDocument();
    expect(screen.queryByTestId('rc-area-fan2575')).toBeNull();
    expect(screen.getByRole('button', { name: 'Assumed' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});

describe('PathToFiCard — pinned basis (D-UB13) and scope ⊥ source (m9)', () => {
  beforeEach(() => acceptBacktest());

  const flipBasis = (b: DollarBasis) =>
    act(() => useDollarBasisStore.getState().setBasis(CALCULATORS_PAGE_ID, b));

  it('the fan is byte-identical across page bases; CH-3 identical; neighbours flip', () => {
    renderCard();
    toStop();
    clickHistory();
    const rows = () => screen.getByTestId('rc-composed-chart').getAttribute('data-rows');
    const caption = () => screen.getByTestId('path-to-fi-history-caption').textContent;
    const label = () => screen.getByTestId('path-to-fi-history-chart-caption').textContent;
    const holds = () => screen.getByTestId('path-to-fi-holds').textContent;

    const rowsToday = rows();
    const captionToday = caption();
    const holdsToday = holds();
    expect(label()).toBe("Path to FI — history (today's $)");
    // A convertible neighbour to prove the page basis really moved:
    const monthlyExpensesToday = screen.getByTestId('ptf-monthly-expenses').textContent;
    const teachingToday = screen.getByTestId('ptf-teaching-line').textContent;

    flipBasis('future');
    expect(rows()).toBe(rowsToday); // PINNED: no re-inflation of history
    expect(caption()).toBe(captionToday);
    expect(label()).toBe("Path to FI — history (today's $)");
    expect(holds()).toBe(holdsToday); // the count copy carries no dollars at all
    expect(screen.getByTestId('ptf-monthly-expenses').textContent).toBe(monthlyExpensesToday); // invariant
    expect(screen.getByTestId('ptf-teaching-line').textContent).not.toBe(teachingToday); // bridge clause
    expect(screen.getByTestId('ptf-teaching-bridge')).toBeInTheDocument();

    flipBasis('today');
    expect(rows()).toBe(rowsToday);
  });

  it('the History view renders no unphrased dollar figure of its own', () => {
    renderCard();
    toStop();
    clickHistory();
    // The three History-owned notes are dollar-free by construction; the chart
    // label carries the pinned today mark. (The registry-driven sweep in
    // tests/components/calculators/calculators-basis-sweep.test.tsx is the
    // completeness proof; this is the local restatement.)
    for (const testId of [
      'path-to-fi-history-caption',
      'path-to-fi-holds',
      'history-fan-legend',
    ]) {
      expect(screen.getByTestId(testId).textContent ?? '').not.toMatch(/\$\s?\d/);
    }
    expect(screen.getByTestId('path-to-fi-history-chart-caption').textContent).toContain(
      "(today's $)",
    );
  });

  it('flipping ?view= preserves the History selection and re-derives the scoped census', () => {
    primeStores({
      persons: [
        { ...basePerson, id: 1, name: 'Alice', targetRetirementAge: 66 } as Person,
        { ...basePerson, id: 2, name: 'Bob', targetRetirementAge: 66 } as Person,
      ],
    });
    const household = renderCard();
    toStop();
    clickHistory();
    const householdRows = screen.getByTestId('rc-composed-chart').getAttribute('data-rows');
    expect(screen.getByTestId('path-to-fi-history-chart')).toBeInTheDocument();
    household.unmount();

    // Scope to Bob, who owns none of the accounts — the census re-derives from
    // HIS engine values, and the view selection (scope-blind) survives.
    __resetScenarioAssumptionsForTests();
    act(() => syncCalcScope(2));
    renderCard(['/calculators?view=p2']);
    expect(sessionStorage.getItem('calc-chart-source:path-to-fi')).toBe('HISTORY');
    expect(screen.getByTestId('path-to-fi-history-chart')).toBeInTheDocument(); // no re-gate
    expect(screen.getByTestId('path-to-fi-scope-exclusions')).toBeInTheDocument();
    const scopedRows = screen.getByTestId('rc-composed-chart').getAttribute('data-rows');
    expect(scopedRows).not.toBe(householdRows);
    expect(JSON.parse(scopedRows ?? '[]')[0].fanFloor).toBe(0); // Bob's scoped portfolio
  });
});
