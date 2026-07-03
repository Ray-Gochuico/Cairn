import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { FilingStatus, ContributionSource, SnapshotSource } from '@/types/enums';
import { FinancialIndependenceCard } from '@/pages/calculators/FinancialIndependenceCard';
import type { GrowthScenario } from '@/types/schema';

// The "today" that all test logic is pinned to — must be a stable ISO string
// so that:
//  1. `sumLatestOnOrBefore(snapshots, todayIso)` in the card picks up
//     the seeded 2026-04-01 snapshot (which is on-or-before 2026-05-14).
//  2. The rolling-12-month contribution filter is deterministic: contributions
//     generated as "month i before pinned today" are always inside the window.
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
    persons: [basePerson],
    isLoading: false,
    error: null,
  });

  // Default seeds: $200k portfolio (one snapshot), $24k/yr contributions
  // (one $2k contribution per month for the last 12 months).
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

  // Default: 12 monthly contributions of $2k for $24k/yr — placed within the
  // last 12 months relative to PINNED_DATE (not the real clock) so the
  // rolling-12-month filter in the card is fully deterministic.
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

describe('FinancialIndependenceCard', () => {
  beforeEach(() => {
    resetStores();
    // Clear any persisted calculator overrides from previous tests.
    sessionStorage.clear();
    // Pin "today" to a stable date so the rolling-12-month contribution window
    // and the on-or-before-today snapshot cutoff are fully deterministic.
    // Mirrors the pattern used in CoastFiCard.test.tsx.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(PINNED_DATE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders empty state when household is not set', () => {
    // No household, no persons, no snapshots, no contributions
    render(
      <MemoryRouter>
        <FinancialIndependenceCard />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(/Add your inputs to see Years to FI/i),
    ).toBeInTheDocument();
    // Headline placeholder
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders headline "X years" with seeded household + snapshots + contributions', () => {
    primeStores();
    render(
      <MemoryRouter>
        <FinancialIndependenceCard />
      </MemoryRouter>,
    );

    // Headline shows a numeric "X years" string
    const headline = screen.getByTestId('fi-headline');
    expect(headline.textContent).toMatch(/\d+(\.\d+)?\s*years/i);
  });

  it('headline parses to a finite years value within a sensible range for the seeded fixture', () => {
    // $200k pv, $24k/yr pmt, target $1.5M (5000*12/0.04), Moderate=6%.
    // H1/N1: years are solved on the REAL rate. Inflation resolves via the
    // canonical chain: the fixture's household.inflationAssumption = 0.03 wins
    // (settings unprimed) → 6% nominal → (1.06/1.03)−1 = 2.9126% real →
    // ~28.5 years. Still finite and well within (5, 50).
    primeStores();
    render(
      <MemoryRouter>
        <FinancialIndependenceCard />
      </MemoryRouter>,
    );

    const headline = screen.getByTestId('fi-headline');
    const value = parseFloat(headline.textContent!.replace(/[^\d.]/g, ''));
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThan(5);
    expect(value).toBeLessThan(50);
  });

  it('headline shows ∞ when contributions are 0 and growth cannot reach target', () => {
    // Tiny portfolio, no contributions, only zero-rate scenario -> Infinity
    // Use a single 0% scenario so the Moderate fallback is also unreachable.
    primeStores({
      scenarios: [{ label: 'Moderate', rate: 0 }],
      contributionAmounts: [],
      snapshotValues: [
        { accountId: 1, snapshotDate: '2026-04-01', totalValue: 100 },
      ],
    });

    render(
      <MemoryRouter>
        <FinancialIndependenceCard />
      </MemoryRouter>,
    );

    const headline = screen.getByTestId('fi-headline');
    expect(headline.textContent).toContain('∞');
  });

  it('renders all scenarios from household.growthScenarios as table rows', () => {
    primeStores({ scenarios: fourScenarios });
    render(
      <MemoryRouter>
        <FinancialIndependenceCard />
      </MemoryRouter>,
    );

    // Each scenario label appears in the body
    expect(screen.getByText('Conservative')).toBeInTheDocument();
    expect(screen.getByText('Moderate')).toBeInTheDocument();
    expect(screen.getByText('Optimistic')).toBeInTheDocument();
    expect(screen.getByText('Bull')).toBeInTheDocument();

    // And so do their formatted rates (formatPercent strips trailing zeros → "5%" not "5.0%").
    expect(screen.getByText('5%')).toBeInTheDocument();
    expect(screen.getByText('6%')).toBeInTheDocument();
    expect(screen.getByText('7%')).toBeInTheDocument();
    expect(screen.getByText('8%')).toBeInTheDocument();
  });

  it('shows the target portfolio derived from monthlyExpenseBaseline / withdrawalRate', () => {
    // 5000 * 12 / 0.04 = 1,500,000
    primeStores();
    render(
      <MemoryRouter>
        <FinancialIndependenceCard />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Target portfolio/i)).toBeInTheDocument();
    expect(screen.getByText(/\$1,500,000/)).toBeInTheDocument();
  });

  it('uses the latest snapshot per account when multiple are seeded', () => {
    // Two accounts, two snapshots each; only the most-recent date per account
    // should sum into pv. Account 1 latest = 100k, Account 2 latest = 200k.
    // pv = 300k. With $24k/yr at 6% target $1.5M -> ~22 years.
    primeStores({
      snapshotValues: [
        { accountId: 1, snapshotDate: '2025-01-01', totalValue: 999_999 }, // older, must be ignored
        { accountId: 1, snapshotDate: '2026-04-01', totalValue: 100_000 },
        { accountId: 2, snapshotDate: '2025-06-01', totalValue: 1 },        // older
        { accountId: 2, snapshotDate: '2026-04-01', totalValue: 200_000 },
      ],
    });
    render(
      <MemoryRouter>
        <FinancialIndependenceCard />
      </MemoryRouter>,
    );

    // If older snapshots leaked in, pv would be ~1.3M -> under 1 year to FI.
    // With correct latest-only logic, pv=300k -> ~20 years at moderate 6%.
    const headline = screen.getByTestId('fi-headline');
    const value = parseFloat(headline.textContent!.replace(/[^\d.]/g, ''));
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThan(10);
    expect(value).toBeLessThan(40);
  });

  it('forwards cardId + onHide so the Hide button appears on the card', () => {
    primeStores();
    render(
      <MemoryRouter>
        <FinancialIndependenceCard cardId="financial-independence" onHide={() => {}} />
      </MemoryRouter>,
    );
    // CalculatorCard renders a "Hide <title> card" button when cardId is set.
    expect(
      screen.getByRole('button', { name: /hide years to fi card/i }),
    ).toBeInTheDocument();
  });

  it('excludes future-dated snapshots from the current portfolio (latest on-or-before today)', () => {
    primeStores();
    // A snapshot dated far in the future must NOT inflate the portfolio — the
    // retrofit uses sumLatestOnOrBefore(snapshots, today), not a raw max-per-account.
    // Use PINNED_DATE + 5 years so the test stays deterministic under the fake clock.
    const future = new Date(PINNED_DATE);
    future.setFullYear(future.getFullYear() + 5);
    const futureIso = future.toISOString().slice(0, 10);
    useSnapshotsStore.setState({
      snapshots: [
        { id: 1, accountId: 1, snapshotDate: '2024-01-01', totalValue: 100000, source: SnapshotSource.MANUAL },
        { id: 2, accountId: 1, snapshotDate: futureIso, totalValue: 9_000_000, source: SnapshotSource.MANUAL },
      ],
      isLoading: false, error: null,
    });
    render(<MemoryRouter><FinancialIndependenceCard /></MemoryRouter>);
    // With the $9M future snapshot excluded, the current portfolio is $100k, so
    // years-to-FI stays a realistic 2-digit-ish number, NOT ~0. Assert the
    // headline stays > 0 years instead.
    const headline = screen.getByTestId('fi-headline');
    expect(headline.textContent).toMatch(/\d/);
    expect(headline.textContent).not.toMatch(/^0(\.0)?\s*years/i);
  });

  it('recomputes years-to-FI when the current-portfolio assumption is edited, and Reset restores it', async () => {
    const user = userEvent.setup();
    primeStores(); // seeds a positive portfolio + expenses + scenarios
    render(
      <MemoryRouter>
        <FinancialIndependenceCard />
      </MemoryRouter>,
    );
    const before = screen.getByTestId('fi-headline').textContent;

    // Bumping current portfolio way up shortens years-to-FI.
    const pv = screen.getByLabelText(/current portfolio/i) as HTMLInputElement;
    await user.clear(pv);
    await user.type(pv, '5000000');
    const after = screen.getByTestId('fi-headline').textContent;
    expect(after).not.toBe(before);

    // Reset to my data restores the seeded prefill (button appears once dirty).
    await user.click(screen.getByRole('button', { name: /reset to my data/i }));
    expect(
      (screen.getByLabelText(/current portfolio/i) as HTMLInputElement).value,
    ).not.toBe('5000000');
    expect(screen.getByTestId('fi-headline').textContent).toBe(before);
  });

  it('persists an edit under the calc-state:financial-independence key', async () => {
    const user = userEvent.setup();
    primeStores();
    render(
      <MemoryRouter>
        <FinancialIndependenceCard />
      </MemoryRouter>,
    );
    await user.clear(screen.getByLabelText(/annual contribution/i));
    await user.type(screen.getByLabelText(/annual contribution/i), '60000');
    expect(
      JSON.parse(sessionStorage.getItem('calc-state:financial-independence')!),
    ).toMatchObject({
      annualContribution: 60000,
    });
  });

  it('H1/N1: solves on REAL rates — Moderate 6% headline is ~28.5y (not the ~19.8y nominal solve)', () => {
    // pv=$200k, pmt=$24k/yr, target=$1.5M, Moderate=6% nominal.
    // Nominal solve = 19.78y. REAL solve with the fixture's household inflation
    // 3% (resolver precedence: household.inflationAssumption wins over unprimed
    // settings): 6% → (1.06/1.03)−1 = 2.9126% real → 28.55y.
    //   pmt/r = 24000/0.0291262136 = 824_000.0
    //   t = ln((1_500_000 + 824_000)/(200_000 + 824_000)) / ln(1.0291262136)
    //     = ln(2_324_000 / 1_024_000) / ln(1.0291262136)
    //     = ln(2.2695313) / 0.0287101 = 0.8196299 / 0.0287101 = 28.55y
    primeStores({ scenarios: [{ label: 'Moderate', rate: 0.06 }] });
    render(<MemoryRouter><FinancialIndependenceCard /></MemoryRouter>);
    // The headline renders years.toFixed(1) → "28.5 years" (full precision
    // 28.5465 rounds to 28.5 for display).
    expect(screen.getByTestId('fi-headline').textContent).toMatch(/28\.5\s*years/);
    const value = parseFloat(
      screen.getByTestId('fi-headline').textContent!.replace(/[^\d.]/g, ''),
    );
    // Guard against a regression back to the ~19.8y nominal solve.
    expect(value).toBeGreaterThan(22);
  });

  it("H1: renders a 'real (inflation-adjusted) returns — today's dollars' note", () => {
    primeStores();
    render(<MemoryRouter><FinancialIndependenceCard /></MemoryRouter>);
    // "real" is wrapped in <strong>, so match the surrounding text nodes that
    // are not split by the emphasis tag.
    expect(
      screen.getByText(/inflation-adjusted\) returns/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/today's dollars/i)).toBeInTheDocument();
  });

  it('renders the trajectory chart when seeded', () => {
    primeStores();
    render(<MemoryRouter><FinancialIndependenceCard /></MemoryRouter>);
    expect(screen.getByText('Path to FI')).toBeInTheDocument();
  });

  it('renders a Nominal/Real toggle that persists Real under calc-display-mode:financial-independence', async () => {
    const user = userEvent.setup();
    primeStores();
    render(<MemoryRouter><FinancialIndependenceCard /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /^real$/i }));
    expect(sessionStorage.getItem('calc-display-mode:financial-independence')).toBe('REAL');
  });

  it('current-portfolio prefill drops excludedFromNetWorth accounts', () => {
    primeStores({
      snapshotValues: [
        { accountId: 1, snapshotDate: '2026-04-01', totalValue: 200_000 },
        { accountId: 2, snapshotDate: '2026-04-01', totalValue: 50_000 },
      ],
    });
    useAccountsStore.setState({
      accounts: [
        { id: 1, excludedFromNetWorth: false },
        { id: 2, excludedFromNetWorth: true },
      ],
      isLoading: false,
      error: null,
    } as never);
    render(
      <MemoryRouter>
        <FinancialIndependenceCard />
      </MemoryRouter>,
    );
    // Assertion idiom matches the card tests' existing prefill checks
    // (string .value on the number input).
    expect(
      (screen.getByLabelText(/current portfolio/i) as HTMLInputElement).value,
    ).toBe('200000');
  });

  it('prefill is unchanged when the accounts store is not hydrated (excluded-set semantics)', () => {
    primeStores({
      snapshotValues: [
        { accountId: 1, snapshotDate: '2026-04-01', totalValue: 200_000 },
      ],
    });
    // accounts: [] (resetStores) — degrades to no filtering, never to $0.
    render(
      <MemoryRouter>
        <FinancialIndependenceCard />
      </MemoryRouter>,
    );
    expect(
      (screen.getByLabelText(/current portfolio/i) as HTMLInputElement).value,
    ).toBe('200000');
  });
});
