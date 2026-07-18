import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { CompoundInterestCard } from '@/pages/calculators/CompoundInterestCard';
import { ScenarioBar } from '@/pages/calculators/ScenarioBar';
import { __resetScenarioAssumptionsForTests } from '@/lib/calculators/use-scenario-assumptions';
import { SCENARIO_STORAGE_KEY } from '@/lib/calculators/scenario-assumptions';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useHouseholdStore } from '@/stores/household-store';
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
    await waitFor(() => {
      const headlineText = screen.getByTestId('compound-headline').textContent ?? '';
      // Extract the numeric value from the currency string (e.g. "$19,672" → 19672).
      const rendered = Number(headlineText.replace(/[^0-9]/g, ''));
      expect(rendered).toBeGreaterThan(0);
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

  it('renders a Nominal/Real toggle and persists Real under calc-display-mode:compound-interest', async () => {
    const user = userEvent.setup();
    render(<CompoundInterestCard />);
    await user.click(screen.getByRole('button', { name: /^real$/i }));
    expect(sessionStorage.getItem('calc-display-mode:compound-interest')).toBe('REAL');
  });

  it('Real mode deflates the WHOLE card — headline + tiles + title in today\'s dollars', async () => {
    // Wave 15 T5 (D6): the card now resolves inflation via the canonical
    // chain (household → settings → 0.03). Seed settings at the OLD fallback
    // (2.5%) so the pinned dollars below stay byte-identical while the test
    // exercises step 2 of the real chain instead of the removed `?? 0.025`.
    useSettingsStore.setState({
      settings: { defaultInflation: 0.025 } as AppSettings,
      isLoading: false,
      error: null,
    });
    seedDemoScenario(); // W16: pv/pmt/rate ride the shared scenario now
    const user = userEvent.setup();
    render(<CompoundInterestCard />); // pv 1000, pmt 100, 7% APY, 10y monthly, 2.5% inflation
    const headline = screen.getByTestId('compound-headline');
    // Nominal first (byte-identical to prior behaviour) — and no basis suffix.
    expect(headline.textContent).toBe('$19,072');
    expect(headline.textContent).not.toContain("in today's dollars");
    expect(screen.getByTestId('compound-total-contributed').textContent).toContain('Total contributed');
    expect(screen.getByText('Balance over time')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^real$/i }));

    // Headline + tiles now read the deflated (today's-dollars) figures.
    expect(headline.textContent).toContain('$14,899');
    expect(headline.textContent).toContain("in today's dollars");
    expect(screen.getByTestId('compound-total-contributed').textContent).toContain("Total contributed (today's $)");
    expect(screen.getByTestId('compound-total-contributed').textContent).toContain('$11,622');
    // Chart title names the basis.
    expect(screen.getByText("Balance over time (today's dollars)")).toBeInTheDocument();
    expect(screen.queryByText('Balance over time')).not.toBeInTheDocument();
  });

  it('resolves inflation via the canonical chain: household.inflationAssumption beats settings.defaultInflation', async () => {
    const user = userEvent.setup();
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
    await user.click(screen.getByRole('button', { name: /^real$/i }));
    const value = parseFloat(screen.getByTestId('compound-headline').textContent!.replace(/[^0-9.]/g, ''));
    // 5% household inflation deflates HARDER than the 2.5% settings default
    // would ($14,899 at 2.5%) — proving household wins the chain.
    expect(value).toBeLessThan(14899);
  });

  it('collapsed-safe basis: the REAL headline itself says "in today\'s dollars"', async () => {
    const user = userEvent.setup();
    render(<CompoundInterestCard />);
    await user.click(screen.getByRole('button', { name: /^real$/i }));
    expect(screen.getByTestId('compound-headline').textContent).toContain("in today's dollars");
  });
});
