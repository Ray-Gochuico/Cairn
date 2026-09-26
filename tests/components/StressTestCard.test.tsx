/**
 * W1 Task 4 — StressTestCard: window chips, KEEP/PORTFOLIO modes, in-card
 * in-card disclosure gate, honesty lines, deterministic replay pins.
 *
 * Priming block copied from PathToFiCard.test.tsx (the house fixture):
 * pinned date 2026-05-14, Alice dob 1990-01-01. Default bar: portfolio
 * $100k (snapshot), $12k/yr contributions (12 × $1,000/mo), Moderate 6%,
 * SWR 4%, inflation 3%. Acceptance seeded at the current backtest version
 * (DISCLOSURE_VERSIONS, tests/helpers/disclosure-versions.ts) so most tests
 * render ungated.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useAcceptancesStore } from '@/stores/disclosure-acceptances-store';
import { FilingStatus, ContributionSource, SnapshotSource, AccountType } from '@/types/enums';
import { StressTestCard, chartEndYear } from '@/pages/calculators/StressTestCard';
import { datasetReplayRows, replayWindow } from '@/lib/backtest/replay';
import { __resetScenarioAssumptionsForTests } from '@/lib/calculators/use-scenario-assumptions';
import { syncCalcScope, __resetCalcScopeForTests } from '@/lib/calculators/calc-view-scope';
import { DISCLOSURES } from '@/legal/disclosures';
import { CALCULATORS_PAGE_ID, __resetDollarBasisForTests, useDollarBasisStore } from '@/lib/calculators/dollar-basis';
import type { Account, GrowthScenario, Person } from '@/types/schema';
import { DISCLOSURE_VERSIONS } from '../helpers/disclosure-versions';

// DP-13 marker pin (review MINOR 10): recharts measures nothing in jsdom, so
// the chart's marker CONTRACT is pinned at the prop boundary. The smoke fix
// adds the SERIES contract (which years are plotted) at the same boundary;
// the B2 review adds the VALUES plotted (`data-balances`) — the sweep's rows
// hook pins cross-basis identity only, so a basis-independent re-inflation of
// the plotted balances is caught here or nowhere. v1.7.1 A-5a adds the SERIES
// NAMES (`data-series-labels`) — the tooltip's label, which jsdom never draws.
// No other test in this file reads the chart's internals.
vi.mock('@/components/charts/InlineChart', () => ({
  InlineChart: ({
    testId,
    label,
    labelTestId,
    markers,
    data,
    series,
  }: {
    testId?: string;
    label?: string;
    labelTestId?: string;
    markers?: Array<{ x: number | string; y: number; color: string }>;
    data?: Array<{ [key: string]: number | string }>;
    series?: Array<{ dataKey: string; label: string }>;
  }) => (
    <div
      data-testid={testId}
      data-markers={JSON.stringify(markers ?? [])}
      data-years={JSON.stringify((data ?? []).map((p) => p.year))}
      data-balances={JSON.stringify((data ?? []).map((p) => p.balance))}
      data-series-labels={JSON.stringify((series ?? []).map((s) => s.label))}
    >
      {label != null && <div data-testid={labelTestId}>{label}</div>}
    </div>
  ),
}));

function chartMarkers(): Array<{ x: number; y: number; color: string }> {
  return JSON.parse(screen.getByTestId('stress-test-chart').getAttribute('data-markers')!);
}

function chartYears(): number[] {
  return JSON.parse(screen.getByTestId('stress-test-chart').getAttribute('data-years')!);
}

function chartBalances(): number[] {
  return JSON.parse(screen.getByTestId('stress-test-chart').getAttribute('data-balances')!);
}

function chartSeriesLabels(): string[] {
  return JSON.parse(screen.getByTestId('stress-test-chart').getAttribute('data-series-labels')!);
}

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
    { accountId: 1, snapshotDate: '2026-04-01', totalValue: 100_000 },
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
      return { amount: 1000, date: d.toISOString().slice(0, 10) };
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

/** Seed the acceptances projection (the gate's fast-path read). */
function seedAcceptance(id: string, version: string) {
  useAcceptancesStore.setState({
    acceptedVersions: { [id]: version },
    status: 'ready',
    isLoading: false,
    error: null,
  });
}

/** Re-prime with a specific portfolio + annual contribution. */
function primePortfolio(portfolio: number, contribution: number) {
  primeStores({
    snapshotValues: [{ accountId: 1, snapshotDate: '2026-04-01', totalValue: portfolio }],
    contributionAmounts: Array.from({ length: 12 }, (_, i) => {
      const d = new Date(PINNED_DATE);
      d.setMonth(d.getMonth() - i);
      return { amount: contribution / 12, date: d.toISOString().slice(0, 10) };
    }),
  });
}

function renderCard() {
  return render(
    <MemoryRouter>
      <StressTestCard cardId="stress-test" />
    </MemoryRouter>,
  );
}

function renderCardAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <StressTestCard cardId="stress-test" />
    </MemoryRouter>,
  );
}

/** Wave-B scoped fixture (PathToFiCard.test.tsx primeScoped): Bob owns $40k,
 *  joint $8k, $600/yr unattributed. */
function renderScopedCard() {
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
  syncCalcScope(2);
  return render(
    <MemoryRouter initialEntries={['/calculators?view=p2']}>
      <StressTestCard cardId="stress-test" />
    </MemoryRouter>,
  );
}

function setStockPct(n: number) {
  fireEvent.change(screen.getByLabelText('Stocks (%)'), { target: { value: String(n) } });
}

function clickMode(name: string) {
  fireEvent.click(screen.getByRole('button', { name }));
}

function clickChip(labelText: string) {
  fireEvent.click(screen.getByText(labelText));
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
  seedAcceptance('backtest', DISCLOSURE_VERSIONS.backtest);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('gate (in-card, never page-blocking — DP-7)', () => {
  it('unaccepted (or v1.2-accepted) → CP-25 meaning + Read-and-accept button; no chips', () => {
    seedAcceptance('backtest', '1.2'); // stale version — the bump re-gates (exact-string compare)
    renderCard();
    expect(screen.getByTestId('stress-test-meaning')).toHaveTextContent(
      'Accept the Historical Backtest disclosure to run stress tests.',
    );
    expect(screen.getByRole('button', { name: 'Read and accept the Backtest disclosure' })).toBeInTheDocument();
    expect(screen.queryByTestId('stress-window-picker')).not.toBeInTheDocument();
    // CP-26 body byte-exact — the only rendered string that says WHY a
    // Backtest-titled disclosure gates a stress card (consent scope).
    expect(
      screen.getByText(
        'Stress tests replay named historical windows from the same dataset and return basis as the Historical Backtest. One disclosure covers both.',
      ),
    ).toBeInTheDocument();
  });

  it('accepting in-card records EXACTLY the current version and flips the gate; a stale 1.2 keeps it closed', async () => {
    seedAcceptance('backtest', '1.2');
    const accept = vi.fn(async (id: string, version: string) => {
      useAcceptancesStore.setState((s) => ({
        acceptedVersions: { ...s.acceptedVersions, [id]: version },
      }));
    });
    useHouseholdStore.setState({ acceptDisclaimer: accept } as never);
    renderCard();
    expect(screen.queryByTestId('stress-window-picker')).not.toBeInTheDocument(); // stale 1.2 gates
    fireEvent.click(screen.getByRole('button', { name: 'Read and accept the Backtest disclosure' }));
    fireEvent.click(
      screen.getByRole('checkbox', { name: DISCLOSURES.backtest.acceptanceCheckboxLabel }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByTestId('stress-window-picker')).toBeInTheDocument();
    expect(accept).toHaveBeenCalledWith('backtest', DISCLOSURE_VERSIONS.backtest);
  });

  it('the button mounts DisclosureModal (v1.5 + diff box); Escape cancels without accepting', () => {
    seedAcceptance('backtest', '1.2');
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Read and accept the Backtest disclosure' }));
    expect(screen.getByTestId('disclosure-modal-body')).toBeInTheDocument();
    expect(screen.getByText(`Version ${DISCLOSURE_VERSIONS.backtest}`)).toBeInTheDocument();
    expect(screen.getByText('What changed since you last accepted:')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('disclosure-modal-body')).not.toBeInTheDocument();
    // still gated — cancel is not consent
    expect(screen.getByTestId('stress-test-meaning')).toHaveTextContent('Accept the Historical Backtest disclosure');
  });

  it('accepted at exactly 1.5 → the chips render', () => {
    renderCard(); // default seed: the current backtest version (DISCLOSURE_VERSIONS)
    expect(screen.getByTestId('stress-window-picker')).toBeInTheDocument();
  });

  it('an accepted v1.4 is re-gated (the v1.5 transition — the field household on the day R3 ships)', () => {
    seedAcceptance('backtest', '1.4');
    renderCard();
    expect(screen.queryByTestId('stress-window-picker')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Read and accept the Backtest disclosure' }));
    expect(screen.getByText(`Version ${DISCLOSURE_VERSIONS.backtest}`)).toBeInTheDocument();
    // A prior acceptance is recorded → the re-prompt box renders (Task 3 keeps this true).
    expect(screen.getByText('What changed since you last accepted:')).toBeInTheDocument();
  });

  it('R3: a NEVER-accepted household opens the modal without the what-changed box', () => {
    seedAcceptance('app_wide', DISCLOSURES.app_wide.version); // another document accepted; backtest never
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Read and accept the Backtest disclosure' }));
    expect(screen.getByText(`Version ${DISCLOSURE_VERSIONS.backtest}`)).toBeInTheDocument();
    expect(screen.queryByText('What changed since you last accepted:')).toBeNull();
    // CR-R3-1 as a literal, not DISCLOSURES.backtest.acceptanceCheckboxLabel
    // (constraint 3): the label is consent copy, so this pin has to trip on the
    // next bump rather than follow the registry to whatever it becomes.
    expect(
      screen.getByRole('checkbox', {
        name: 'I understand the Backtest tool, the Stress Test card, and the History view report historical outcomes only and are not a prediction of future performance.',
      }),
    ).toBeInTheDocument();
  });
});

describe('replay rendering — deterministic pins (portfolio 100k)', () => {
  it('dot-com, 100% stocks, Portfolio only: headline −39% real inside the shell live region; CP-9 meaning', () => {
    renderCard();
    setStockPct(100);
    clickMode('Portfolio only');
    clickChip('The dot-com crash');
    const headline = screen.getByTestId('stress-test-headline');
    expect(headline).toHaveTextContent('−39% real');
    expect(headline).toHaveAttribute('role', 'status'); // deviation #3 — the shell announces
    expect(screen.getByTestId('stress-test-meaning')).toHaveTextContent(
      "deepest year-end of The dot-com crash against your $100,000 — 100/0 mix, today's dollars",
    );
  });

  it('CP-10/CP-11 metric rows carry the P1 dollars', () => {
    renderCard();
    setStockPct(100);
    clickMode('Portfolio only');
    clickChip('The dot-com crash');
    expect(screen.getByText('$60,858 in 2002 · −39.1% vs start')).toBeInTheDocument();
    expect(screen.getByText('End of window (2002)')).toBeInTheDocument();
    expect(screen.getByText('$60,858 · −39.1% vs start')).toBeInTheDocument();
  });

  it('recovery row: KEEP counts contributions (CP-12); Portfolio only does not (CP-13) — LITERAL years', () => {
    // Hand-derived from the literal Shiller rows at 100% stocks, $100k start:
    //   KEEP $12k/yr year-ends 2000 $102,893.85 · 2001 $99,208.01 ·
    //   2002 $87,962.59 (the trough) · 2003 $124,346.60 → recovery 2003.
    //   Portfolio-only trough 2002 $60,858.41 → recovery 2013.
    // Review MAJOR 0/2: these were derived FROM replayWindow, so the old
    // pre-trough answer (2000) passed as "expected"; literals can fail.
    renderCard();
    setStockPct(100);
    clickChip('The dot-com crash'); // KEEP default
    expect(screen.getByTestId('stress-recovery')).toHaveTextContent(
      'Back at its starting value: 2003 — with your $12,000/yr contributions counted.',
    );
    clickMode('Portfolio only');
    expect(screen.getByTestId('stress-recovery')).toHaveTextContent(
      'Back at its starting value: 2013.',
    );
  });

  it('the DEFAULT state (1929, KEEP, 75/25) puts the recovery AFTER the trough (review MAJOR 0/2)', () => {
    // Year-ends 1929 $106,181.39 · 1930 $107,006.19 · 1931 $90,195.78 (trough)
    // · 1932 $109,478.57. Year 1 is ABOVE the $100k start, so the pre-review
    // scan rendered "Back at its starting value: 1929" beside a 1931 trough.
    renderCard(); // depression-1929 · KEEP · 75/25 · $100k · $12k/yr
    expect(screen.getByText('$90,196 in 1931 · −9.8% vs start')).toBeInTheDocument();
    expect(screen.getByTestId('stress-recovery')).toHaveTextContent(
      'Back at its starting value: 1932 — with your $12,000/yr contributions counted.',
    );
  });

  it('the 2022 window renders the data-ends line verbatim (CP-14 — zero tail, nothing extrapolated)', () => {
    renderCard();
    clickMode('Portfolio only');
    clickChip('The 2022 inflation shock');
    expect(screen.getByTestId('stress-recovery')).toHaveTextContent(
      'Not back to its starting value by 2022, where the bundled data ends.',
    );
  });

  it('contributions-outpaced (CP-15/DP-15): tiny portfolio + huge contributions on the 2008 window', () => {
    primePortfolio(10_000, 100_000);
    renderCard();
    clickChip('The 2008 crash'); // KEEP default
    expect(
      screen.getByText("Never below its starting value at a year-end — contributions outpaced this window's losses."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('stress-recovery')).not.toBeInTheDocument(); // recovery row omitted
    // Unanchored (plan divergence): the shell prepends a sr-only "Stress Test: "
    // attribution inside the live region (W16 AT convention) — the + sign is
    // the pinned behavior; U+2212 would not match \+.
    expect(screen.getByTestId('stress-test-headline')).toHaveTextContent(/\+\d+% real/); // signed minimum as computed
  });

  it('CP-16 baseline row states both endpoints and the signed gap', () => {
    renderCard();
    setStockPct(100);
    clickMode('Portfolio only');
    clickChip('The dot-com crash');
    // baseline: 100k at realRateOfUnfloored(0.06, 0.03) = 3/103, portfolio-only, 3 years:
    // 100000 · (106/103)^3 = $108,994.84 → renders $108,995 (whole dollars).
    // gap = 60,858.41 − 108,994.84 = −48,136.43 → −$48,136 (hand-verified at planning time).
    expect(screen.getByText('Vs your assumed path (3 years)')).toBeInTheDocument();
    expect(screen.getByText('$108,995 assumed · $60,858 replayed · gap −$48,136')).toBeInTheDocument();
  });

  it('CP-16 in the DEFAULT KEEP mode carries the mode contribution basis (same window as the Portfolio-only pin)', () => {
    // D-W1-9 "compounded with the MODE's contribution basis": KEEP adds the
    // bar's $12,000/yr to BOTH legs. flatPathEnd(100000, 3/103, 12000, 3) =
    // $146,545.71 → $146,546 assumed (Portfolio-only reads $108,995 on this
    // same window, one line above); replay at 100% stocks ends 2002 at
    // $87,962.59 → $87,963; gap −$58,583.12 → −$58,583.
    renderCard();
    setStockPct(100);
    clickChip('The dot-com crash'); // KEEP is the default mode
    expect(screen.getByText('Vs your assumed path (3 years)')).toBeInTheDocument();
    expect(screen.getByText('$146,546 assumed · $87,963 replayed · gap −$58,583')).toBeInTheDocument();
  });

  it('CP-16 says "(1 year)" on a single-year window', () => {
    renderCard();
    clickMode('Portfolio only');
    clickChip('The 2008 crash');
    expect(screen.getByText('Vs your assumed path (1 year)')).toBeInTheDocument();
  });

  it('trough ≠ end (1970s, Portfolio only, 75/25): headline, CP-10 and CP-11 are three DIFFERENT figures', () => {
    // Re-derived from the literal Shiller rows (75/25 real blends, zero
    // contributions ⇒ exact annual factors): 1973 $80,949.27 · 1974
    // $61,692.11 (the trough) · … · 1981 $67,355.49 (the window end) ·
    // 1984 $102,431.29 (the recovery). depth −38.3079% · endDelta −32.6445%.
    renderCard();
    clickMode('Portfolio only');
    clickChip('The 1970s inflation run');
    expect(screen.getByTestId('stress-test-headline')).toHaveTextContent('−38% real');
    expect(screen.getByText('$61,692 in 1974 · −38.3% vs start')).toBeInTheDocument();
    expect(screen.getByText('End of window (1981)')).toBeInTheDocument();
    expect(screen.getByText('$67,355 · −32.6% vs start')).toBeInTheDocument();
    expect(screen.getByTestId('stress-recovery')).toHaveTextContent(
      'Back at its starting value: 1984.',
    );
  });

  it('DP-13 chart markers: destructive at the trough year, blaze at the recovery year (recovery is later)', () => {
    renderCard();
    clickMode('Portfolio only');
    clickChip('The 1970s inflation run');
    const [trough, recovery] = chartMarkers();
    expect(trough.x).toBe(1974);
    expect(trough.y).toBeCloseTo(61_692.11, 2);
    expect(trough.color).toBe('hsl(var(--destructive))');
    expect(recovery.x).toBe(1984);
    expect(recovery.y).toBeCloseTo(102_431.29, 2);
    expect(recovery.color).toBe('hsl(var(--blaze))');
    expect(recovery.x).toBeGreaterThan(trough.x);
  });

  it('outpaced (CP-15) is a KEEP-mode claim about CONTRIBUTIONS, not any window that stayed above start', () => {
    // 2008 at 0% stocks is the edge: the bond leg returned +14.7369% real, so
    // every year-end clears the $100k start with NO contributions at all.
    // Portfolio-only must show the dollar row (the mode has no contribution
    // claim to make) …
    renderCard();
    setStockPct(0);
    clickMode('Portfolio only');
    clickChip('The 2008 crash');
    expect(screen.getByText('$114,737 in 2008 · +14.7% vs start')).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Never below its starting value at a year-end — contributions outpaced this window's losses.",
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('stress-recovery')).toBeInTheDocument();
  });

  it('CP-15 requires contributions: KEEP with $0/yr on that same window states the dollars instead', () => {
    primePortfolio(100_000, 0); // no contributions recorded
    renderCard();
    setStockPct(0);
    clickChip('The 2008 crash'); // KEEP default
    expect(screen.getByText('$114,737 in 2008 · +14.7% vs start')).toBeInTheDocument();
    expect(
      screen.queryByText(
        "Never below its starting value at a year-end — contributions outpaced this window's losses.",
      ),
    ).not.toBeInTheDocument();
  });

  it('A-12 (v1.7.1, CR-C3-E): KEEP with $0/yr on a recovering window states the bare year — the "$0/yr contributions counted" qualifier never renders (the Roadmap thread\'s CI-MS-2r rule, card-side)', () => {
    // 100% stocks, $100k, NO contributions: KEEP replays exactly the
    // portfolio-only path (trough 2002 $60,858.41 → recovery 2013, the CP-13
    // literal pinned above). Before this wave the KEEP arm printed
    // "Back at its starting value: 2013 — with your $0/yr contributions counted."
    // — a $0 qualifier the kernel thread (market-stress.ts CI-MS-2r) drops.
    primePortfolio(100_000, 0);
    renderCard();
    setStockPct(100);
    clickChip('The dot-com crash'); // KEEP default
    expect(screen.getByTestId('stress-recovery').textContent).toBe('Back at its starting value: 2013.');
    expect(screen.getByTestId('stress-recovery').textContent).not.toContain('$0/yr');
    clickMode('Portfolio only');
    expect(screen.getByTestId('stress-recovery').textContent).toBe('Back at its starting value: 2013.'); // CP-13, byte-identical
  });
});

describe('chart series is a VIEW of the replay, clipped at the recovery (smoke fix)', () => {
  // `replayWindow` runs from the window start to the DATASET END because the
  // recovery search needs that tail — plotting all of it turned a 3-year 1929
  // stress window into a 94-point line to 2022 with a ~$180M y-axis, on a card
  // whose first line is "History that happened once — not a forecast". The
  // chart stops where the card's own claims stop: the recovery year, or the
  // dataset end when the search found none. The replay itself is untouched.

  it('chartEndYear: recovery after the window end extends the chart to the recovery', () => {
    expect(chartEndYear({ startYear: 1973, endYear: 1981 }, 1984, 2022)).toBe(1984);
  });

  it('chartEndYear: a recovery INSIDE the window still charts through the window end', () => {
    expect(chartEndYear({ startYear: 2000, endYear: 2002 }, 2001, 2022)).toBe(2002);
  });

  it('chartEndYear: no recovery charts through the dataset end (the search evidence)', () => {
    expect(chartEndYear({ startYear: 1929, endYear: 1931 }, null, 2022)).toBe(2022);
  });

  it('the DEFAULT 1929 state plots 1929–1932 (four points), not 1929–2022', () => {
    renderCard(); // depression-1929 · KEEP · 75/25 · $100k · $12k/yr → recovery 1932
    const years = chartYears();
    expect(years).toHaveLength(4);
    expect(years[0]).toBe(1929);
    expect(years[years.length - 1]).toBe(1932);
  });

  it('the 1970s Portfolio-only state plots 1973–1984 — through the recovery, past the 1981 window end', () => {
    renderCard();
    clickMode('Portfolio only');
    clickChip('The 1970s inflation run');
    const years = chartYears();
    expect(years).toHaveLength(12);
    expect(years[0]).toBe(1973);
    expect(years[years.length - 1]).toBe(1984);
    // the DP-13 markers still land inside the plotted range
    const [trough, recovery] = chartMarkers();
    expect(years).toContain(trough.x);
    expect(years).toContain(recovery.x);
  });

  it('B2 review: the DEFAULT state plots the replay year-ends BY VALUE — the literal 1929–1932 rows, exactly result.yearEnds', () => {
    // The literal year-ends of the default-state pin above (1929 $106,181.39 ·
    // 1930 $107,006.19 · 1931 $90,195.78 trough · 1932 $109,478.57): the
    // plotted rows are the real replay itself, never re-inflated for the chart.
    renderCard(); // depression-1929 · KEEP · 75/25 · $100k · $12k/yr
    const balances = chartBalances();
    expect(chartYears()).toEqual([1929, 1930, 1931, 1932]);
    expect(balances).toHaveLength(4);
    [106_181.39, 107_006.19, 90_195.78, 109_478.57].forEach((v, i) => expect(balances[i]).toBeCloseTo(v, 2));
    // …and byte-for-byte the replay's own year-ends (no transform on the way to the chart).
    const replay = replayWindow({
      startBalance: 100_000,
      annualContribution: 12_000,
      span: { startYear: 1929, endYear: 1931 },
      rows: datasetReplayRows(0.75),
    });
    expect(balances).toEqual(replay.yearEnds.filter((y) => y.year <= 1932).map((y) => y.balance));
    // the destructive marker sits ON the plotted trough point
    const [trough] = chartMarkers();
    expect(balances[chartYears().indexOf(trough.x)]).toBe(trough.y);
  });

  it('B2 review: the 1970s Portfolio-only state plots the literal trough, window-end and recovery balances', () => {
    // The literal anchors of the trough ≠ end pin: 1973 $80,949.27 · 1974
    // $61,692.11 (the trough) · 1981 $67,355.49 (the window end) · 1984
    // $102,431.29 (the recovery) — the plotted values, not only the markers.
    renderCard();
    clickMode('Portfolio only');
    clickChip('The 1970s inflation run');
    const years = chartYears();
    const balances = chartBalances();
    const at = (year: number) => balances[years.indexOf(year)];
    expect(at(1973)).toBeCloseTo(80_949.27, 2);
    expect(at(1974)).toBeCloseTo(61_692.11, 2);
    expect(at(1981)).toBeCloseTo(67_355.49, 2);
    expect(at(1984)).toBeCloseTo(102_431.29, 2);
  });

  it('the 2022 window clips to the single point it already is — below the two-point chart gate', () => {
    expect(chartEndYear({ startYear: 2022, endYear: 2022 }, null, 2022)).toBe(2022);
    renderCard();
    clickMode('Portfolio only');
    clickChip('The 2022 inflation shock');
    expect(screen.queryByTestId('stress-test-chart')).not.toBeInTheDocument();
  });

  it('the outpaced state (DP-15) draws NO markers — the rows they annotate are gone', () => {
    primePortfolio(1_000, 50_000);
    renderCard(); // depression-1929 · KEEP default
    expect(
      screen.getByText("Never below its starting value at a year-end — contributions outpaced this window's losses."),
    ).toBeInTheDocument();
    expect(chartMarkers()).toEqual([]);
    expect(chartYears()).toEqual([1929, 1930, 1931]); // the series still renders — the named window
  });
});

describe('honesty lines + cross-link', () => {
  it('CP-17/18/19/20/21 render verbatim', () => {
    renderCard();
    expect(screen.getByText('History that happened once — not a forecast, not a probability.')).toBeInTheDocument();
    expect(
      screen.getByText(
        "Stock leg: Shiller's CPI-deflated S&P total return; bond leg: 10-year Treasury total return deflated to real. 75% / 25% mix, rebalanced annually — the same return basis as the Historical Backtest.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("All figures in today's dollars — the window's inflation is already taken out.")).toBeInTheDocument();
    expect(screen.getByText('Measured at year-ends — the data is annual, so the worst moments within a year were deeper.')).toBeInTheDocument();
    expect(screen.getByText('The assumed path compounds your 6% return ≈ 2.9% real with the same contribution basis.')).toBeInTheDocument();
  });

  it('B3 (CR-B3-1c): CP-21 renders a negative real rate with a TRUE MINUS — 2% return at 3% inflation', () => {
    primeStores({ scenarios: [{ label: 'Moderate', rate: 0.02 }] }); // inflation stays the fixture's 3%
    renderCard();
    const line = screen.getByText(/^The assumed path compounds your/);
    expect(line.textContent).toBe(
      'The assumed path compounds your 2% return ≈ −1% real with the same contribution basis.',
    );
    expect(line.textContent).not.toContain('-');
  });

  it('CP-22 cross-link preserves the ?view= search (withViewSearch)', () => {
    renderCardAt('/calculators?view=p2');
    const link = screen.getByRole('link', { name: 'Open the Historical Backtest tool' });
    expect(link).toHaveTextContent('Every start year, not just these — open the Backtest tool →');
    expect(link.getAttribute('href')).toContain('/calculators/backtest');
    expect(link.getAttribute('href')).toContain('view=p2');
  });
});

describe('chips + persistence + provenance', () => {
  it('five radio chips with year-bearing accessible names; the selected blurb renders', () => {
    renderCard();
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    expect(screen.getByRole('radio', { name: 'The 1929 crash 1929–1931' })).toBeChecked(); // DP-6 default
    expect(screen.getByRole('radio', { name: 'The 2008 crash 2008' })).toBeInTheDocument(); // single year, no dash
    expect(
      screen.getByText('Three straight down years at the start of the Great Depression — the deepest stock declines in the dataset.'),
    ).toBeInTheDocument();
  });

  it('CP-20 is the FIRST body line after the picker; the window blurb follows it', () => {
    renderCard();
    const picker = screen.getByTestId('stress-window-picker');
    const register = screen.getByText('History that happened once — not a forecast, not a probability.');
    const blurb = screen.getByText(
      'Three straight down years at the start of the Great Depression — the deepest stock declines in the dataset.',
    );
    expect(picker.nextElementSibling).toBe(register);
    // eslint-disable-next-line no-bitwise
    expect(register.compareDocumentPosition(blurb) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('the selected chip year is differentiated WITHOUT an opacity-modified text token (AA)', () => {
    // Review MAJOR 5: text-primary-foreground/80 on bg-primary is 4.21 (light)
    // / 4.34 (dark) — under 4.5 for 12px text. The solid pair is 5.63 / 5.90.
    renderCard();
    const yearSpan = screen.getByText('1929–1931');
    expect(yearSpan.className).toContain('text-primary-foreground');
    expect(yearSpan.className).not.toMatch(/-foreground\//);
  });

  it('window + mode persist as VIEW-STATE (sessionStorage; dirty tick untouched)', () => {
    const first = renderCard();
    clickChip('The 2008 crash');
    clickMode('Portfolio only');
    first.unmount();
    renderCard();
    expect(screen.getByRole('radio', { name: 'The 2008 crash 2008' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Portfolio only' })).toHaveAttribute('aria-pressed', 'true');
    // B2 review: the group's accessible name (SegmentedControl's `label`) is pinned here, on the consumer.
    expect(screen.getByRole('group', { name: 'Stress mode' })).toContainElement(
      screen.getByRole('button', { name: 'Portfolio only' }),
    );
    expect(sessionStorage.getItem('calc-window:stress-test')).toBe('gfc-2008');
    expect(sessionStorage.getItem('calc-mode:stress-test')).toBe('PORTFOLIO');
    // view-state is not an override: no blaze dot, no RailReset
    expect(screen.queryByLabelText(/edited/)).not.toBeInTheDocument();
  });

  it('corrupt stored window id falls back to the default silently', () => {
    sessionStorage.setItem('calc-window:stress-test', 'not-a-window');
    renderCard();
    expect(screen.getByRole('radio', { name: 'The 1929 crash 1929–1931' })).toBeChecked();
  });

  it('stock % seeds from a VALID last Backtest run (CP-6) and falls back on garbage (CP-7 / F5 sanitize)', () => {
    localStorage.setItem('backtest:last-run:v1', JSON.stringify({
      v: 1, runAt: '2026-08-20T00:00:00.000Z', goalMetCount: 1, startYearsCount: 2, survivedCount: 2,
      config: { stockPct: 0.6 },
    }));
    const a = renderCard();
    expect(screen.getByLabelText('Stocks (%)')).toHaveValue(60);
    expect(screen.getByText('from your last Backtest run')).toBeInTheDocument();
    a.unmount();
    sessionStorage.clear();
    localStorage.setItem('backtest:last-run:v1', JSON.stringify({
      v: 1, runAt: 'x', goalMetCount: 0, startYearsCount: 1, survivedCount: 0,
      config: { stockPct: 1.5 }, // out of 0..1 — invalid
    }));
    renderCard();
    expect(screen.getByLabelText('Stocks (%)')).toHaveValue(75);
    expect(screen.getByText("app default 75/25 — the Backtest tool's default mix")).toBeInTheDocument();
  });
});

describe('empty + scoped states', () => {
  it('portfolio ≤ 0 → CP-23 EmptyMeaning with the /investments link; no chips run', () => {
    primePortfolio(0, 0);
    renderCard();
    expect(screen.getByTestId('stress-test-meaning')).toHaveTextContent(
      'Add account snapshots or set a portfolio in the scenario bar to stress it.',
    );
    expect(screen.getByRole('link', { name: 'Add account snapshots' })).toHaveAttribute('href', '/investments');
    expect(screen.queryByTestId('stress-window-picker')).not.toBeInTheDocument();
  });

  it('person scope renders the CP-27 exclusions line', () => {
    renderScopedCard();
    expect(screen.getByTestId('stress-test-scope-exclusions')).toHaveTextContent(/stress test counts only/);
  });
});

/* ── B2: the boundary leg + the W5 registration. NO figure moves — the
   registered nodes carry exactly the literals the getByText pins above read. ── */
describe('B2 — boundary leg + registration (no figure moves)', () => {
  afterEach(() => __resetDollarBasisForTests());

  const dotcomPortfolioOnly = () => {
    renderCard();
    setStockPct(100);
    clickMode('Portfolio only');
    clickChip('The dot-com crash');
  };

  it('the registered nodes carry the SAME CP-10/11/16 figures the pins above read; CP-18 is the mark element', () => {
    dotcomPortfolioOnly();
    expect(screen.getByTestId('stress-test-trough')).toHaveTextContent('$60,858 in 2002 · −39.1% vs start');
    expect(screen.getByTestId('stress-test-window-end')).toHaveTextContent('$60,858 · −39.1% vs start');
    expect(screen.getByTestId('stress-test-baseline')).toHaveTextContent(
      '$108,995 assumed · $60,858 replayed · gap −$48,136',
    );
    expect(screen.getByTestId('stress-test-basis-line')).toHaveTextContent(
      "All figures in today's dollars — the window's inflation is already taken out.",
    );
  });

  it("CR-B2-1: the chart caption names the pinned basis in the house short register — Window replay (today's $)", () => {
    renderCard(); // default 1929 state renders the chart
    expect(screen.getByTestId('stress-test-chart-caption')).toHaveTextContent("Window replay (today's $)");
  });

  it("CP5-1 (v1.7.1 A-5a): the replay series is named in the SAME pinned short register as its caption — Portfolio (today's $), in both page bases", () => {
    renderCard(); // default 1929 state renders the chart
    expect(chartSeriesLabels()).toEqual(["Portfolio (today's $)"]);
    act(() => useDollarBasisStore.getState().setBasis(CALCULATORS_PAGE_ID, 'future'));
    expect(chartSeriesLabels()).toEqual(["Portfolio (today's $)"]); // pinned today, never page-flipped
  });

  it('NOMINAL ANTI-PIN: the baseline compounds the REAL rate — the nominal-rate figures never render', () => {
    // 100000 · 1.06^3 = $119,101.60 (nominal) vs the pinned $108,995 (3/103 real, CP-16 pin above);
    // a helper phrasing the nominal rate would read "≈ 6% real" (CP-21 pins "≈ 2.9% real").
    dotcomPortfolioOnly();
    expect(screen.queryByText(/\$119,102/)).not.toBeInTheDocument();
    expect(screen.queryByText(/≈ 6% real/)).not.toBeInTheDocument();
    expect(screen.getByText(/≈ 2\.9% real/)).toBeInTheDocument();
  });

  it('a page-basis flip leaves every stress figure byte-identical (pinned today, never page-flipped)', () => {
    dotcomPortfolioOnly();
    const ids = [
      'stress-test-headline',
      'stress-test-meaning',
      'stress-test-trough',
      'stress-test-window-end',
      'stress-test-baseline',
      'stress-recovery',
      'stress-test-chart-caption',
    ];
    const before = ids.map((id) => screen.getByTestId(id).textContent);
    act(() => useDollarBasisStore.getState().setBasis(CALCULATORS_PAGE_ID, 'future'));
    expect(ids.map((id) => screen.getByTestId(id).textContent)).toEqual(before);
  });
});
