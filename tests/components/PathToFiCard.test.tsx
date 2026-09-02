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
import { PathToFiCard } from '@/pages/calculators/PathToFiCard';
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
