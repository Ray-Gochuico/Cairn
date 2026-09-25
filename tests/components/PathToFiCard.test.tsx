/**
 * Wave 18 B8 — PathToFiCard (Years-to-FI + CoastFI merged).
 *
 * Ports the old FinancialIndependenceCard suite (Keep contributing mode) and
 * the old CoastFiCard suite (Stop today mode). Documented adaptations (plan
 * Task 8 Step 1):
 *   - Both old headline testids collapse to `path-to-fi-headline`.
 *   - The Rate column renders `nominal ≈ real`; the Coast today / % of coast
 *     columns become one signed `Gap to coast` dollar column.
 *   - The duplicated real-basis footnotes are GONE (absence checks); the
 *     teaching block replaces them.
 *   - CoastFI's constant Years column died; the Years column is now the
 *     mode-following years-to-target solve.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { FilingStatus, ContributionSource, SnapshotSource, AccountType } from '@/types/enums';
import { PathToFiCard, PATH_TO_FI_BASIS_FIGURES } from '@/pages/calculators/PathToFiCard';
import { TODAY_SUFFIX } from '@/lib/calculators/basis-view';
import { ScenarioBar } from '@/pages/calculators/ScenarioBar';
import { __resetScenarioAssumptionsForTests } from '@/lib/calculators/use-scenario-assumptions';
import { SCENARIO_STORAGE_KEY } from '@/lib/calculators/scenario-assumptions';
import { syncCalcScope, __resetCalcScopeForTests } from '@/lib/calculators/calc-view-scope';
import {
  CALCULATORS_PAGE_ID,
  __resetDollarBasisForTests,
  useDollarBasisStore,
} from '@/lib/calculators/dollar-basis';
import { cleanup } from '@testing-library/react';
import { NOTHING_INVESTED_LINE } from '@/lib/calculators/nothing-invested';
import type { Account, GrowthScenario, Person } from '@/types/schema';

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

function mkAccount(id: number, type: AccountType = AccountType.ACCOUNT_BROKERAGE, excluded = false): Account {
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
    excludedFromNetWorth: excluded,
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

function primeStores(opts?: {
  scenarios?: GrowthScenario[];
  monthlyExpenseBaseline?: number;
  withdrawalRate?: number;
  persons?: Person[];
  snapshotValues?: Array<{ accountId: number; snapshotDate: string; totalValue: number }>;
  contributionAmounts?: Array<{ amount: number; date: string }>;
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
    persons: opts?.persons ?? [basePerson as Person],
    isLoading: false,
    error: null,
  });

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

  useAccountsStore.setState({
    accounts: [...new Set(defaultSnapshots.map((s) => s.accountId))].map((id) => mkAccount(id)),
    isLoading: false,
    error: null,
  });

  const defaultContribs =
    opts?.contributionAmounts ??
    Array.from({ length: 12 }, (_, i) => {
      const d = new Date(PINNED_DATE);
      d.setMonth(d.getMonth() - i);
      return { amount: 2000, date: d.toISOString().slice(0, 10) };
    });
  useContributionsStore.setState({
    contributions: defaultContribs.map((c, i) => ({
      id: i + 1,
      accountId: 1,
      personId: 1,
      date: c.date,
      amount: c.amount,
      source: ContributionSource.MANUAL,
    })),
    isLoading: false,
    error: null,
  });
}

function renderCard(cardId?: string) {
  return render(
    <MemoryRouter>
      <PathToFiCard cardId={cardId} />
    </MemoryRouter>,
  );
}

async function toStop() {
  fireEvent.click(await screen.findByRole('button', { name: /stop today/i }));
}

describe('PathToFiCard — empty states + shell', () => {
  beforeEach(() => {
    resetStores();
    sessionStorage.clear();
    __resetDollarBasisForTests();
    __resetScenarioAssumptionsForTests();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(PINNED_DATE);
  });
  afterEach(() => vi.useRealTimers());

  it('renders empty state when household is not set — names the cause with a setup link', () => {
    renderCard();
    expect(
      screen.getByRole('link', { name: /set up your household/i }),
    ).toHaveAttribute('href', '/inputs/household');
    expect(screen.getByTestId('path-to-fi-headline')).toHaveTextContent('—');
  });

  it('scenarios-missing empty state names the ingredient and links to Household settings', () => {
    primeStores({ scenarios: [] });
    renderCard();
    expect(screen.getByTestId('path-to-fi-headline')).toHaveTextContent('—');
    expect(
      screen.getByRole('link', { name: /add growth scenarios in household settings/i }),
    ).toHaveAttribute('href', '/inputs/household');
  });

  it('no-persons empty state links to the Persons tab', () => {
    primeStores({ persons: [] });
    renderCard();
    expect(screen.getByTestId('path-to-fi-headline')).toHaveTextContent('—');
    expect(screen.getByRole('link', { name: /add a person/i })).toHaveAttribute(
      'href',
      '/inputs/persons',
    );
  });

  it('zero expenses ⇒ headline "—" + scenario-bar prompt (never "0% of $0")', () => {
    primeStores({ monthlyExpenseBaseline: 0 });
    renderCard();
    expect(screen.getByTestId('path-to-fi-headline')).toHaveTextContent('—');
    expect(
      screen.getByText(/enter monthly expenses and a withdrawal rate/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('W16: the card renders NO shared-assumption inputs (they live in the ScenarioBar)', () => {
    primeStores();
    renderCard();
    expect(screen.queryByLabelText(/current portfolio/i)).toBeNull();
    expect(screen.queryByLabelText(/annual contribution/i)).toBeNull();
    expect(screen.queryByLabelText(/monthly expenses/i)).toBeNull();
    expect(screen.queryByLabelText(/withdrawal rate/i)).toBeNull();
  });

  it('forwards cardId so the card shell mounts with its stable testid (Wave 17)', () => {
    primeStores();
    renderCard('path-to-fi');
    expect(screen.getByTestId('calc-card-path-to-fi')).toBeInTheDocument();
  });

  it('D13: the fresh path-to-fi rail key holds years edits; the retired silos stay unwritten', async () => {
    const user = userEvent.setup();
    primeStores();
    renderCard();
    const input = screen.getByLabelText(/years to retirement/i);
    await user.clear(input);
    await user.type(input, '15');
    expect(
      JSON.parse(sessionStorage.getItem('calc-state:path-to-fi')!).yearsUntilRetirement,
    ).toBe(15);
    expect(sessionStorage.getItem('calc-state:financial-independence')).toBeNull();
    expect(sessionStorage.getItem('calc-state:coast-fi')).toBeNull();
  });

  it('survives live hasData transitions while mounted (Rules of Hooks regression)', () => {
    primeStores({ scenarios: [] });
    renderCard();
    expect(
      screen.getByRole('link', { name: /add growth scenarios in household settings/i }),
    ).toBeInTheDocument();

    act(() => {
      useHouseholdStore.setState((state) => ({
        household: { ...state.household!, growthScenarios: fourScenarios },
      }));
    });
    expect(screen.getByRole('table')).toBeInTheDocument();

    act(() => {
      useHouseholdStore.setState((state) => ({
        household: { ...state.household!, growthScenarios: [] },
      }));
    });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('PathToFiCard — Keep contributing (FI mode)', () => {
  beforeEach(() => {
    resetStores();
    sessionStorage.clear();
    __resetDollarBasisForTests();
    __resetScenarioAssumptionsForTests();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(PINNED_DATE);
  });
  afterEach(() => vi.useRealTimers());

  it('renders headline "X years" with seeded household + snapshots + contributions', () => {
    primeStores();
    renderCard();
    expect(screen.getByTestId('path-to-fi-headline').textContent).toMatch(
      /\d+(\.\d+)?\s*years/i,
    );
  });

  it('headline parses to a finite years value within a sensible range for the seeded fixture', () => {
    primeStores();
    renderCard();
    const value = parseFloat(
      screen.getByTestId('path-to-fi-headline').textContent!.replace(/[^\d.–-]/g, ''),
    );
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThan(5);
    expect(value).toBeLessThan(50);
  });

  it('H1/N1: solves on REAL rates — Moderate 6% headline is ~28.5y (not the ~19.8y nominal solve)', () => {
    primeStores({ scenarios: [{ label: 'Moderate', rate: 0.06 }] });
    renderCard();
    expect(screen.getByTestId('path-to-fi-headline').textContent).toMatch(/28\.5\s*years/);
  });

  it('headline range subtitle spans finite scenario years; single scenario shows no range', () => {
    primeStores({ scenarios: fourScenarios });
    renderCard();
    expect(screen.getByTestId('path-to-fi-headline').textContent).toMatch(
      /\d+(\.\d)?–\d+(\.\d)? years/,
    );
    // Single scenario → no range subtitle.
    resetStores();
    __resetScenarioAssumptionsForTests();
    primeStores({ scenarios: [{ label: 'Moderate', rate: 0.06 }] });
    renderCard();
    expect(screen.queryAllByText(/across scenarios/i)).toHaveLength(0);
  });

  it('renders "—" + the verbatim unreachable note when a scenario never reaches the target in real terms', () => {
    primeStores({
      scenarios: [{ label: 'Moderate', rate: 0 }],
      contributionAmounts: [],
      snapshotValues: [{ accountId: 1, snapshotDate: '2026-04-01', totalValue: 100 }],
    });
    renderCard();
    expect(screen.getByTestId('path-to-fi-headline').textContent).toContain('—');
    expect(
      screen.getByText(
        'Returns at or below inflation — this scenario never reaches the target in real terms.',
      ),
    ).toBeInTheDocument();
  });

  it('renders all scenarios as CalcTable rows with the nominal ≈ real rate column', () => {
    primeStores({ scenarios: fourScenarios });
    renderCard();
    expect(screen.getByText('Conservative')).toBeInTheDocument();
    expect(screen.getByText('Moderate')).toBeInTheDocument();
    expect(screen.getByText('Optimistic')).toBeInTheDocument();
    expect(screen.getByText('Bull')).toBeInTheDocument();
    // 6% nominal at 3% inflation → (1.06/1.03)−1 = 2.9126% → "2.9%".
    expect(screen.getByText(/6% ≈ 2\.9% real/)).toBeInTheDocument();
    expect(screen.getByText(/5% ≈ 1\.9% real/)).toBeInTheDocument();
  });

  it('B3 (CR-B3-1c): a negative real rate renders a TRUE MINUS in the Rate column — 2% at 3% inflation reads "2% ≈ −1% real"', () => {
    // real = 1.02 / 1.03 − 1 = −0.97087…% → "−1%". With $24k/yr against $200k the target is still
    // reachable (t* ≈ 87.0 — the D-R4 parity test's fixture), so the table renders, no lock.
    primeStores({ scenarios: [{ label: 'Moderate', rate: 0.02 }] });
    renderCard();
    const cell = screen.getByText('2% ≈ −1% real');
    expect(cell).toBeInTheDocument();
    expect(cell.textContent).not.toContain('-');
    expect(screen.queryByText(/≈ -1% real/)).toBeNull();
  });

  it('numeric columns are right-aligned (CalcTable); Scenario stays left', () => {
    primeStores();
    renderCard();
    for (const name of [/^rate$/i, /^years$/i, /gap to coast/i]) {
      expect(screen.getByRole('columnheader', { name }).className).toContain('text-right');
    }
    expect(
      screen.getByRole('columnheader', { name: /^scenario$/i }).className,
    ).not.toContain('text-right');
  });

  it('Gap to coast column carries the signed dollar gap (coastNeededToday − portfolio)', () => {
    // Single Moderate 6%, pinned age 36 → 29y horizon. Real rate 2.9126% →
    // coast = 1.5M / 1.0291262^29 = $652,380; gap = 652,380 − 200,000 =
    // $452,380 (H1 discipline: the nominal-solve gap $76,835 must not appear).
    primeStores({ scenarios: [{ label: 'Moderate', rate: 0.06 }] });
    renderCard();
    expect(screen.getByText('$452,380')).toBeInTheDocument();
    expect(screen.queryByText('$76,835')).toBeNull();
  });

  /* W2 review fix (W5 smoke fold): the gap is a today's-dollar figure in BOTH
     page bases and used to render with no basis mark at all under Future $.
     The COLUMN HEADER now carries the mark in W5's short register (imported,
     never retyped), and the header is the node the registry pins: the sweep
     reads a figure node or its PARENT for the mark, and a table cell's parent
     is its own <td> — a per-cell repetition is the only alternative. */
  it('Gap column header declares its basis; the header is the registry’s pinned node', () => {
    primeStores({ scenarios: [{ label: 'Moderate', rate: 0.06 }] });
    renderCard();
    const expected = `Gap to coast ${TODAY_SUFFIX}`;
    expect(expected).toBe("Gap to coast (today's $)");
    expect(screen.getByTestId('ptf-gap').textContent).toBe(expected);
    expect(screen.getByRole('columnheader', { name: expected })).toBeInTheDocument();

    act(() => useDollarBasisStore.getState().setBasis(CALCULATORS_PAGE_ID, 'future'));
    expect(screen.getByTestId('ptf-gap').textContent).toBe(expected); // pinned: never flips
    expect(screen.getByTestId('ptf-gap-value').textContent).toBe('$452,380');

    expect(PATH_TO_FI_BASIS_FIGURES).toContainEqual({
      testId: 'ptf-gap',
      cls: 'pinned',
      pinnedBasis: 'today',
    });
    expect(PATH_TO_FI_BASIS_FIGURES).toContainEqual({ testId: 'ptf-gap-value', cls: 'invariant' });
  });

  it('over-coasted portfolio renders a NEGATIVE gap with the true-minus sign', () => {
    primeStores({
      scenarios: [{ label: 'Moderate', rate: 0.06 }],
      snapshotValues: [{ accountId: 1, snapshotDate: '2026-04-01', totalValue: 10_000_000 }],
    });
    renderCard();
    // formatSignedCurrency renders U+2212 for negatives.
    expect(screen.getByText(/−\$/)).toBeInTheDocument();
  });

  it('teaching block: target formula line + coast milestone sentence', () => {
    primeStores();
    renderCard();
    expect(screen.getByTestId('ptf-teaching-line').textContent).toMatch(
      /Target .+ = 12 × .+\/mo ÷ .+% SWR — in today's dollars\./,
    );
    expect(
      screen.getByText(/at 100% you could stop contributing now and still retire on time/i),
    ).toBeInTheDocument();
  });

  it('the duplicated real-basis footnotes are gone (the teaching block replaced them)', () => {
    primeStores();
    renderCard();
    expect(screen.queryByText(/nominal view grows the target line with inflation/i)).toBeNull();
    expect(screen.queryByText(/inflation-adjusted\) returns/i)).toBeNull();
  });

  it('renders ONE trajectory chart (InlineChart label "Path to FI")', () => {
    primeStores();
    renderCard();
    const chart = screen.getByTestId('path-to-fi-chart');
    expect(chart).toBeInTheDocument();
    expect(chart.textContent).toContain('Path to FI');
  });

  it('W5 ANCHOR PAIR: solve + gap are basis-INVARIANT; caption + bridge flip; the target stays pinned-today (D-T6)', () => {
    primeStores({ scenarios: [{ label: 'Moderate', rate: 0.06 }] });
    renderCard();

    // ── Today's $ (default) ──
    const teaching = screen.getByTestId('ptf-teaching-line');
    expect(teaching.textContent).toContain('Target $1,500,000');
    expect(teaching.textContent).toContain("in today's dollars.");
    expect(screen.queryByTestId('ptf-teaching-bridge')).toBeNull();
    expect(screen.getByTestId('path-to-fi-chart-caption').textContent).toBe(
      "Path to FI (today's $)",
    );
    expect(screen.getByText('$452,380')).toBeInTheDocument(); // gap: real-rate discipline (H1)
    expect(screen.queryByText('$76,835')).toBeNull(); // nominal-solve anti-pin
    expect(screen.getByTestId('path-to-fi-headline').textContent).toMatch(/28\.5\s*years/);

    // ── Future $ ──
    act(() => useDollarBasisStore.getState().setBasis(CALCULATORS_PAGE_ID, 'future'));

    // Pinned figure (F10 ruling): keeps its TRUE today statement + gains the bridge.
    expect(teaching.textContent).toContain("in today's dollars.");
    expect(screen.getByTestId('ptf-teaching-bridge').textContent).toContain(
      'The target line on the chart grows with inflation so it buys the same retirement in future dollars.',
    );
    expect(screen.getByTestId('path-to-fi-chart-caption').textContent).toBe('Path to FI (future $)');
    // Invariance IS an anchor: gap + years untouched by the display basis (goalpost law).
    expect(screen.getByText('$452,380')).toBeInTheDocument();
    expect(screen.queryByText('$76,835')).toBeNull();
    expect(screen.getByTestId('path-to-fi-headline').textContent).toMatch(/28\.5\s*years/);
  });

  it('W5: no per-card toggle remains on this card (D-T9)', () => {
    primeStores({ scenarios: [{ label: 'Moderate', rate: 0.06 }] });
    renderCard();
    expect(screen.queryByRole('button', { name: /^real$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^nominal$/i })).toBeNull();
    // The mode segment (Keep contributing / Stop today) is NOT a basis control and stays:
    expect(screen.getByRole('button', { name: /keep contributing/i })).toBeInTheDocument();
  });

  it('W16: recomputes when the bar Portfolio is edited, and bar Reset restores it', async () => {
    const user = userEvent.setup();
    primeStores();
    render(
      <MemoryRouter>
        <ScenarioBar />
        <PathToFiCard />
      </MemoryRouter>,
    );
    const before = screen.getByTestId('path-to-fi-headline').textContent;
    const pv = screen.getByLabelText('Portfolio') as HTMLInputElement;
    await user.clear(pv);
    await user.type(pv, '5000000');
    await waitFor(() =>
      expect(screen.getByTestId('path-to-fi-headline').textContent).not.toBe(before),
    );
    await user.click(await screen.findByRole('button', { name: /^reset to my data$/i }));
    await waitFor(() =>
      expect(screen.getByTestId('path-to-fi-headline').textContent).toBe(before),
    );
  });

  it('W16 D3: a custom bar Return collapses the scenario table to a single Custom row', async () => {
    const user = userEvent.setup();
    primeStores();
    render(
      <MemoryRouter>
        <ScenarioBar />
        <PathToFiCard />
      </MemoryRouter>,
    );
    expect(screen.getByText('Conservative')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Return'));
    await user.type(screen.getByLabelText('Return'), '9');
    await waitFor(() => expect(screen.getByText('Custom')).toBeInTheDocument());
    expect(screen.queryByText('Conservative')).toBeNull();
  });

  it('W16: persists a bar edit under calc-scenario:shared (the per-card silos stay retired)', async () => {
    const user = userEvent.setup();
    primeStores();
    render(
      <MemoryRouter>
        <ScenarioBar />
        <PathToFiCard />
      </MemoryRouter>,
    );
    await user.clear(screen.getByLabelText('Annual contribution'));
    await user.type(screen.getByLabelText('Annual contribution'), '60000');
    await waitFor(() =>
      expect(JSON.parse(sessionStorage.getItem(SCENARIO_STORAGE_KEY)!)).toMatchObject({
        annualContribution: 60000,
      }),
    );
    expect(sessionStorage.getItem('calc-state:financial-independence')).toBeNull();
  });
});

describe('PathToFiCard — Stop today (Coast mode)', () => {
  beforeEach(() => {
    resetStores();
    sessionStorage.clear();
    __resetDollarBasisForTests();
    __resetScenarioAssumptionsForTests();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(PINNED_DATE);
  });
  afterEach(() => vi.useRealTimers());

  it('renders headline "X% of CoastFI" when seeded', async () => {
    primeStores();
    renderCard();
    await toStop();
    expect(screen.getByTestId('path-to-fi-headline').textContent).toMatch(
      /\d+(\.\d+)?%\s*of\s*CoastFI/i,
    );
  });

  it('review fix 4: STOP mode Years is the ZERO-contribution solve (kills a KEEP-solve swap)', async () => {
    // Same single-Moderate fixture as the KEEP 28.5y pin: pv $200k, target
    // $1.5M, 6% nominal at 3% inflation → real 2.9126%. Zero-contribution
    // solve: ln(1,500,000/200,000)/ln(1.0291262) = 70.2y — the with-
    // contribution solve (28.5y) must NOT drive the STOP table.
    primeStores({ scenarios: [{ label: 'Moderate', rate: 0.06 }] });
    renderCard();
    await toStop();
    const table = screen.getByTestId('path-to-fi-table');
    const { within } = await import('@testing-library/react');
    expect(within(table).getByText('70.2')).toBeInTheDocument();
    expect(within(table).queryByText('28.5')).toBeNull();
  });

  it('the mode segment persists under calc-mode:path-to-fi', async () => {
    primeStores();
    renderCard();
    await toStop();
    expect(sessionStorage.getItem('calc-mode:path-to-fi')).toBe('STOP');
    expect(screen.getByRole('button', { name: /stop today/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // B2 review: the group's accessible name (SegmentedControl's `label`) is pinned here, on the consumer.
    expect(screen.getByRole('group', { name: 'Path mode' })).toContainElement(
      screen.getByRole('button', { name: /stop today/i }),
    );
  });

  it('caps headline at 100%+ when the portfolio already exceeds the coast amount', async () => {
    primeStores({
      snapshotValues: [{ accountId: 1, snapshotDate: '2026-04-01', totalValue: 10_000_000 }],
    });
    renderCard();
    await toStop();
    const value = parseFloat(
      screen.getByTestId('path-to-fi-headline').textContent!.replace(/[^\d.]/g, ''),
    );
    expect(value).toBeGreaterThanOrEqual(100);
  });

  it('H1/N1: the gap discounts by the REAL rate — $452,380 for the Moderate fixture', async () => {
    primeStores({ scenarios: [{ label: 'Moderate', rate: 0.06 }] });
    renderCard();
    await toStop();
    expect(screen.getByText('$452,380')).toBeInTheDocument();
    expect(screen.queryByText('$76,835')).toBeNull();
  });

  it('floored-rate note renders verbatim when a scenario return is at or below inflation', async () => {
    primeStores({ scenarios: [{ label: 'Moderate', rate: 0.02 }] });
    renderCard();
    await toStop();
    expect(
      screen.getByText(
        /A scenario's return is at or below inflation — its real rate is floored at 0, so its coast target equals the full FI number\./,
      ),
    ).toBeInTheDocument();
    // …and the FIGURES beside the note must SAY what the note says: the coast
    // target IS the full $1,500,000 FI number, so the gap is $1,300,000 and
    // the headline is 13% of CoastFI. An unfloored coast solve would render
    // $1,790,517 / "10% of CoastFI" next to a sentence contradicting it.
    expect(screen.getByTestId('ptf-gap-value').textContent).toBe('$1,300,000');
    expect(screen.getByTestId('path-to-fi-headline').textContent).toBe('13% of CoastFI');
    expect(screen.queryByText('$1,790,517')).toBeNull();
  });

  it('at/past retirement: headline "—" + the verbatim guard sentence', async () => {
    const user = userEvent.setup();
    primeStores();
    renderCard();
    await toStop();
    const input = screen.getByLabelText(/years to retirement/i);
    await user.clear(input);
    await user.type(input, '0');
    expect(screen.getByTestId('path-to-fi-headline').textContent).toBe('—');
    expect(
      screen.getByText(/already at\/after your target retirement age/i),
    ).toBeInTheDocument();
  });

  it('uses the shorter-horizon person for two-person households (years prefill)', () => {
    const personA = { ...basePerson, id: 1, dateOfBirth: '1990-01-01', targetRetirementAge: 65 };
    const personB = {
      ...basePerson,
      id: 2,
      name: 'Bob',
      dateOfBirth: '1975-01-01',
      targetRetirementAge: 65,
    };
    primeStores({ persons: [personA, personB] as Person[] });
    renderCard();
    expect(
      (screen.getByLabelText(/years to retirement/i) as HTMLInputElement).value,
    ).toBe('14');
  });

  it('"Years to retirement" prefills targetRetirementAge − age; Reset restores it', async () => {
    const user = userEvent.setup();
    const editablePerson = {
      ...basePerson,
      dateOfBirth: '1986-01-01',
      targetRetirementAge: 60,
    };
    primeStores({ persons: [editablePerson as Person] });
    renderCard();
    const input = screen.getByLabelText(/years to retirement/i) as HTMLInputElement;
    expect(input.value).toBe('20');
    await user.clear(input);
    await user.type(input, '10');
    expect(input.value).toBe('10');
    await user.click(screen.getByRole('button', { name: /reset to my data/i }));
    expect(
      (screen.getByLabelText(/years to retirement/i) as HTMLInputElement).value,
    ).toBe('20');
    expect(screen.queryByRole('button', { name: /reset to my data/i })).toBeNull();
  });
});

describe('PathToFiCard waymark meaning + dirty (Wave 17)', () => {
  beforeEach(() => {
    resetStores();
    sessionStorage.clear();
    __resetDollarBasisForTests();
    __resetScenarioAssumptionsForTests();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(PINNED_DATE);
  });
  afterEach(() => vi.useRealTimers());

  it('KEEP meaning carries the coast reading — "% of the way to coasting" (dual-reading waymark)', () => {
    primeStores();
    renderCard('path-to-fi');
    expect(screen.getByTestId('path-to-fi-meaning')).toHaveTextContent(
      /\d+% of the way to coasting/,
    );
  });

  it('STOP meaning carries the FI reading — years if you keep contributing', async () => {
    primeStores();
    renderCard('path-to-fi');
    await toStop();
    expect(screen.getByTestId('path-to-fi-meaning')).toHaveTextContent(
      /of the coast amount · Moderate \d+(\.\d)? yrs if you keep contributing/,
    );
  });

  it('non-finite headline scenario REPLACES the meaning with the warning sentence', () => {
    primeStores({
      scenarios: [{ label: 'Moderate', rate: 0 }],
      contributionAmounts: [],
      snapshotValues: [{ accountId: 1, snapshotDate: '2026-04-01', totalValue: 100 }],
    });
    renderCard('path-to-fi');
    const meaning = screen.getByTestId('path-to-fi-meaning');
    expect(meaning).toHaveTextContent(/returns at or below inflation/i);
    expect(meaning).not.toHaveTextContent(/way to coasting/i);
  });

  it('editing the years rail field raises the scenario tick + prefix', async () => {
    const user = userEvent.setup();
    primeStores();
    renderCard('path-to-fi');
    await user.clear(screen.getByLabelText(/years to retirement/i));
    await user.type(screen.getByLabelText(/years to retirement/i), '12');
    expect(screen.getByTestId('path-to-fi-scenario-tick')).toBeInTheDocument();
    expect(screen.getByText(/^Scenario:/)).toBeInTheDocument();
  });
});

describe('PathToFiCard — person scope (Wave B)', () => {
  // Alice retires in 10y (target 46 at age 36), Bob in 30y (target 66) —
  // household default 10, Bob scope 30. Bob owns account 2 ($40k); account 3
  // is joint ($8k); Alice owns account 1 ($100k). Contributions: $1,200 Bob,
  // $600 unattributed, $500 Alice.
  function primeScoped() {
    primeStores({
      persons: [
        { ...basePerson, id: 1, name: 'Alice', targetRetirementAge: 46 } as Person,
        { ...basePerson, id: 2, name: 'Bob', targetRetirementAge: 66 } as Person,
      ],
      snapshotValues: [
        { accountId: 1, snapshotDate: '2026-04-01', totalValue: 100_000 },
        { accountId: 2, snapshotDate: '2026-04-01', totalValue: 40_000 },
        { accountId: 3, snapshotDate: '2026-04-01', totalValue: 8_000 },
      ],
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

  const renderScoped = () =>
    render(
      <MemoryRouter initialEntries={['/calculators?view=p2']}>
        <PathToFiCard cardId="path-to-fi" />
      </MemoryRouter>,
    );

  beforeEach(() => {
    resetStores();
    sessionStorage.clear();
    __resetDollarBasisForTests();
    __resetScenarioAssumptionsForTests();
    __resetCalcScopeForTests();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(PINNED_DATE);
    primeScoped();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('Wave B CB15: the scoped meaning names the person in both modes', () => {
    syncCalcScope(2);
    renderScoped();
    expect(screen.getByTestId('path-to-fi-meaning')).toHaveTextContent(/to Bob's FI target/);
  });

  it('Wave B CB16: the exclusions caption declares joint + unattributed amounts, and the even-split clause drops once expenses are edited', () => {
    syncCalcScope(2);
    renderScoped(); // open card
    const caption = screen.getByTestId('path-to-fi-scope-exclusions');
    expect(caption).toHaveTextContent(
      "Bob's solve counts only Bob's accounts and contributions — joint accounts ($8,000) and unattributed contributions ($600/yr) aren't counted. Expenses default to half the household baseline.",
    );
    // B3 (item 5) byte-identity receipt, captured BEFORE the migration onto
    // ScopeExclusionsLine: exact textContent, leading space of the clause included.
    expect(caption.textContent).toBe(
      "Bob's solve counts only Bob's accounts and contributions — joint accounts ($8,000) and unattributed contributions ($600/yr) aren't counted. Expenses default to half the household baseline.",
    );
    expect(screen.getByTestId('ptf-joint-portfolio').textContent).toBe('$8,000');
    expect(screen.getByTestId('ptf-unattributed-contribution').textContent).toBe('$600');
    expect(caption.className).toBe('text-xs text-muted-foreground');
    // Edit the expenses field in the P2 silo before a fresh render — the
    // even-split clause must drop (the default no longer applies):
    cleanup();
    sessionStorage.setItem('calc-scenario:p2', JSON.stringify({ monthlyExpenses: 2500 }));
    __resetScenarioAssumptionsForTests();
    renderScoped();
    expect(screen.getByTestId('path-to-fi-scope-exclusions')).not.toHaveTextContent('Expenses default');
  });

  it("0051: the CB16 even-split clause drops when Bob's durable baseline is used (unedited)", () => {
    usePersonsStore.setState({
      persons: [
        { ...basePerson, id: 1, name: 'Alice', targetRetirementAge: 46 } as Person,
        { ...basePerson, id: 2, name: 'Bob', targetRetirementAge: 66, monthlyExpenseBaseline: 2600 } as Person,
      ],
      isLoading: false,
      error: null,
    });
    syncCalcScope(2);
    renderScoped();
    const caption = screen.getByTestId('path-to-fi-scope-exclusions');
    // The exclusions declaration itself stays…
    expect(caption).toHaveTextContent(/joint accounts \(\$8,000\)/);
    // …but the even-split sentence is gone: expenses now come from Bob's Inputs.
    expect(caption).not.toHaveTextContent('Expenses default');
    expect(caption.textContent).toBe(
      "Bob's solve counts only Bob's accounts and contributions — joint accounts ($8,000) and unattributed contributions ($600/yr) aren't counted.",
    );
  });

  it('Wave B: the years-to-retirement rail default follows the SCOPED person, not the household min', () => {
    syncCalcScope(2);
    renderScoped();
    expect(screen.getByLabelText('Years to retirement')).toHaveValue(30);
  });

  it('Wave B: household scope keeps the shortest-horizon default and the unscoped meaning', () => {
    renderCard('path-to-fi');
    expect(screen.getByLabelText('Years to retirement')).toHaveValue(10);
    expect(screen.getByTestId('path-to-fi-meaning')).toHaveTextContent(/to your FI target/);
    expect(screen.queryByTestId('path-to-fi-scope-exclusions')).not.toBeInTheDocument();
  });
});

describe('PathToFiCard — the nothing-invested register (B3, v1.7.0; CR-B3-2, D-B3-3)', () => {
  beforeEach(() => {
    resetStores();
    sessionStorage.clear();
    __resetDollarBasisForTests();
    __resetScenarioAssumptionsForTests();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(PINNED_DATE);
  });
  afterEach(() => vi.useRealTimers());

  const primeNothing = () =>
    primeStores({
      scenarios: [{ label: 'Moderate', rate: 0.06 }],
      snapshotValues: [{ accountId: 1, snapshotDate: '2026-04-01', totalValue: 0 }],
      contributionAmounts: [],
    });

  it('KEEP: $0 portfolio and $0/yr at a POSITIVE real rate → the register replaces the rate lock; the per-scenario lock note is suppressed', () => {
    primeNothing();
    renderCard();
    expect(screen.getByTestId('path-to-fi-headline')).toHaveTextContent('—');
    const line = screen.getByTestId('path-to-fi-nothing-invested');
    expect(line.textContent).toBe(
      'Nothing invested — the portfolio and contributions in the scenario bar above are both zero, so the target is never reached.',
    );
    expect(line.textContent).toBe(NOTHING_INVESTED_LINE);
    expect(line.className).not.toContain('text-warning-foreground');
    expect(
      screen.queryByText('Returns at or below inflation — the target is never reached in real terms.'),
    ).toBeNull();
    expect(
      screen.queryByText('Returns at or below inflation — this scenario never reaches the target in real terms.'),
    ).toBeNull();
    // The table still renders (the coast gap is a real number even at $0).
    expect(screen.getByTestId('path-to-fi-table')).toBeInTheDocument();
  });

  it('STOP (D-B3-3 — KEEP only): nothing invested answers "0% of CoastFI" with NO register; the rate-lock note stays suppressed', async () => {
    // STOP's headline is honest at $0 (0% of the coast amount), so the register is not
    // shown there. The per-scenario note is still suppressed: its "returns at or below
    // inflation" reason is as false in STOP as in KEEP when nothing is invested.
    primeNothing();
    renderCard();
    await toStop();
    expect(screen.getByTestId('path-to-fi-headline')).toHaveTextContent('0% of CoastFI');
    expect(screen.queryByTestId('path-to-fi-nothing-invested')).toBeNull();
    expect(screen.queryByText(NOTHING_INVESTED_LINE)).toBeNull();
    expect(
      screen.queryByText('Returns at or below inflation — this scenario never reaches the target in real terms.'),
    ).toBeNull();
  });

  it('STOP (B3 review): a $0 portfolio WITH contributions at a POSITIVE real rate — the stop-today solve has nothing to grow, so the rate-lock note is suppressed; KEEP on the same bar solves', async () => {
    // 6% at 3% (real +2.9%), pv $0, $24,000/yr. STOP solves with annualContribution 0, so every
    // STOP row is unreachable for the same non-rate reason as the $0/$0 case — the note's
    // "returns at or below inflation" would be false. The suppression follows the MODE's
    // contribution (0 in STOP), not the bar's.
    primeStores({
      scenarios: [{ label: 'Moderate', rate: 0.06 }],
      snapshotValues: [{ accountId: 1, snapshotDate: '2026-04-01', totalValue: 0 }],
    });
    renderCard();
    expect(screen.getByTestId('path-to-fi-headline').textContent).toMatch(/36\.\d years/); // KEEP: t* = 36.12 (Appendix D.5)
    expect(screen.queryByText(/Returns at or below inflation/)).toBeNull();
    await toStop();
    expect(screen.getByTestId('path-to-fi-headline')).toHaveTextContent('0% of CoastFI');
    expect(screen.queryByTestId('path-to-fi-nothing-invested')).toBeNull(); // the register stays KEEP-only (D-B3-3)
    expect(
      screen.queryByText('Returns at or below inflation — this scenario never reaches the target in real terms.'),
    ).toBeNull();
  });

  it('STOP (B3 review): a positive portfolio at a rate at or below inflation keeps the per-scenario note (the rate IS the reason)', async () => {
    primeStores({
      scenarios: [{ label: 'Moderate', rate: 0.02 }],
      snapshotValues: [{ accountId: 1, snapshotDate: '2026-04-01', totalValue: 200_000 }],
      contributionAmounts: [],
    });
    renderCard();
    await toStop();
    expect(
      screen.getByText('Returns at or below inflation — this scenario never reaches the target in real terms.'),
    ).toBeInTheDocument();
  });

  it('$0 portfolio WITH contributions is a normal solve — no register, no lock', () => {
    primeStores({
      scenarios: [{ label: 'Moderate', rate: 0.06 }],
      snapshotValues: [{ accountId: 1, snapshotDate: '2026-04-01', totalValue: 0 }],
    });
    renderCard();
    expect(screen.queryByTestId('path-to-fi-nothing-invested')).toBeNull();
    expect(screen.queryByText(/Returns at or below inflation/)).toBeNull();
    expect(screen.getByTestId('path-to-fi-headline').textContent).toMatch(/36\.\d years/); // t* = 36.12 (Appendix D.5)
  });

  it('a positive portfolio with no contributions at a rate at or below inflation keeps the Wave-17 lock (the rate IS the reason)', () => {
    primeStores({
      scenarios: [{ label: 'Moderate', rate: 0.02 }],
      snapshotValues: [{ accountId: 1, snapshotDate: '2026-04-01', totalValue: 200_000 }],
      contributionAmounts: [],
    });
    renderCard();
    expect(screen.queryByTestId('path-to-fi-nothing-invested')).toBeNull();
    expect(
      screen.getByText('Returns at or below inflation — the target is never reached in real terms.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Returns at or below inflation — this scenario never reaches the target in real terms.'),
    ).toBeInTheDocument();
  });

  /** 12 monthly contributions of `amount` inside the trailing year (the
   *  primeStores default shape at a different amount). */
  const monthly = (amount: number) =>
    Array.from({ length: 12 }, (_, i) => {
      const d = new Date(PINNED_DATE);
      d.setMonth(d.getMonth() - i);
      return { amount, date: d.toISOString().slice(0, 10) };
    });

  it('A-12 (v1.7.1, CR-C3-B): STOP with pv 0 / pmt 0 — the KEEP reading states the cause (nothing invested), never "Moderate — yrs"; the register stays KEEP-only (D-B3-3)', async () => {
    primeNothing();
    renderCard('path-to-fi');
    await toStop();
    // The headline is NOT read here: with a cardId, CalculatorCard stamps
    // `path-to-fi-headline` on its status container AND PathToFiCard stamps the
    // same testid on the inner span (P18) — getByTestId throws on the pair. The
    // `0% of CoastFI` headline under this fixture is already pinned by the
    // D-B3-3 STOP test above (renderCard() without a cardId).
    // State guard (P18): no rail override and no bar edit → no "Scenario: "
    // prefix inside the meaning node, so the exact textContent pin is valid.
    expect(screen.queryByText('Scenario:')).toBeNull();
    expect(screen.getByTestId('path-to-fi-meaning').textContent).toBe(
      'of the coast amount · never reached with nothing invested',
    );
    expect(screen.getByTestId('path-to-fi-meaning').textContent).not.toMatch(/— yrs/);
    expect(screen.queryByTestId('path-to-fi-nothing-invested')).toBeNull();
    expect(screen.queryByText(NOTHING_INVESTED_LINE)).toBeNull();
  });

  it('A-12 (CR-C3-A control): STOP with pv 0 / pmt $24,000 at 6%/3% — the KEEP solve is FINITE (36.1 yrs), so the landed reading is byte-exact', async () => {
    primeStores({
      scenarios: [{ label: 'Moderate', rate: 0.06 }],
      snapshotValues: [{ accountId: 1, snapshotDate: '2026-04-01', totalValue: 0 }],
    });
    renderCard('path-to-fi');
    await toStop();
    expect(screen.queryByText('Scenario:')).toBeNull(); // P18 state guard
    expect(screen.getByTestId('path-to-fi-meaning').textContent).toBe(
      'of the coast amount · Moderate 36.1 yrs if you keep contributing', // t* = 36.12 (B3 Appendix D.5)
    );
  });

  it('A-12 (CR-C3-C): STOP with pv $200,000 / pmt 0 at 2%/3% — the KEEP solve is locked by the rate; the reading names the lock, not "nothing invested"; the per-scenario note keeps rendering (the rate IS the reason)', async () => {
    primeStores({
      scenarios: [{ label: 'Moderate', rate: 0.02 }],
      snapshotValues: [{ accountId: 1, snapshotDate: '2026-04-01', totalValue: 200_000 }],
      contributionAmounts: [],
    });
    renderCard('path-to-fi');
    await toStop();
    expect(screen.queryByText('Scenario:')).toBeNull(); // P18 state guard
    expect(screen.getByTestId('path-to-fi-meaning').textContent).toBe(
      'of the coast amount · Moderate: never reached if you keep contributing — returns at or below inflation',
    );
    expect(screen.getByTestId('path-to-fi-meaning').textContent).not.toContain('nothing invested');
    expect(
      screen.getByText('Returns at or below inflation — this scenario never reaches the target in real terms.'),
    ).toBeInTheDocument();
  });

  it('A-12 (CR-C3-C discriminator): STOP with pv 0 / pmt $12,000 at 2%/3% — an infinite KEEP solve WITH contributions on the bar is the rate lock (asymptote $1,236,000 < the $1,500,000 target), never "nothing invested" — the cause keys on the BAR\'s contribution, not STOP\'s zero', async () => {
    primeStores({
      scenarios: [{ label: 'Moderate', rate: 0.02 }],
      snapshotValues: [{ accountId: 1, snapshotDate: '2026-04-01', totalValue: 0 }],
      contributionAmounts: monthly(1_000),
    });
    renderCard('path-to-fi');
    await toStop();
    expect(screen.queryByText('Scenario:')).toBeNull(); // P18 state guard
    expect(screen.getByTestId('path-to-fi-meaning').textContent).toBe(
      'of the coast amount · Moderate: never reached if you keep contributing — returns at or below inflation',
    );
    expect(screen.getByTestId('path-to-fi-meaning').textContent).not.toContain('nothing invested');
  });
});

/* B3 (R4 ruling 7): the rail's years-to-retirement default follows the LOCAL
   calendar-day age. basePerson retires at 65 and is born 1990-01-01. */
describe('PathToFiCard — the years-to-retirement default reads the LOCAL calendar day (B3)', () => {
  const ORIGINAL_TZ = process.env.TZ;
  beforeEach(() => {
    resetStores();
    sessionStorage.clear();
    __resetDollarBasisForTests();
    __resetScenarioAssumptionsForTests();
    __resetCalcScopeForTests();
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  it('Los Angeles at 03:00Z on Jan 1: age 35 → 30 years to retirement (the UTC-day shape: 29)', () => {
    process.env.TZ = 'America/Los_Angeles';
    vi.setSystemTime(new Date('2026-01-01T03:00:00Z'));
    primeStores({
      snapshotValues: [{ accountId: 1, snapshotDate: '2025-12-01', totalValue: 200_000 }],
      contributionAmounts: [],
    });
    renderCard();
    expect(screen.getByLabelText('Years to retirement')).toHaveValue(30);
  });

  it('Auckland at the same instant: age 36 → 29', () => {
    process.env.TZ = 'Pacific/Auckland';
    vi.setSystemTime(new Date('2026-01-01T03:00:00Z'));
    primeStores({
      snapshotValues: [{ accountId: 1, snapshotDate: '2025-12-01', totalValue: 200_000 }],
      contributionAmounts: [],
    });
    renderCard();
    expect(screen.getByLabelText('Years to retirement')).toHaveValue(29);
  });
});
