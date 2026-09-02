import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { CompoundInterestCard } from '@/pages/calculators/CompoundInterestCard';
import { ScenarioBar } from '@/pages/calculators/ScenarioBar';
import { __resetScenarioAssumptionsForTests } from '@/lib/calculators/use-scenario-assumptions';
import {
  CALCULATORS_PAGE_ID,
  __resetDollarBasisForTests,
  useDollarBasisStore,
} from '@/lib/calculators/dollar-basis';
import { SCENARIO_STORAGE_KEY } from '@/lib/calculators/scenario-assumptions';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useContributionsStore } from '@/stores/contributions-store';
import { syncCalcScope, __resetCalcScopeForTests } from '@/lib/calculators/calc-view-scope';
import { makePerson } from '../factories';
import { SnapshotSource, AccountType, FilingStatus } from '@/types/enums';
import type { Account, AppSettings } from '@/types/schema';

/** Seed shared-scenario overrides BEFORE render (the hook rehydrates them) —
 *  the pre-W16 demo numbers (pv 1000, pmt 100/mo, 7% APY) so the pinned
 *  dollar expectations below stay byte-identical. */
function seedDemoScenario() {
  sessionStorage.setItem(
    SCENARIO_STORAGE_KEY,
    JSON.stringify({ portfolio: 1000, annualContribution: 1200, returnPct: 7 }),
  );
}

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

describe('CompoundInterestCard', () => {
  beforeEach(() => {
    sessionStorage.clear();
    __resetDollarBasisForTests();
    // Wave 16: the shared-scenario module caches overrides at module level.
    __resetScenarioAssumptionsForTests();
    useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null });
    useAccountsStore.setState({ accounts: [], isLoading: false, error: null });
    // Wave 15 T5: the card now reads the canonical inflation chain — reset
    // both inputs so each test controls its own precedence step.
    useSettingsStore.setState({ settings: null, isLoading: false, error: null });
    useHouseholdStore.setState({ household: null, isLoading: false, error: null });
  });

  it('persists the local what-if inputs (years) via the kit — silo keeps ONLY locals (W16)', async () => {
    const user = userEvent.setup();
    render(<CompoundInterestCard />); // local fields read no router
    const yearsInput = screen.getByLabelText(/length \(years\)/i) as HTMLInputElement;
    await user.clear(yearsInput);
    await user.type(yearsInput, '25');
    expect(JSON.parse(sessionStorage.getItem('calc-state:compound-interest')!)).toMatchObject({
      years: 25,
    });
  });

  it('W16: a bar Portfolio edit persists under calc-scenario:shared, not the card silo', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ScenarioBar /><CompoundInterestCard /></MemoryRouter>);
    const pvInput = screen.getByLabelText('Portfolio') as HTMLInputElement;
    await user.clear(pvInput);
    await user.type(pvInput, '25000');
    await waitFor(() =>
      expect(JSON.parse(sessionStorage.getItem(SCENARIO_STORAGE_KEY)!)).toMatchObject({
        portfolio: 25000,
      }),
    );
    expect(sessionStorage.getItem('calc-state:compound-interest')).toBeNull();
  });

  it('empty profile shows an honest $0 projection (demo fallback removed — bar and card must agree, W16 D4)', () => {
    render(<MemoryRouter><ScenarioBar /><CompoundInterestCard /></MemoryRouter>);
    // No snapshots → the bar honestly shows $0 with its provenance caption…
    expect((screen.getByLabelText('Portfolio') as HTMLInputElement).value).toBe('0');
    expect(screen.getByText('no account snapshots yet')).toBeInTheDocument();
    // …and the card can no longer contradict it with a phantom $1,000.
    expect(screen.getByTestId('compound-headline').textContent).toContain('$0');
  });

  it('updates the headline when the bar Portfolio changes (W16)', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ScenarioBar /><CompoundInterestCard /></MemoryRouter>);
    const before = screen.getByTestId('compound-headline').textContent;
    const pvInput = screen.getByLabelText('Portfolio') as HTMLInputElement;
    await user.clear(pvInput);
    await user.type(pvInput, '10000');
    // Bigger PV → bigger final (commit trails ~150ms behind typing).
    await waitFor(() =>
      expect(screen.getByTestId('compound-headline').textContent).not.toBe(before),
    );
  });

  it('switches frequency to ANNUALLY and the headline actually changes', async () => {
    seedDemoScenario(); // non-zero pv/pmt/rate so compounding frequency can move the figure
    const user = userEvent.setup();
    render(<CompoundInterestCard />);
    const headline = screen.getByTestId('compound-headline');
    const before = headline.textContent;
    await user.click(screen.getByRole('combobox', { name: /compound frequency/i }));
    await user.click(await screen.findByRole('option', { name: /annually/i }));
    // Annual compounding is less than monthly at the same APY-derived APR —
    // the value must move, not merely stay a dollar string.
    expect(headline.textContent).not.toBe(before);
  });

  it('shows placeholder when years is 0 or empty', async () => {
    const user = userEvent.setup();
    render(<CompoundInterestCard />);
    const yearsInput = screen.getByLabelText(/length \(years\)/i) as HTMLInputElement;
    await user.clear(yearsInput);
    expect(screen.getByText(/enter a length in years/i)).toBeInTheDocument();
  });

  it('W16: the rate rides the bar Return field; the card renders no APY/pv/pmt inputs', () => {
    render(<MemoryRouter><ScenarioBar /><CompoundInterestCard /></MemoryRouter>);
    // The bar's Return field is the one rate input (read as APY by this card, D4).
    expect(screen.getByLabelText('Return')).toBeInTheDocument();
    // The card's old ci-rate/ci-pv/ci-pmt inputs are gone.
    expect(screen.queryByLabelText(/annual percentage yield/i)).toBeNull();
    expect(screen.queryByLabelText(/initial amount/i)).toBeNull();
    expect(screen.queryByLabelText(/monthly contribution/i)).toBeNull();
  });

  it('bar Return field clamps at 0 — negative rate cannot be entered (min-clamp preserved)', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ScenarioBar /><CompoundInterestCard /></MemoryRouter>);
    const apyInput = screen.getByLabelText('Return') as HTMLInputElement;
    await user.clear(apyInput);
    await user.type(apyInput, '-5');
    // NumberField's min=0 clamp: on blur/change the value is Math.max(0, -5) = 0.
    // The input should not hold a value below 0 after the change fires.
    expect(Number(apyInput.value)).toBeGreaterThanOrEqual(0);
  });

  it('annual compounding @ 7% input yields ~1.07^N * PV (APY semantics, no compounding amplification)', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><ScenarioBar /><CompoundInterestCard /></MemoryRouter>);
    // PV=1000 (bar), PMT=0 (empty stores default), 10y, 7% (bar Return), ANNUAL
    // compounding. With APY=7% the final balance is exactly 1000 * 1.07^10 =
    // $1967.15 — the SAME numeric expectation as pre-W16; only the input moved
    // to the bar (the card's APY→APR boundary is untouched).
    await user.clear(screen.getByLabelText('Portfolio'));
    await user.type(screen.getByLabelText('Portfolio'), '1000');
    await user.clear(screen.getByLabelText('Return'));
    await user.type(screen.getByLabelText('Return'), '7');
    await user.click(screen.getByRole('combobox', { name: /compound frequency/i }));
    await user.click(await screen.findByRole('option', { name: /annually/i }));
    // W5 (D-T3/F2): the page default is now Today's $, which deflates. This
    // test's subject is the NOMINAL engine's APY semantics, so read the
    // headline in Future $ — the unchanged engine leg (D-T10).
    await user.click(screen.getByRole('button', { name: 'Future $' }));
    // Match $1,9XX (any value between 1900 and 1999).
    await waitFor(() =>
      expect(screen.getByTestId('compound-headline').textContent).toMatch(/\$1,9\d{2}/),
    );
  });

  it('monthly compounding @ 7% APY yields a SMALLER final than 7% APR would (APY<APR semantic check)', async () => {
    // APR-direct 7% monthly for 10y on $10k: 10000 * (1 + 0.07/12)^120 ≈ $20,097.
    // APY=7% → per-period rate (1.07^(1/12)-1) ≈ 0.565%, yielding 1.07^10 * 10000 ≈ $19,672.
    // Assert the rendered APY figure is strictly less than the APR-direct value ($20,096).
    const APR_DIRECT_VALUE = 20096; // floor of 10000 * (1+0.07/12)^120
    const user = userEvent.setup();
    render(<MemoryRouter><ScenarioBar /><CompoundInterestCard /></MemoryRouter>);
    await user.clear(screen.getByLabelText('Portfolio'));
    await user.type(screen.getByLabelText('Portfolio'), '10000');
    await user.clear(screen.getByLabelText('Return'));
    await user.type(screen.getByLabelText('Return'), '7');
    // W5 (D-T3/F2): read the NOMINAL leg — this is an engine-semantics check,
    // and against the deflated Today's $ figure the bound would pass trivially.
    await user.click(screen.getByRole('button', { name: 'Future $' }));
    await waitFor(() => {
      const headlineText = screen.getByTestId('compound-headline').textContent ?? '';
      // Extract the FIGURE only (e.g. "$19,672" → 19672) — the basis phrase
      // beside it carries the inflation percent's digits (W5 D-T4).
      const rendered = Number((headlineText.match(/\$[\d,]+/)?.[0] ?? '').replace(/[$,]/g, ''));
      // Bracket the NOMINAL leg from BOTH sides. The old `> 0` floor let a
      // Today's-$ (real) rendering — 19,672/1.03^10 ≈ $14,637 at this
      // fixture's fallback inflation — satisfy an assertion that claims to
      // read the nominal one; $19,000 sits above every real rendering and
      // below the APY figure (≈ $19,672).
      expect(rendered).toBeGreaterThan(19_000);
      expect(rendered).toBeLessThan(APR_DIRECT_VALUE);
    });
  });

  it('prefills the shared portfolio from the latest snapshot (surfaces in the bar — W16)', () => {
    useSnapshotsStore.setState({
      snapshots: [
        { id: 1, accountId: 1, snapshotDate: '2026-04-01', totalValue: 250000, source: SnapshotSource.MANUAL },
      ],
      isLoading: false, error: null,
    });
    // Wave 2: the FI-eligible selector needs a matching eligible account.
    useAccountsStore.setState({ accounts: [mkAccount(1)], isLoading: false, error: null });
    render(<MemoryRouter><ScenarioBar /><CompoundInterestCard /></MemoryRouter>);
    expect((screen.getByLabelText('Portfolio') as HTMLInputElement).value).toBe('250000');
  });

  it('shared-portfolio prefill drops excludedFromNetWorth accounts (W16)', () => {
    useSnapshotsStore.setState({
      snapshots: [
        { id: 1, accountId: 1, snapshotDate: '2026-04-01', totalValue: 250_000, source: SnapshotSource.MANUAL },
        { id: 2, accountId: 2, snapshotDate: '2026-04-01', totalValue: 99_000, source: SnapshotSource.MANUAL },
      ],
      isLoading: false,
      error: null,
    });
    useAccountsStore.setState({
      accounts: [mkAccount(1), mkAccount(2, AccountType.ACCOUNT_BROKERAGE, true)],
      isLoading: false,
      error: null,
    });
    render(<MemoryRouter><ScenarioBar /><CompoundInterestCard /></MemoryRouter>);
    expect(
      (screen.getByLabelText('Portfolio') as HTMLInputElement).value,
    ).toBe('250000');
  });

  it('W5: no per-card toggle remains; the card follows the page basis store (D-T9)', () => {
    useSettingsStore.setState({
      settings: { defaultInflation: 0.025 } as AppSettings,
      isLoading: false,
      error: null,
    });
    seedDemoScenario();
    render(<CompoundInterestCard />);
    expect(screen.queryByRole('button', { name: /^real$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^nominal$/i })).toBeNull();
    act(() => useDollarBasisStore.getState().setBasis(CALCULATORS_PAGE_ID, 'future'));
    expect(screen.getByTestId('compound-headline').textContent).toContain('$19,072');
  });

  it("W5 ANCHOR PAIR: Today's $ (default) pins real + anti-pins nominal; Future $ inverts (D-T6)", () => {
    // Seed settings at 2.5% so the house literals stay byte-identical
    // ($19,072 nominal / $14,899 real / $11,622 per-period-real contributed).
    useSettingsStore.setState({
      settings: { defaultInflation: 0.025 } as AppSettings,
      isLoading: false,
      error: null,
    });
    seedDemoScenario();
    render(<CompoundInterestCard />);
    const headline = screen.getByTestId('compound-headline');
    const contributed = screen.getByTestId('compound-total-contributed');

    // ── Today's $ IS the default (D-T3 — the deliberate flip from NOMINAL) ──
    expect(headline.textContent).toContain('$14,899');
    expect(headline.textContent).not.toContain('$19,072'); // nominal anti-pin
    expect(headline.textContent).toContain("in today's dollars");
    expect(contributed.textContent).toContain('$11,622'); // per-period deflation
    expect(contributed.textContent).not.toContain('$13,000'); // nominal anti-pin
    expect(contributed.textContent).not.toContain('$10,155'); // horizon-deflated WRONG value
    expect(contributed.textContent).toContain("(today's $)");
    expect(screen.getByTestId('compound-final-balance').textContent).toContain('$14,899');
    expect(screen.getByTestId('compound-chart-caption').textContent).toBe(
      "Balance over time (today's $)",
    );

    // ── Flip the PAGE basis (the control lives in the ScenarioBar) ──
    act(() => useDollarBasisStore.getState().setBasis(CALCULATORS_PAGE_ID, 'future'));

    expect(headline.textContent).toContain('$19,072');
    expect(headline.textContent).not.toContain('$14,899'); // real anti-pin
    expect(headline.textContent).toContain('in future dollars, at your 2.5% inflation assumption');
    expect(contributed.textContent).toContain('$13,000');
    expect(contributed.textContent).not.toContain('$11,622');
    expect(contributed.textContent).toContain('(future $)');
    expect(screen.getByTestId('compound-chart-caption').textContent).toBe(
      'Balance over time (future $)',
    );
  });

  it('W5 phrase/math consistency pin: one resolver feeds the phrase AND the deflator', () => {
    useHouseholdStore.setState({
      household: {
        filingStatus: FilingStatus.SINGLE,
        state: 'CA',
        city: null,
        monthlyExpenseBaseline: 5000,
        withdrawalRate: 0.04,
        inflationAssumption: 0.024,
        growthScenarios: [],
      },
      isLoading: false,
      error: null,
    });
    seedDemoScenario();
    render(<CompoundInterestCard />);
    const dollars = (el: HTMLElement) =>
      Number((el.textContent?.match(/\$[\d,]+/)?.[0] ?? '').replace(/[$,]/g, ''));
    const headline = screen.getByTestId('compound-headline');
    const today = dollars(headline);
    expect(headline.textContent).toContain("in today's dollars");
    act(() => useDollarBasisStore.getState().setBasis(CALCULATORS_PAGE_ID, 'future'));
    expect(headline.textContent).toContain('at your 2.4% inflation assumption');
    // The 2.4% in the phrase IS the deflator: ratio = 1.024^10 (whole-$ rounding).
    expect(dollars(headline) / today).toBeCloseTo(Math.pow(1.024, 10), 3);
  });

  it('W5 zero-inflation edge (F11): bases identical; the edge phrase says so', () => {
    sessionStorage.setItem(
      SCENARIO_STORAGE_KEY,
      JSON.stringify({ portfolio: 1000, annualContribution: 1200, returnPct: 7, inflationPct: 0 }),
    );
    render(<CompoundInterestCard />);
    const headline = screen.getByTestId('compound-headline');
    const todayFigure = headline.textContent?.match(/\$[\d,]+/)?.[0];
    act(() => useDollarBasisStore.getState().setBasis(CALCULATORS_PAGE_ID, 'future'));
    expect(headline.textContent).toContain(todayFigure!);
    expect(headline.textContent).toContain(
      "in future dollars — at your 0% inflation assumption these equal today's dollars",
    );
  });

  it('resolves inflation via the canonical chain: household.inflationAssumption beats settings.defaultInflation', () => {
    seedDemoScenario(); // W16: non-zero pv/pmt so the deflation is observable
    useSettingsStore.setState({
      settings: { defaultInflation: 0.025 } as AppSettings,
      isLoading: false,
      error: null,
    });
    useHouseholdStore.setState({
      household: {
        filingStatus: FilingStatus.SINGLE,
        state: 'CA',
        city: null,
        monthlyExpenseBaseline: 0,
        withdrawalRate: 0.04,
        inflationAssumption: 0.05,
        growthScenarios: [],
      },
      isLoading: false,
      error: null,
    });
    render(<CompoundInterestCard />);
    const value = parseFloat(screen.getByTestId('compound-headline').textContent!.replace(/[^0-9.]/g, ''));
    // 5% household inflation deflates HARDER than the 2.5% settings default
    // would ($14,899 at 2.5%) — proving household wins the chain.
    expect(value).toBeLessThan(14899);
  });

  it('collapsed-safe basis: the default headline itself says "in today\'s dollars"', () => {
    render(<CompoundInterestCard />);
    expect(screen.getByTestId('compound-headline').textContent).toContain("in today's dollars");
  });
});

describe('CompoundInterestCard waymark meaning (Wave 17)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    __resetDollarBasisForTests();
    __resetScenarioAssumptionsForTests();
  });

  it('renders the waymark meaning line from already-rendered values (Wave 17)', () => {
    // Wave C N3: a $0 portfolio now invites instead of asserting — seed the
    // demo scenario so this test keeps exercising the value-bearing sentence.
    seedDemoScenario();
    render(<MemoryRouter><CompoundInterestCard cardId="compound-interest" /></MemoryRouter>);
    expect(screen.getByTestId('compound-interest-meaning')).toHaveTextContent(
      /at .*% APY for \d+ years\./i,
    );
  });

  it('Wave C N3: a $0 portfolio invites instead of asserting "$0 at 6% APY"', () => {
    // Nothing primed → the bar portfolio resolves 0 (empty profile).
    render(<MemoryRouter><CompoundInterestCard cardId="compound-interest" /></MemoryRouter>);
    expect(screen.getByTestId('compound-interest-meaning')).toHaveTextContent(
      'Enter a starting portfolio in the scenario bar to see growth.',
    );
  });

  it('years 0 replaces the meaning with the enter-a-length prompt (the empty case)', async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><CompoundInterestCard cardId="compound-interest" /></MemoryRouter>);
    await user.clear(screen.getByLabelText(/length \(years\)/i));
    await user.type(screen.getByLabelText(/length \(years\)/i), '0');
    const meaning = screen.getByTestId('compound-interest-meaning');
    expect(meaning).toHaveTextContent(/enter a length in years to see projected growth/i);
    expect(meaning).not.toHaveTextContent(/% APY for/i);
  });
});

describe('CompoundInterestCard — person scope (Wave B)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    __resetDollarBasisForTests();
    __resetScenarioAssumptionsForTests();
    __resetCalcScopeForTests();
    useSettingsStore.setState({ settings: null, isLoading: false, error: null });
    useHouseholdStore.setState({ household: null, isLoading: false, error: null });
    useContributionsStore.setState({ contributions: [], isLoading: false, error: null } as never);
    usePersonsStore.setState({
      persons: [makePerson({ id: 1, name: 'Alice' }), makePerson({ id: 2, name: 'Bob' })],
      isLoading: false,
      error: null,
    } as never);
    // Bob owns account 2 ($40k); account 3 is joint ($8k).
    useAccountsStore.setState({
      accounts: [
        { ...mkAccount(2), ownerPersonId: 2 },
        mkAccount(3),
      ],
      isLoading: false,
      error: null,
    });
    useSnapshotsStore.setState({
      snapshots: [
        { id: 1, accountId: 2, snapshotDate: '2026-07-01', totalValue: 40_000, source: 'MANUAL', notes: null },
        { id: 2, accountId: 3, snapshotDate: '2026-07-01', totalValue: 8_000, source: 'MANUAL', notes: null },
      ],
      isLoading: false,
      error: null,
    } as never);
  });

  it('Wave B CB14: person scope qualifies the meaning with the owner and re-scopes pv via the bar', () => {
    syncCalcScope(2);
    render(
      <MemoryRouter initialEntries={['/calculators?view=p2']}>
        <CompoundInterestCard cardId="compound-interest" />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('compound-interest-meaning')).toHaveTextContent(
      "$40,000 in Bob's accounts at",
    );
  });

  it('Wave B: household scope keeps the unqualified meaning', () => {
    render(
      <MemoryRouter>
        <CompoundInterestCard cardId="compound-interest" />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('compound-interest-meaning')).toHaveTextContent('$48,000 at');
    expect(screen.getByTestId('compound-interest-meaning')).not.toHaveTextContent('accounts at');
  });
});
