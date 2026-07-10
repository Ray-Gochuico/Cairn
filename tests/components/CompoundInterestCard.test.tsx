import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CompoundInterestCard } from '@/pages/calculators/CompoundInterestCard';
import { useSnapshotsStore } from '@/stores/snapshots-store';
import { useAccountsStore } from '@/stores/accounts-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useHouseholdStore } from '@/stores/household-store';
import { SnapshotSource, AccountType } from '@/types/enums';
import type { Account, AppSettings, Household } from '@/types/schema';

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
    useSnapshotsStore.setState({ snapshots: [], isLoading: false, error: null });
    useAccountsStore.setState({ accounts: [], isLoading: false, error: null });
    // Wave 15 T5: the card now reads the canonical inflation chain — reset
    // both inputs so each test controls its own precedence step.
    useSettingsStore.setState({ settings: null, isLoading: false, error: null });
    useHouseholdStore.setState({ household: null, isLoading: false, error: null });
  });

  it('persists the what-if inputs via the kit', async () => {
    const user = userEvent.setup();
    render(<CompoundInterestCard />); // reads no stores/router
    const pvInput = screen.getByLabelText(/initial amount/i) as HTMLInputElement;
    await user.clear(pvInput);
    await user.type(pvInput, '25000');
    expect(JSON.parse(sessionStorage.getItem('calc-state:compound-interest')!)).toMatchObject({
      pv: 25000,
    });
  });

  it('renders defaults with a non-zero headline (PV=1000, PMT=100, 7%, 10y, monthly)', () => {
    render(<CompoundInterestCard />);
    const headline = screen.getByTestId('compound-headline');
    // PV=1000 + PMT=100/mo × 7% × 10y monthly compounding → final mid ≈ $19,290
    expect(headline.textContent).toMatch(/\$1[89],\d{3}/);
  });

  it('updates the headline when initial amount changes', async () => {
    const user = userEvent.setup();
    render(<CompoundInterestCard />);
    const pvInput = screen.getByLabelText(/initial amount/i) as HTMLInputElement;
    await user.clear(pvInput);
    await user.type(pvInput, '10000');
    const headline = screen.getByTestId('compound-headline');
    // Bigger PV → bigger final
    expect(headline.textContent).not.toMatch(/^\$1[89],\d{3}/);
  });

  it('switches frequency to ANNUALLY and the headline actually changes', async () => {
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

  it('labels the rate input as APY (Wave-3 Task 5)', () => {
    render(<CompoundInterestCard />);
    // The label uses a TermTooltip "APY" — NumberField carries ariaLabel="Annual percentage yield"
    // so the spinbutton has a flat string accessible name (the TermTooltip button is non-string).
    expect(screen.getByLabelText(/annual percentage yield/i)).toBeInTheDocument();
  });

  it('APY field clamps at 0 — negative rate cannot be entered (min-clamp gap closed)', async () => {
    const user = userEvent.setup();
    render(<CompoundInterestCard />);
    const apyInput = screen.getByLabelText(/annual percentage yield/i) as HTMLInputElement;
    await user.clear(apyInput);
    await user.type(apyInput, '-5');
    // NumberField's min=0 clamp: on blur/change the value is Math.max(0, -5) = 0.
    // The input should not hold a value below 0 after the change fires.
    expect(Number(apyInput.value)).toBeGreaterThanOrEqual(0);
  });

  it('annual compounding @ 7% input yields ~1.07^N * PV (APY semantics, no compounding amplification)', async () => {
    const user = userEvent.setup();
    render(<CompoundInterestCard />);
    // PV=1000, PMT=0, 10y, 7%, ANNUAL compounding. With APY=7% the final
    // balance should be exactly 1000 * 1.07^10 = $1967.15.
    // Pre-fix (APR semantics): 1000 * (1+0.07/1)^10 = 1967.15 (matches at annual).
    // The test below using monthly checks the case where APY/APR diverge.
    await user.clear(screen.getByLabelText(/initial amount/i));
    await user.type(screen.getByLabelText(/initial amount/i), '1000');
    await user.clear(screen.getByLabelText(/monthly contribution/i));
    await user.type(screen.getByLabelText(/monthly contribution/i), '0');
    await user.click(screen.getByRole('combobox', { name: /compound frequency/i }));
    await user.click(await screen.findByRole('option', { name: /annually/i }));
    const headline = screen.getByTestId('compound-headline');
    // Match $1,9XX (any value between 1900 and 1999).
    expect(headline.textContent).toMatch(/\$1,9\d{2}/);
  });

  it('monthly compounding @ 7% APY yields a SMALLER final than 7% APR would (APY<APR semantic check)', async () => {
    // APR-direct 7% monthly for 10y on $10k: 10000 * (1 + 0.07/12)^120 ≈ $20,097.
    // APY=7% → per-period rate (1.07^(1/12)-1) ≈ 0.565%, yielding 1.07^10 * 10000 ≈ $19,672.
    // Assert the rendered APY figure is strictly less than the APR-direct value ($20,096).
    const APR_DIRECT_VALUE = 20096; // floor of 10000 * (1+0.07/12)^120
    const user = userEvent.setup();
    render(<CompoundInterestCard />);
    await user.clear(screen.getByLabelText(/initial amount/i));
    await user.type(screen.getByLabelText(/initial amount/i), '10000');
    await user.clear(screen.getByLabelText(/monthly contribution/i));
    await user.type(screen.getByLabelText(/monthly contribution/i), '0');
    const headlineText = screen.getByTestId('compound-headline').textContent ?? '';
    // Extract the numeric value from the currency string (e.g. "$19,672" → 19672).
    const rendered = Number(headlineText.replace(/[^0-9]/g, ''));
    expect(rendered).toBeGreaterThan(0);
    expect(rendered).toBeLessThan(APR_DIRECT_VALUE);
  });

  it('prefills the initial amount from the latest portfolio snapshot', () => {
    useSnapshotsStore.setState({
      snapshots: [
        { id: 1, accountId: 1, snapshotDate: '2026-04-01', totalValue: 250000, source: SnapshotSource.MANUAL },
      ],
      isLoading: false, error: null,
    });
    // Wave 2: the FI-eligible selector needs a matching eligible account.
    useAccountsStore.setState({ accounts: [mkAccount(1)], isLoading: false, error: null });
    render(<CompoundInterestCard />);
    expect((screen.getByLabelText(/initial amount/i) as HTMLInputElement).value).toBe('250000');
  });

  it('initial-amount prefill drops excludedFromNetWorth accounts', () => {
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
    render(<CompoundInterestCard />);
    expect(
      (screen.getByLabelText(/initial amount/i) as HTMLInputElement).value,
    ).toBe('250000');
  });

  it('falls back to the 1000 demo default when there is no portfolio', () => {
    render(<CompoundInterestCard />); // snapshots empty (beforeEach) → currentPortfolio 0 → pv 1000
    expect((screen.getByLabelText(/initial amount/i) as HTMLInputElement).value).toBe('1000');
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
      settings: { defaultInflation: 0.025 } as unknown as AppSettings,
      isLoading: false,
      error: null,
    });
    const user = userEvent.setup();
    render(<CompoundInterestCard />); // defaults: pv 1000, pmt 100, 7% APY, 10y monthly, 2.5% inflation
    const headline = screen.getByTestId('compound-headline');
    // Nominal first (byte-identical to prior behaviour) — and no basis suffix.
    expect(headline.textContent).toContain('$19,072');
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
    useSettingsStore.setState({
      settings: { defaultInflation: 0.025 } as unknown as AppSettings,
      isLoading: false,
      error: null,
    });
    useHouseholdStore.setState({
      household: {
        filingStatus: 'SINGLE', state: 'CA', city: null, monthlyExpenseBaseline: 0,
        withdrawalRate: 0.04, inflationAssumption: 0.05, growthScenarios: [],
      } as unknown as Household,
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
