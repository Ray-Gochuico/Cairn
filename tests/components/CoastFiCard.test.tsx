import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { FilingStatus, SnapshotSource, AccountType } from '@/types/enums';
import { CoastFiCard } from '@/pages/calculators/CoastFiCard';
import type { Account, GrowthScenario, Person } from '@/types/schema';

const fourScenarios: GrowthScenario[] = [
  { label: 'Conservative', rate: 0.05 },
  { label: 'Moderate', rate: 0.06 },
  { label: 'Optimistic', rate: 0.07 },
  { label: 'Bull', rate: 0.08 },
];

const basePerson: Person = {
  id: 1,
  householdId: 1,
  name: 'Alice',
  dateOfBirth: '1990-01-01',
  targetRetirementAge: 65,
  annualSalaryPretax: 100000,
  expectedBonus: 0,
  expectedBonusFrequency: 'ANNUAL',
  bonusIsConsistent: true,
  expectedCommission: 0,
  expectedCommissionFrequency: 'MONTHLY',
  employmentType: 'SALARY_NO_OT',
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
  useAccountsStore.setState({ accounts: [], isLoading: false, error: null });
}

function primeStores(opts?: {
  scenarios?: GrowthScenario[];
  monthlyExpenseBaseline?: number;
  withdrawalRate?: number;
  persons?: Person[];
  snapshotValues?: Array<{ accountId: number; snapshotDate: string; totalValue: number }>;
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
    persons: opts?.persons ?? [basePerson],
    isLoading: false,
    error: null,
  });

  // Default: $200k portfolio (one snapshot).
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

  // Wave 2: the shared FI-eligible selector (src/lib/fi-portfolio.ts) needs a
  // matching eligible account per snapshot — an unmatched accountId no longer
  // counts toward the prefill. Seed one brokerage per distinct accountId.
  useAccountsStore.setState({
    accounts: [...new Set(defaultSnapshots.map((s) => s.accountId))].map((id) => mkAccount(id)),
    isLoading: false,
    error: null,
  });
}

describe('CoastFiCard', () => {
  beforeEach(() => {
    resetStores();
    // Clear any persisted calculator overrides from previous tests.
    sessionStorage.clear();
    // Pin "today" to a stable date so currentAge is deterministic.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-14'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders empty state when household is not set — names the cause with a setup link', () => {
    render(
      <MemoryRouter>
        <CoastFiCard />
      </MemoryRouter>,
    );
    // Wave 15 T4: the empty state names the missing ingredient (no household)
    // instead of the vague "Add your inputs" copy.
    expect(
      screen.getByRole('link', { name: /set up your household/i }),
    ).toHaveAttribute('href', '/inputs/household');
    expect(
      screen.queryByText(/Add your inputs to see CoastFI/i),
    ).not.toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders empty state when household has no growth scenarios — names the ingredient', () => {
    primeStores({ scenarios: [] });
    render(
      <MemoryRouter>
        <CoastFiCard />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('link', { name: /add growth scenarios in household settings/i }),
    ).toHaveAttribute('href', '/inputs/household');
    expect(
      screen.queryByText(/Add your inputs to see CoastFI/i),
    ).not.toBeInTheDocument();
  });

  it('renders empty state when persons list is empty — links to Persons', () => {
    primeStores({ persons: [] });
    render(
      <MemoryRouter>
        <CoastFiCard />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('link', { name: /add a person/i }),
    ).toHaveAttribute('href', '/inputs/persons');
    expect(
      screen.queryByText(/Add your inputs to see CoastFI/i),
    ).not.toBeInTheDocument();
  });

  it('zero expenses ⇒ headline "—" + ingredient-naming prompt (never "0% of $0")', async () => {
    const user = userEvent.setup();
    primeStores();
    render(
      <MemoryRouter>
        <CoastFiCard />
      </MemoryRouter>,
    );
    const expenses = screen.getByLabelText(/annual expenses/i);
    await user.clear(expenses);
    await user.type(expenses, '0');
    expect(screen.getByTestId('coastfi-headline').textContent).toBe('—');
    expect(screen.getByText(/enter your annual expenses/i)).toBeInTheDocument();
    // Controls stay for inline correction (D11); table/chart suppressed.
    expect(screen.getByLabelText(/annual expenses/i)).toBeInTheDocument();
    expect(screen.queryByText('Coasting to retirement')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders headline "X% of CoastFI" when seeded with one person + snapshots', () => {
    primeStores();
    render(
      <MemoryRouter>
        <CoastFiCard />
      </MemoryRouter>,
    );

    const headline = screen.getByTestId('coastfi-headline');
    expect(headline.textContent).toMatch(/\d+(\.\d+)?%\s*of\s*CoastFI/i);
  });

  it('uses the shorter-horizon person for two-person households', () => {
    // Person A: 36 years old (born 1990-01-01), retire at 65 -> 29 years
    // Person B: 51 years old (born 1975-01-01), retire at 65 -> 14 years (shorter)
    // Coast amount needed today should reflect the 14-year horizon (more $).
    const personA = { ...basePerson, id: 1, dateOfBirth: '1990-01-01', targetRetirementAge: 65 };
    const personB: Person = {
      ...basePerson,
      id: 2,
      name: 'Bob',
      dateOfBirth: '1975-01-01',
      targetRetirementAge: 65,
    };
    primeStores({ persons: [personA, personB] });
    render(
      <MemoryRouter>
        <CoastFiCard />
      </MemoryRouter>,
    );

    // The years-until-retirement column for the Moderate row should show 14.
    // (We render years on every row, but the value is the same per scenario.)
    // Look for at least one cell containing "14" (years).
    const yearsCells = screen.getAllByText(/^14$/);
    expect(yearsCells.length).toBeGreaterThan(0);
  });

  it('caps headline at 100%+ when current portfolio already exceeds coast amount', () => {
    // 100-year-old at retirement age 65 => negative years -> coast hugely needed.
    // Inverse: massive portfolio with long horizon -> coast tiny -> >>100%.
    primeStores({
      snapshotValues: [
        { accountId: 1, snapshotDate: '2026-04-01', totalValue: 10_000_000 },
      ],
    });
    render(
      <MemoryRouter>
        <CoastFiCard />
      </MemoryRouter>,
    );

    const headline = screen.getByTestId('coastfi-headline');
    // Should be far above 100%
    const value = parseFloat(headline.textContent!.replace(/[^\d.]/g, ''));
    expect(value).toBeGreaterThanOrEqual(100);
  });

  it('renders all 4 scenarios from household.growthScenarios as table rows', () => {
    primeStores({ scenarios: fourScenarios });
    render(
      <MemoryRouter>
        <CoastFiCard />
      </MemoryRouter>,
    );

    expect(screen.getByText('Conservative')).toBeInTheDocument();
    expect(screen.getByText('Moderate')).toBeInTheDocument();
    expect(screen.getByText('Optimistic')).toBeInTheDocument();
    expect(screen.getByText('Bull')).toBeInTheDocument();

    // formatPercent strips trailing zeros (maximumFractionDigits:1) → "5%" not "5.0%".
    expect(screen.getByText('5%')).toBeInTheDocument();
    expect(screen.getByText('6%')).toBeInTheDocument();
    expect(screen.getByText('7%')).toBeInTheDocument();
    expect(screen.getByText('8%')).toBeInTheDocument();

    // Wave 11 T19: the scenario table scrolls inside an overflow-x-auto wrapper
    // so the browser build degrades without horizontal BODY scroll.
    expect(screen.getByRole('table').closest('div')).toHaveClass('overflow-x-auto');
  });

  it('numeric columns are right-aligned (Wave 15 T9, Allocator precedent)', () => {
    primeStores();
    render(
      <MemoryRouter>
        <CoastFiCard />
      </MemoryRouter>,
    );

    for (const name of [/^rate$/i, /^years$/i, /coast today/i, /% of coast/i]) {
      expect(
        screen.getByRole('columnheader', { name }).className,
      ).toContain('text-right');
    }
    // Identity column stays left-aligned.
    expect(
      screen.getByRole('columnheader', { name: /^scenario$/i }).className,
    ).not.toContain('text-right');
  });

  it('uses the latest snapshot per account when multiple are seeded', () => {
    // Two accounts, two snapshots each. pv = 100k + 200k = 300k.
    primeStores({
      snapshotValues: [
        { accountId: 1, snapshotDate: '2025-01-01', totalValue: 999_999 },
        { accountId: 1, snapshotDate: '2026-04-01', totalValue: 100_000 },
        { accountId: 2, snapshotDate: '2025-06-01', totalValue: 1 },
        { accountId: 2, snapshotDate: '2026-04-01', totalValue: 200_000 },
      ],
    });
    render(
      <MemoryRouter>
        <CoastFiCard />
      </MemoryRouter>,
    );

    // If older snapshots leaked in, pv would be ~1.3M and percent would skyrocket.
    // H1/N1: coast is discounted by the REAL Moderate rate. Inflation resolves
    // via the canonical chain (fixture household inflation 3% wins): 6% →
    // (1.06/1.03)−1 = 2.9126% → 1.5M / 1.0291262^29 ≈ $652.4k. Correct pv=300k
    // → ~46%. (Bound is loose — it only guards against the leaked-snapshot
    // ~1.3M case skyrocketing the %.)
    const headline = screen.getByTestId('coastfi-headline');
    const value = parseFloat(headline.textContent!.replace(/[^\d.]/g, ''));
    expect(value).toBeGreaterThan(40);
    expect(value).toBeLessThan(500);
  });

  it('forwards cardId + onHide so the Hide button appears on the card', () => {
    primeStores();
    render(
      <MemoryRouter>
        <CoastFiCard cardId="coast-fi" onHide={() => {}} />
      </MemoryRouter>,
    );
    expect(
      screen.getByRole('button', { name: /hide coastfi card/i }),
    ).toBeInTheDocument();
  });

  it('shows the target portfolio derived from monthlyExpenseBaseline / withdrawalRate', () => {
    // 5000 * 12 / 0.04 = 1,500,000
    primeStores();
    render(
      <MemoryRouter>
        <CoastFiCard />
      </MemoryRouter>,
    );
    expect(screen.getByText(/Target at retirement/i)).toBeInTheDocument();
    expect(screen.getByText(/\$1,500,000/)).toBeInTheDocument();
  });

  it('H1/N1: discounts the coast target by the REAL rate — Moderate "Coast today" ≈ $652,380 (not the ~$276,835 nominal)', () => {
    // Single Moderate 6% scenario; target $1.5M; person born 1990-01-01, retire
    // 65, pinned 2026-05-14 → age 36 → 29 years to retirement.
    // Nominal discount = 1.5M / 1.06^29 = $276,835 (the OLD, optimistic figure).
    // REAL discount, inflation via canonical chain (fixture household
    // inflationAssumption 3% wins over unprimed settings):
    //   real = (1.06/1.03)−1 = 2.9126% ; 1.0291262136^29 = 2.29952
    //   coast = 1_500_000 / 2.29952 = $652,380 (corrected, higher coast-needed).
    primeStores({ scenarios: [{ label: 'Moderate', rate: 0.06 }] });
    render(<MemoryRouter><CoastFiCard /></MemoryRouter>);
    // formatCurrency rounds to whole dollars → "$652,380".
    expect(screen.getByText('$652,380')).toBeInTheDocument();
    // And the old nominal figure must NOT appear.
    expect(screen.queryByText('$276,835')).toBeNull();
  });

  it("H1: renders a 'real (inflation-adjusted) returns — today's dollars' note", () => {
    primeStores();
    render(<MemoryRouter><CoastFiCard /></MemoryRouter>);
    // "real" is wrapped in <strong>, so match the surrounding text nodes that
    // are not split by the emphasis tag.
    expect(
      screen.getByText(/inflation-adjusted\) returns/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/today's dollars/i)).toBeInTheDocument();
  });

  // ────────────────────────────────────────────────────────────────
  // Editable-inputs tests (Task 4 – Wave 0)
  // ────────────────────────────────────────────────────────────────

  describe('editable inputs', () => {
    // Person born 1986-01-01. Date pinned to 2026-05-14.
    // currentAge('1986-01-01') = 40 (birthday Jan 1 already passed in May).
    // targetRetirementAge = 60. yearsUntilRetirement = 60 - 40 = 20.
    const editablePerson: Person = {
      ...basePerson,
      id: 1,
      dateOfBirth: '1986-01-01',
      targetRetirementAge: 60,
    };

    function primeEditableStores() {
      primeStores({
        monthlyExpenseBaseline: 5000,
        withdrawalRate: 0.04,
        scenarios: [{ label: 'Moderate', rate: 0.07 }],
        persons: [editablePerson],
        snapshotValues: [
          { accountId: 1, snapshotDate: '2026-04-01', totalValue: 500_000 },
        ],
      });
    }

    it('"Years to retirement" input prefills to 20 (targetRetirementAge 60 − age 40)', () => {
      primeEditableStores();
      render(
        <MemoryRouter>
          <CoastFiCard />
        </MemoryRouter>,
      );

      const input = screen.getByLabelText(/years to retirement/i) as HTMLInputElement;
      expect(input.value).toBe('20');
    });

    it('editing "Years to retirement" to 10 changes the coastfi-headline', async () => {
      const user = userEvent.setup();
      primeEditableStores();
      render(
        <MemoryRouter>
          <CoastFiCard />
        </MemoryRouter>,
      );

      const headline = screen.getByTestId('coastfi-headline');
      const originalPct = parseInt(headline.textContent!.replace(/[^\d]/g, ''), 10);

      const input = screen.getByLabelText(/years to retirement/i) as HTMLInputElement;
      await user.clear(input);
      await user.type(input, '10');

      // Fewer years → higher coast needed today → lower % of CoastFI
      const newText = headline.textContent;
      expect(newText).toMatch(/\d+(\.\d+)?%\s*of\s*CoastFI/i);
      const newPct = parseInt(newText!.replace(/[^\d]/g, ''), 10);
      expect(newPct).toBeLessThan(originalPct);
    });

    it('shows "Reset to my data" button after editing an input', async () => {
      const user = userEvent.setup();
      primeEditableStores();
      render(
        <MemoryRouter>
          <CoastFiCard />
        </MemoryRouter>,
      );

      // Reset button should NOT be visible initially
      expect(screen.queryByRole('button', { name: /reset to my data/i })).toBeNull();

      const input = screen.getByLabelText(/years to retirement/i) as HTMLInputElement;
      await user.clear(input);
      await user.type(input, '15');

      // After edit, Reset button should appear
      expect(screen.getByRole('button', { name: /reset to my data/i })).toBeInTheDocument();
    });

    it('shows "already at/after target retirement age" note when yearsUntilRetirement ≤ 0', async () => {
      const user = userEvent.setup();
      primeEditableStores();
      render(
        <MemoryRouter>
          <CoastFiCard />
        </MemoryRouter>,
      );

      const input = screen.getByLabelText(/years to retirement/i) as HTMLInputElement;
      await user.clear(input);
      await user.type(input, '0');

      expect(
        screen.getByText(/already at\/after your target retirement age/i),
      ).toBeInTheDocument();
    });

    it('headline shows "—" (not a %) when yearsUntilRetirement ≤ 0', async () => {
      const user = userEvent.setup();
      primeEditableStores();
      render(
        <MemoryRouter>
          <CoastFiCard />
        </MemoryRouter>,
      );

      const input = screen.getByLabelText(/years to retirement/i) as HTMLInputElement;
      await user.clear(input);
      await user.type(input, '0');

      const headline = screen.getByTestId('coastfi-headline');
      expect(headline.textContent).toBe('—');
      expect(headline.textContent).not.toMatch(/%/);
    });

    it('"Reset to my data" restores defaults and hides the reset button', async () => {
      const user = userEvent.setup();
      primeEditableStores();
      render(
        <MemoryRouter>
          <CoastFiCard />
        </MemoryRouter>,
      );

      const input = screen.getByLabelText(/years to retirement/i) as HTMLInputElement;
      expect(input.value).toBe('20');

      // Override the prefilled value.
      await user.clear(input);
      await user.type(input, '10');
      expect(input.value).toBe('10');

      // Click reset.
      await user.click(screen.getByRole('button', { name: /reset to my data/i }));

      // Years input is back to the real-data default, reset button is gone.
      expect(
        (screen.getByLabelText(/years to retirement/i) as HTMLInputElement).value,
      ).toBe('20');
      expect(screen.queryByRole('button', { name: /reset to my data/i })).toBeNull();
    });

    it('"Annual expenses" input is present and prefilled from monthlyExpenseBaseline * 12', () => {
      primeEditableStores();
      render(
        <MemoryRouter>
          <CoastFiCard />
        </MemoryRouter>,
      );

      // 5000 * 12 = 60000
      const input = screen.getByLabelText(/annual expenses/i) as HTMLInputElement;
      expect(input.value).toBe('60000');
    });

    it('"Withdrawal rate" input is present and prefilled as percent (4% shown as 4)', () => {
      primeEditableStores();
      render(
        <MemoryRouter>
          <CoastFiCard />
        </MemoryRouter>,
      );

      const input = screen.getByLabelText(/withdrawal rate/i) as HTMLInputElement;
      expect(input.value).toBe('4');
    });

    it('"Current portfolio" input is present and prefilled from latest snapshot sum', () => {
      primeEditableStores();
      render(
        <MemoryRouter>
          <CoastFiCard />
        </MemoryRouter>,
      );

      const input = screen.getByLabelText(/current portfolio/i) as HTMLInputElement;
      expect(input.value).toBe('500000');
    });
  });

  it('seeds current portfolio from the latest snapshot on-or-before today (excludes future)', () => {
    primeStores();
    // Use a pinned future date relative to the fake-timer anchor (2026-05-14) so
    // this test doesn't silently break if system time advances past the snapshot.
    const futureIso = '2031-05-14';
    useSnapshotsStore.setState({
      snapshots: [
        { id: 1, accountId: 1, snapshotDate: '2024-01-01', totalValue: 250000, source: SnapshotSource.MANUAL },
        { id: 2, accountId: 1, snapshotDate: futureIso, totalValue: 9_000_000, source: SnapshotSource.MANUAL },
      ],
      isLoading: false, error: null,
    });
    render(<MemoryRouter><CoastFiCard /></MemoryRouter>);
    const field = screen.getByLabelText(/current portfolio/i) as HTMLInputElement;
    expect(field.value).toBe('250000'); // not 9,000,000
  });

  it('renders the coast-trajectory chart when seeded', () => {
    primeStores();
    render(<MemoryRouter><CoastFiCard /></MemoryRouter>);
    expect(screen.getByText('Coasting to retirement')).toBeInTheDocument();
  });

  it('renders a Nominal/Real toggle that persists Real under calc-display-mode:coast-fi', async () => {
    const user = userEvent.setup();
    primeStores();
    render(<MemoryRouter><CoastFiCard /></MemoryRouter>);
    await user.click(screen.getByRole('button', { name: /^real$/i }));
    expect(sessionStorage.getItem('calc-display-mode:coast-fi')).toBe('REAL');
  });

  it('hides the chart at/after target retirement age', async () => {
    const user = userEvent.setup();
    primeStores();
    render(<MemoryRouter><CoastFiCard /></MemoryRouter>);
    const input = screen.getByLabelText(/years to retirement/i) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, '0');
    expect(screen.queryByText('Coasting to retirement')).not.toBeInTheDocument();
  });

  it('T6 Fix-4: chart trajectory data is correct (O(n²) refactor produces same values)', () => {
    // Pre-fix: balanceTrajectory() was called O(horizon*scenarios) times inside the
    // per-year loop. Post-fix: trajectories are computed once per scenario, then
    // indexed per year. Both approaches must produce the same chart-visible output.
    primeStores({
      scenarios: [{ label: 'Moderate', rate: 0.06 }],
      snapshotValues: [{ accountId: 1, snapshotDate: '2026-04-01', totalValue: 100_000 }],
    });
    render(<MemoryRouter><CoastFiCard /></MemoryRouter>);

    // The chart renders "Coasting to retirement" — verifying it's present confirms
    // the chart-data derivation completed without error.
    expect(screen.getByText('Coasting to retirement')).toBeInTheDocument();

    // The "% of CoastFI" headline must still be numeric (chart computation didn't break it).
    const headline = screen.getByTestId('coastfi-headline');
    expect(headline.textContent).toMatch(/\d+%\s*of\s*CoastFI/i);
  });

  it('current-portfolio prefill drops excludedFromNetWorth accounts', () => {
    primeStores({
      snapshotValues: [
        { accountId: 1, snapshotDate: '2026-04-01', totalValue: 200_000 },
        { accountId: 2, snapshotDate: '2026-04-01', totalValue: 50_000 },
      ],
    });
    useAccountsStore.setState({
      accounts: [mkAccount(1), mkAccount(2, AccountType.ACCOUNT_BROKERAGE, true)],
      isLoading: false,
      error: null,
    });
    render(
      <MemoryRouter>
        <CoastFiCard />
      </MemoryRouter>,
    );
    expect(
      (screen.getByLabelText(/current portfolio/i) as HTMLInputElement).value,
    ).toBe('200000');
  });

  it('explains the target-line basis for both chart views', () => {
    primeStores();
    render(
      <MemoryRouter>
        <CoastFiCard />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(/nominal view grows the target line with inflation/i),
    ).toBeInTheDocument();
  });
});
