/**
 * W1 Task 4 — StressTestCard: window chips, KEEP/PORTFOLIO modes, in-card
 * v1.3 disclosure gate, honesty lines, deterministic replay pins.
 *
 * Priming block copied from PathToFiCard.test.tsx (the house fixture):
 * pinned date 2026-05-14, Alice dob 1990-01-01. Default bar: portfolio
 * $100k (snapshot), $12k/yr contributions (12 × $1,000/mo), Moderate 6%,
 * SWR 4%, inflation 3%. Acceptance seeded at backtest '1.3' so most tests
 * render ungated.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useAcceptancesStore } from '@/stores/disclosure-acceptances-store';
import { FilingStatus, ContributionSource, SnapshotSource, AccountType } from '@/types/enums';
import { StressTestCard } from '@/pages/calculators/StressTestCard';
import { __resetScenarioAssumptionsForTests } from '@/lib/calculators/use-scenario-assumptions';
import { syncCalcScope, __resetCalcScopeForTests } from '@/lib/calculators/calc-view-scope';
import { replayWindow, datasetReplayRows } from '@/lib/backtest/replay';
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
  seedAcceptance('backtest', '1.3');
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
  });

  it('the button mounts DisclosureModal (v1.3 + diff box); Escape cancels without accepting', () => {
    seedAcceptance('backtest', '1.2');
    renderCard();
    fireEvent.click(screen.getByRole('button', { name: 'Read and accept the Backtest disclosure' }));
    expect(screen.getByTestId('disclosure-modal-body')).toBeInTheDocument();
    expect(screen.getByText('Version 1.3')).toBeInTheDocument();
    expect(screen.getByText('What changed since you last accepted:')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('disclosure-modal-body')).not.toBeInTheDocument();
    // still gated — cancel is not consent
    expect(screen.getByTestId('stress-test-meaning')).toHaveTextContent('Accept the Historical Backtest disclosure');
  });

  it('accepted at exactly 1.3 → the chips render', () => {
    renderCard(); // default seed: '1.3'
    expect(screen.getByTestId('stress-window-picker')).toBeInTheDocument();
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

  it('recovery row: KEEP counts contributions (CP-12); Portfolio only does not (CP-13) — year agrees with the module', () => {
    renderCard();
    setStockPct(100);
    clickChip('The dot-com crash'); // KEEP default
    const keepYear = replayWindow({
      startBalance: 100_000, annualContribution: 12_000,
      span: { startYear: 2000, endYear: 2002 }, rows: datasetReplayRows(1),
    }).recoveredYear!;
    expect(screen.getByTestId('stress-recovery')).toHaveTextContent(
      `Back at its starting value: ${keepYear} — with your $12,000/yr contributions counted.`,
    );
    clickMode('Portfolio only');
    const soloYear = replayWindow({
      startBalance: 100_000, annualContribution: 0,
      span: { startYear: 2000, endYear: 2002 }, rows: datasetReplayRows(1),
    }).recoveredYear;
    if (soloYear == null) {
      expect(screen.getByTestId('stress-recovery')).toHaveTextContent(
        'Not back to its starting value by 2022, where the bundled data ends.',
      );
    } else {
      expect(screen.getByTestId('stress-recovery')).toHaveTextContent(`Back at its starting value: ${soloYear}.`);
    }
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

  it('window + mode persist as VIEW-STATE (sessionStorage; dirty tick untouched)', () => {
    const first = renderCard();
    clickChip('The 2008 crash');
    clickMode('Portfolio only');
    first.unmount();
    renderCard();
    expect(screen.getByRole('radio', { name: 'The 2008 crash 2008' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'Portfolio only' })).toHaveAttribute('aria-pressed', 'true');
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
