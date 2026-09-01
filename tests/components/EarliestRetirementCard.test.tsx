/**
 * W1 Task 5 — EarliestRetirementCard: the visible bisection, the criterion
 * sentence, five edge verdicts, two-person years framing, cross-card parity.
 *
 * Priming block copied from PathToFiCard.test.tsx (the house fixture):
 * pinned date 2026-05-14, Alice dob 1990-01-01 → age 36. Default bar:
 * portfolio $200k (snapshot), $24k/yr contributions (12 × $2,000/mo),
 * monthly expenses $5,000, SWR 4%, inflation 3% → target $1,500,000; a
 * single Moderate 6% scenario unless a test primes three.
 *
 * Hand-derived (planning + re-derived here): t* ≈ 28.5465 ⇒ answerT 29 ⇒
 * Age 65; tMax 54 trace 54✓ · 27✕ · 40✓ · 33✓ · 30✓ · 28✕ · 29✓ (7 probes);
 * three-scenario range 61–70.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { FilingStatus, ContributionSource, SnapshotSource, AccountType } from '@/types/enums';
import { EarliestRetirementCard } from '@/pages/calculators/EarliestRetirementCard';
import { __resetScenarioAssumptionsForTests } from '@/lib/calculators/use-scenario-assumptions';
import { syncCalcScope, __resetCalcScopeForTests } from '@/lib/calculators/calc-view-scope';
import { projectedFv } from '@/lib/calculators/retirement-age-solver';
import { yearsToFi } from '@/lib/financial-independence';
import { realRateOfUnfloored } from '@/lib/calculators/real-rate';
import { formatCurrency } from '@/lib/format';
import type { Account, GrowthScenario, Person } from '@/types/schema';

const PINNED_DATE = new Date('2026-05-14T12:00:00Z');

const moderateOnly: GrowthScenario[] = [{ label: 'Moderate', rate: 0.06 }];

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
  /** Extension over the PathToFi block: the solver edges need a non-default inflation. */
  inflationAssumption?: number;
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
      inflationAssumption: opts?.inflationAssumption ?? 0.03,
      growthScenarios: opts?.scenarios ?? moderateOnly,
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

/** Re-prime the bar's STORE-derived defaults (no overrides ⇒ no dirty tick). */
function primeBar(over: {
  portfolio?: number;
  annualContribution?: number;
  monthlyExpenses?: number;
  returnPct?: number;
  inflationPct?: number;
}) {
  primeStores({
    scenarios: [{ label: 'Moderate', rate: (over.returnPct ?? 6) / 100 }],
    monthlyExpenseBaseline: over.monthlyExpenses ?? 5000,
    inflationAssumption: (over.inflationPct ?? 3) / 100,
    snapshotValues: [{ accountId: 1, snapshotDate: '2026-04-01', totalValue: over.portfolio ?? 200_000 }],
    contributionAmounts: Array.from({ length: 12 }, (_, i) => {
      const d = new Date(PINNED_DATE);
      d.setMonth(d.getMonth() - i);
      return { amount: (over.annualContribution ?? 24_000) / 12, date: d.toISOString().slice(0, 10) };
    }),
  });
}

function primeScenarios(list: Array<{ label: string; ratePct: number }>) {
  primeStores({ scenarios: list.map((s) => ({ label: s.label, rate: s.ratePct / 100 })) });
}

function primePersons(list: Array<{ name: string; dateOfBirth: string }>) {
  usePersonsStore.setState({
    persons: list.map((p, i) => ({ ...basePerson, id: i + 1, name: p.name, dateOfBirth: p.dateOfBirth }) as Person),
    isLoading: false,
    error: null,
  });
}

function renderCard() {
  return render(
    <MemoryRouter>
      <EarliestRetirementCard cardId="retirement-age" />
    </MemoryRouter>,
  );
}

/** Wave-B scoped fixture shape (PathToFiCard.test.tsx primeScoped): joint $8k,
 *  $600/yr unattributed. Bob's own account is sized so his plan HOLDS by 90
 *  (the PathToFi $40k fixture would read not-by-90 — the age-framed headline
 *  assertion needs a found age). */
function renderScopedCard() {
  primeStores({
    persons: [
      { ...basePerson, id: 1, name: 'Alice', targetRetirementAge: 46 } as Person,
      { ...basePerson, id: 2, name: 'Bob', targetRetirementAge: 66 } as Person,
    ],
    snapshotValues: [
      { accountId: 1, snapshotDate: '2026-04-01', totalValue: 100_000 },
      { accountId: 2, snapshotDate: '2026-04-01', totalValue: 400_000 },
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
  syncCalcScope(2);
  return render(
    <MemoryRouter initialEntries={['/calculators?view=p2']}>
      <EarliestRetirementCard cardId="retirement-age" />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetStores();
  sessionStorage.clear();
  localStorage.clear();
  __resetScenarioAssumptionsForTests();
  __resetCalcScopeForTests();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(PINNED_DATE);
  primeStores();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the solve + the visible search (single person, age 36, target $1.5M)', () => {
  // t* ≈ 28.5465 ⇒ answerT 29 ⇒ Age 65. Probe trace for tMax 54:
  // 54✓ · 27✕ · 40✓ · 33✓ · 30✓ · 28✕ · 29✓ (7 probes).
  it('headline Age 65; CP-30 meaning names the person and scenario', () => {
    renderCard();
    expect(screen.getByTestId('retirement-age-headline')).toHaveTextContent('Age 65');
    expect(screen.getByTestId('retirement-age-meaning')).toHaveTextContent(
      "earliest whole-year age where Alice's plan holds — at your Moderate scenario",
    );
  });

  it('CROSS-CARD PARITY (D-R6): the headline age equals ageNow + ceil(yearsToFi) on the same inputs', () => {
    renderCard();
    const years = yearsToFi({ pv: 200_000, pmt: 24_000, annualRate: realRateOfUnfloored(0.06, 0.03), targetFv: 1_500_000 });
    expect(Math.ceil(years)).toBe(29); // the PathToFi moderate solve, 28.5 → 29
    expect(screen.getByTestId('retirement-age-headline')).toHaveTextContent(`Age ${36 + Math.ceil(years)}`);
  });

  it('CP-31 criterion sentence renders verbatim', () => {
    renderCard();
    expect(
      screen.getByText(
        "Holds means: the projected portfolio at that age meets the target $1,500,000 = 12 × $5,000/mo ÷ 4% SWR — in today's dollars, at 6% ≈ 2.9% real.",
      ),
    ).toBeInTheDocument();
  });

  it('CP-32 probe rows: an ORDERED LIST in tested order, glyphs aria-hidden with sr-only text', () => {
    renderCard();
    const list = screen.getByTestId('retirement-age-probes');
    expect(list.tagName).toBe('OL');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(7);
    // Row regexes are unanchored (plan divergence): each <li>'s text is
    // '{glyph}{sr-only "Holds: "/"Not yet: "}Age N · …' — the glyph and the
    // sr-only text are pinned separately below.
    expect(items[0]).toHaveTextContent(/Age 90 · /); // tMax first — the honest far probe
    expect(items[1]).toHaveTextContent(/Age 63 · /); // mid 27
    expect(items[6]).toHaveTextContent(/Age 65 · /); // the answer, tested last here
    // renderer↔module agreement on a row's dollars:
    const fv29 = projectedFv(200_000, 24_000, realRateOfUnfloored(0.06, 0.03), 29);
    expect(items[6]).toHaveTextContent(`${formatCurrency(fv29)} vs $1,500,000 — holds`);
    // non-color glyphs: aria-hidden ✓/✕ + sr-only 'Holds: '/'Not yet: '
    expect(items[0].querySelector('[aria-hidden]')).toHaveTextContent('✓');
    expect(items[1].querySelector('.sr-only')).toHaveTextContent('Not yet:');
    expect(screen.getByText('The search')).toBeInTheDocument(); // CP-44 section label
  });

  it('CP-33 verdict row is last and emphasized', () => {
    renderCard();
    const verdict = screen.getByTestId('retirement-age-verdict');
    expect(verdict).toHaveTextContent('Earliest: age 65 — the first age that holds.');
    expect(verdict.className).toContain('font-medium');
  });

  it('CP-35/CP-36 assumes lines render (provenance tail from the bar)', () => {
    renderCard();
    expect(screen.getByText(/^Contributions of \$24,000\/yr continue until that age — /)).toBeInTheDocument();
    expect(screen.getByText('Ages count whole years from today.')).toBeInTheDocument();
  });

  it('CP-34 range across three scenarios: 61–70 across scenarios (closed-form ceil ages, DP-12)', () => {
    primeScenarios([{ label: 'Conservative', ratePct: 5 }, { label: 'Moderate', ratePct: 6 }, { label: 'Aggressive', ratePct: 7 }]);
    renderCard();
    // Conservative → t 34 → 70; Moderate → 29 → 65; Aggressive → 25 → 61.
    expect(screen.getByTestId('retirement-age-headline')).toHaveTextContent('61–70 across scenarios');
  });

  it('the range line is HIDDEN with a single scenario (the Custom-collapse gate)', () => {
    renderCard(); // single Moderate
    expect(screen.queryByText(/across scenarios/)).not.toBeInTheDocument();
  });
});

describe('edge verdicts (the spec edge table)', () => {
  it('already holds (CP-37): headline Now, no probe list', () => {
    primeBar({ portfolio: 2_000_000 });
    renderCard();
    expect(screen.getByTestId('retirement-age-headline')).toHaveTextContent('Now');
    expect(screen.getByTestId('retirement-age-meaning')).toHaveTextContent(
      'the target is already met at age 36 — nothing left to solve.',
    );
    expect(screen.queryByTestId('retirement-age-probes')).not.toBeInTheDocument();
  });

  it('not by 90 (CP-38): headline —, meaning verbatim, the single age-90 probe row still shown (DP-14)', () => {
    primeBar({ portfolio: 1_000, annualContribution: 0 });
    renderCard();
    expect(screen.getByTestId('retirement-age-headline')).toHaveTextContent('—');
    expect(screen.getByTestId('retirement-age-meaning')).toHaveTextContent(
      "the plan doesn't hold by age 90 under these assumptions.",
    );
    const items = within(screen.getByTestId('retirement-age-probes')).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent(/Age 90 · /);
    expect(items[0].querySelector('[aria-hidden]')).toHaveTextContent('✕');
  });

  it('never-real (CP-39): the Wave-17 lock string byte-exact in a warning span; tMax probe shown', () => {
    primeBar({ returnPct: 2, inflationPct: 3 }); // real rate < 0, target unreached
    renderCard();
    const lock = screen.getByText('Returns at or below inflation — the target is never reached in real terms.');
    expect(lock.className).toContain('text-warning-foreground');
    expect(within(screen.getByTestId('retirement-age-probes')).getAllByRole('listitem')).toHaveLength(1);
  });

  it('past the cap (CP-40)', () => {
    primePersons([{ name: 'Elder', dateOfBirth: '1930-01-01' }]); // age 96 at the pinned date
    renderCard();
    expect(screen.getByTestId('retirement-age-meaning')).toHaveTextContent(
      "Past age 90 — the solver's search range ends there.",
    );
  });

  it('noTarget (CP-41): the PathToFi register with the adapted tail', () => {
    primeBar({ monthlyExpenses: 0 });
    renderCard();
    expect(screen.getByTestId('retirement-age-meaning')).toHaveTextContent(
      'Enter monthly expenses and a withdrawal rate in the scenario bar above to see your earliest retirement age.',
    );
  });

  it('hasData empty (CP-42): no persons → the Add-a-person register', () => {
    primePersons([]);
    renderCard();
    expect(screen.getByTestId('retirement-age-meaning')).toHaveTextContent(
      'Add a person to see your earliest retirement age.',
    );
    expect(screen.getByRole('link', { name: 'Add a person' })).toHaveAttribute('href', '/inputs/persons');
  });
});

describe('two-person household framing (D-R5/DP-11, ⚑ F6)', () => {
  beforeEach(() => primePersons([
    { name: 'Alice', dateOfBirth: '1990-01-01' }, // 36 — the older; the 90-cap binds here
    { name: 'Bob', dateOfBirth: '1993-01-01' },   // 33
  ]));

  it('headline In 29 years; meaning names BOTH ages at that date', () => {
    renderCard();
    expect(screen.getByTestId('retirement-age-headline')).toHaveTextContent('In 29 years');
    expect(screen.getByTestId('retirement-age-meaning')).toHaveTextContent(
      'earliest year the household plan holds — when Alice is 65 and Bob is 62, at your Moderate scenario',
    );
  });

  it('probe rows and verdict speak in years-from-now', () => {
    renderCard();
    const items = within(screen.getByTestId('retirement-age-probes')).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent(/In 54 years · /);
    expect(screen.getByTestId('retirement-age-verdict')).toHaveTextContent(
      'Earliest: in 29 years — the first year that holds.',
    );
    expect(screen.getByText(/^Contributions of \$24,000\/yr continue until then — /)).toBeInTheDocument();
  });
});

describe('scope', () => {
  it('person scope solves on that person and renders the CP-43 exclusions line', () => {
    renderScopedCard(); // the ?view=p2 priming
    expect(screen.getByTestId('retirement-age-scope-exclusions')).toHaveTextContent(/solve counts only/);
    // Age-framed in person scope (unanchored: the shell's sr-only card-name
    // attribution precedes the headline text; a years-framed headline would
    // read 'In N years' and carry no 'Age').
    expect(screen.getByTestId('retirement-age-headline')).toHaveTextContent(/Age \d+/);
    expect(screen.getByTestId('retirement-age-meaning')).toHaveTextContent(/where Bob's plan holds/);
  });
});
