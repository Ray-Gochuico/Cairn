import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import PaycheckCalculator from '@/pages/calculators/PaycheckCalculator';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { FilingStatus } from '@/types/enums';

const federalSingleBrackets = [
  { min: 0,       max: 11925,  rate: 0.10 },
  { min: 11925,   max: 48475,  rate: 0.12 },
  { min: 48475,   max: 103350, rate: 0.22 },
  { min: 103350,  max: 197300, rate: 0.24 },
  { min: 197300,  max: 250525, rate: 0.32 },
  { min: 250525,  max: 626350, rate: 0.35 },
  { min: 626350,  max: null,   rate: 0.37 },
];
const caSingleBrackets = [
  { min: 0,       max: 10412,  rate: 0.01 },
  { min: 10412,   max: 24684,  rate: 0.02 },
  { min: 24684,   max: 38959,  rate: 0.04 },
  { min: 38959,   max: 54081,  rate: 0.06 },
  { min: 54081,   max: 68350,  rate: 0.08 },
  { min: 68350,   max: 349137, rate: 0.093 },
  { min: 349137,  max: null,   rate: 0.103 },
];

function resetStores() {
  useHouseholdStore.setState({ household: null, isLoading: false, error: null });
  usePersonsStore.setState({ persons: [], isLoading: false, error: null });
  useDependentsStore.setState({ dependents: [], isLoading: false, error: null });
  useTaxRulesStore.setState({ year: null, items: [], isLoading: false, error: null });
}

function primeStores(opts?: { state?: string; salary?: number }) {
  const state = opts?.state ?? 'CA';
  useHouseholdStore.setState({
    household: {
      filingStatus: FilingStatus.SINGLE, state, city: null,
      monthlyExpenseBaseline: 5000, withdrawalRate: 0.04, inflationAssumption: 0.03,
      growthScenarios: [],
    },
    isLoading: false, error: null,
  });
  usePersonsStore.setState({
    persons: [{
      id: 1, householdId: 1, name: 'Alice', dateOfBirth: '1990-01-01', targetRetirementAge: 65,
      annualSalaryPretax: opts?.salary ?? 100000, expectedCommission: 0,
      expectedCommissionFrequency: 'MONTHLY', pretax401kPct: 0,
      healthInsuranceMonthlyPremium: 0, dependentCareFsaMonthly: 0,
      hsaMonthlyContribution: 0, hsaEligible: false,
    }],
    isLoading: false, error: null,
  });
  useDependentsStore.setState({ dependents: [], isLoading: false, error: null });
  useTaxRulesStore.setState({
    year: 2026,
    items: [
      { id: 1, year: 2026, jurisdictionType: 'FEDERAL', jurisdictionCode: 'US',
        filingStatus: FilingStatus.SINGLE, brackets: federalSingleBrackets, standardDeduction: 15000 },
      // CA SINGLE — present so a CA scenario computes; absent state codes (TX) test the no-tax guard.
      { id: 2, year: 2026, jurisdictionType: 'STATE', jurisdictionCode: 'CA',
        filingStatus: FilingStatus.SINGLE, brackets: caSingleBrackets, standardDeduction: 0 },
      // TX SINGLE — seeded the way 0002_seed_tax_rules.sql ACTUALLY stores a
      // no-income-tax state: a single ZERO-RATE bracket, NOT empty brackets
      // (the schema's TaxRuleSchema.brackets even requires .min(1), so an
      // empty-brackets row can never persist). The page must detect "no state
      // tax" from the zero rate, not from list length.
      { id: 3, year: 2026, jurisdictionType: 'STATE', jurisdictionCode: 'TX',
        filingStatus: FilingStatus.SINGLE, brackets: [{ min: 0, max: null, rate: 0 }], standardDeduction: 0 },
    ],
    isLoading: false, error: null,
  });
}

describe('PaycheckCalculator', () => {
  beforeEach(() => { resetStores(); });

  it('renders a seeded take-home for $100k CA SINGLE', async () => {
    primeStores();
    render(<MemoryRouter><PaycheckCalculator /></MemoryRouter>);
    const headline = await screen.findByTestId('paycheck-calc-takehome');
    const monthly = parseFloat(headline.textContent!.replace(/[$,]/g, ''));
    // ~$73k annual take-home / 12 ≈ $6,092
    expect(monthly).toBeGreaterThan(5500);
    expect(monthly).toBeLessThan(7000);
  });

  it('shows separate Social Security and Medicare rows', async () => {
    primeStores();
    render(<MemoryRouter><PaycheckCalculator /></MemoryRouter>);
    expect(await screen.findByText('Social Security')).toBeInTheDocument();
    expect(screen.getByText('Medicare')).toBeInTheDocument();
  });

  it('lowers take-home when extra federal withholding is entered', async () => {
    const user = userEvent.setup();
    primeStores();
    render(<MemoryRouter><PaycheckCalculator /></MemoryRouter>);
    const before = parseFloat(
      (await screen.findByTestId('paycheck-calc-takehome')).textContent!.replace(/[$,]/g, ''),
    );
    const extra = screen.getByLabelText(/Extra federal withholding/i);
    await user.clear(extra);
    await user.type(extra, '500'); // $500/paycheck × 12 (annual default) = $6,000/yr
    const after = parseFloat(
      screen.getByTestId('paycheck-calc-takehome').textContent!.replace(/[$,]/g, ''),
    );
    expect(after).toBeLessThan(before);
  });

  it('shows "(no state income tax)" for a no-tax state', async () => {
    const user = userEvent.setup();
    primeStores();
    render(<MemoryRouter><PaycheckCalculator /></MemoryRouter>);
    await screen.findByTestId('paycheck-calc-takehome');
    const stateInput = screen.getByLabelText('State');
    await user.clear(stateInput);
    await user.type(stateInput, 'TX');
    expect(await screen.findByText(/no state income tax/i)).toBeInTheDocument();
  });

  it('renders the no-allowances explainer note and no allowances input', async () => {
    primeStores();
    render(<MemoryRouter><PaycheckCalculator /></MemoryRouter>);
    await screen.findByTestId('paycheck-calc-takehome');
    expect(screen.getByText(/No allowances field/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/allowance/i)).toBeNull();
  });

  it('shows the empty-state CTA when no household is set', async () => {
    render(<MemoryRouter><PaycheckCalculator /></MemoryRouter>);
    expect(await screen.findByTestId('paycheck-calc-empty')).toBeInTheDocument();
    expect(screen.getByText(/Add a person and set up your household/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /add a person/i })).toHaveAttribute(
      'href',
      '/inputs/persons',
    );
  });

  // PC-2: a household WITHOUT persons must NOT render a misleading "$0 / month,
  // 0.0% of gross" result — brackets are seeded so `result` is non-null, but the
  // panel must show the "Add a person" empty-state instead.
  it('shows the empty-state (not a $0 result) for a household with no persons', async () => {
    primeStores();
    // Strip persons but keep the seeded household + tax rules.
    usePersonsStore.setState({ persons: [], isLoading: false, error: null });
    render(<MemoryRouter><PaycheckCalculator /></MemoryRouter>);
    expect(await screen.findByTestId('paycheck-calc-empty')).toBeInTheDocument();
    // The take-home headline must be ABSENT (no misleading $0).
    expect(screen.queryByTestId('paycheck-calc-takehome')).toBeNull();
  });

  // PC-1 guard — the RHF `values`-prop pattern + `resetOptions:{keepDirtyValues:true}`
  // must (a) PRESERVE a field the user is editing AND (b) still apply the new
  // seed to UNtouched fields when a late store hydration changes `values`.
  //
  // The settle MUST deliver DEEP-DIFFERENT data, or the test proves nothing:
  // RHF's `values` effect skips `_reset` entirely when the new seed deep-equals
  // the prior one (`!U(values, prev)`), so an identical-data "settle" would let
  // the typed value survive REGARDLESS of `keepDirtyValues` (the prior version
  // of this test passed for that wrong reason). Here we render with
  // household+tax-rules but NO persons (so the initial `values` has
  // `grossAnnual:0`, `pretax401kPct:0`), type a divergent gross, THEN hydrate
  // `persons` with a real salary + a 10% 401(k) — a deep-different `values`
  // object that fires `_reset`. Without `keepDirtyValues`, gross would be
  // overwritten to the seeded salary and this test goes RED.
  it('preserves a dirty field but re-seeds untouched fields on a late, data-changing store settle', async () => {
    const user = userEvent.setup();
    resetStores();
    // Prime household + tax rules ONLY — leave persons empty so the first
    // `values` is { grossAnnual: 0, pretax401kPct: 0, … }. (The left input card
    // still renders; only the right results panel shows the empty-state.)
    useHouseholdStore.setState({
      household: {
        filingStatus: FilingStatus.SINGLE, state: 'CA', city: null,
        monthlyExpenseBaseline: 5000, withdrawalRate: 0.04, inflationAssumption: 0.03,
        growthScenarios: [],
      },
      isLoading: false, error: null,
    });
    usePersonsStore.setState({ persons: [], isLoading: false, error: null });
    useDependentsStore.setState({ dependents: [], isLoading: false, error: null });
    useTaxRulesStore.setState({
      year: 2026,
      items: [
        { id: 1, year: 2026, jurisdictionType: 'FEDERAL', jurisdictionCode: 'US',
          filingStatus: FilingStatus.SINGLE, brackets: federalSingleBrackets, standardDeduction: 15000 },
        { id: 2, year: 2026, jurisdictionType: 'STATE', jurisdictionCode: 'CA',
          filingStatus: FilingStatus.SINGLE, brackets: caSingleBrackets, standardDeduction: 0 },
      ],
      isLoading: false, error: null,
    });

    render(<MemoryRouter><PaycheckCalculator /></MemoryRouter>);

    // The form inputs render immediately (household is truthy). Type a gross
    // that diverges from the (about-to-arrive) seeded salary, marking it dirty.
    const gross = await screen.findByLabelText(/Gross pay/i);
    await user.clear(gross);
    await user.type(gross, '150000');
    expect((gross as HTMLInputElement).value).toBe('150000');

    // The 401(k) field is UNtouched; it currently shows the no-person default 0.
    // NOTE: the pretax 401(k) <Label> wraps the term in a <TermTooltip> <button>,
    // so Testing Library strips that text from the LABEL's accessible name. The
    // a11y fix (UX #2) gives the input an explicit aria-label
    // ("Pre-tax 401(k) contribution (% of gross)"), which IS its accessible name,
    // so we can query it by that name. We match the full "Pre-tax 401(k)
    // contribution" phrase (NOT a bare /401\(k\)/i, which would also match the
    // *Roth* 401(k) field) to keep the query unambiguous.
    const k401 = screen.getByLabelText(/Pre-tax 401\(k\) contribution/i) as HTMLInputElement;
    expect(k401.value).toBe('0');

    // Late, DATA-CHANGING settle: persons hydrates with a real salary + 10%
    // 401(k). `values` recomputes deep-different → RHF runs `_reset`.
    await act(async () => {
      usePersonsStore.setState({
        persons: [{
          id: 1, householdId: 1, name: 'Alice', dateOfBirth: '1990-01-01', targetRetirementAge: 65,
          annualSalaryPretax: 120000, expectedCommission: 0, expectedCommissionFrequency: 'MONTHLY',
          pretax401kPct: 0.10, healthInsuranceMonthlyPremium: 0, dependentCareFsaMonthly: 0,
          hsaMonthlyContribution: 0, hsaEligible: false,
        }],
        isLoading: false, error: null,
      });
    });

    // (a) The user's dirty gross survives — NOT reset to the seeded $120,000.
    //     This is the assertion that goes RED without keepDirtyValues.
    expect((screen.getByLabelText(/Gross pay/i) as HTMLInputElement).value).toBe('150000');
    // (b) The untouched pretax 401(k) field picks up the new seed (0 → 10).
    //     Queried by its aria-label (see note above): this confirms untouched
    //     fields DO re-seed (it would go RED without keepDirtyValues only if it
    //     were the dirty field).
    expect((screen.getByLabelText(/Pre-tax 401\(k\) contribution/i) as HTMLInputElement).value).toBe('10');
  });

  // M5b — "Reset to my data" reverts a deliberately-edited field back to the
  // seeded profile. Distinct from the PC-1 guard above (that proves an edit
  // SURVIVES a late hydration); this proves the user can INTENTIONALLY throw the
  // edit away. The button is disabled until the form is dirty, so we assert it
  // enables after typing, then that the click restores the seed.
  it('reverts edits to the seeded profile when "Reset to my data" is clicked', async () => {
    const user = userEvent.setup();
    primeStores(); // seeds gross $100,000 (Alice's salary)
    render(<MemoryRouter><PaycheckCalculator /></MemoryRouter>);
    await screen.findByTestId('paycheck-calc-takehome');

    const reset = screen.getByRole('button', { name: /reset to my data/i });
    // Pristine: nothing to revert → disabled.
    expect(reset).toBeDisabled();

    const gross = screen.getByLabelText(/Gross pay/i) as HTMLInputElement;
    await user.clear(gross);
    await user.type(gross, '250000');
    expect(gross.value).toBe('250000');
    // Now dirty → the revert is offered.
    expect(reset).toBeEnabled();

    await user.click(reset);
    // Snaps back to the seeded salary (and the form is pristine again).
    expect((screen.getByLabelText(/Gross pay/i) as HTMLInputElement).value).toBe('100000');
    expect(screen.getByRole('button', { name: /reset to my data/i })).toBeDisabled();
  });

  // Multi-earner seed (spec §4 "Defaults seeding" + §10 item 1): the form opens
  // with the SUM of all persons' salaries and SUMMED pre-tax (401(k) % blended by
  // salary), NOT persons[0] alone — so a two-earner household's seed matches the
  // dashboard card instead of under-counting the second earner. Regression guard:
  // it goes RED if the seed reverts to a `persons[0]`-only default.
  it('seeds from the SUM of all persons (combined salary + salary-blended 401k%), not persons[0]', async () => {
    useHouseholdStore.setState({
      household: {
        filingStatus: FilingStatus.SINGLE, state: 'CA', city: null,
        monthlyExpenseBaseline: 5000, withdrawalRate: 0.04, inflationAssumption: 0.03,
        growthScenarios: [],
      },
      isLoading: false, error: null,
    });
    usePersonsStore.setState({
      persons: [
        { id: 1, householdId: 1, name: 'Alice', dateOfBirth: '1990-01-01', targetRetirementAge: 65,
          annualSalaryPretax: 100000, expectedCommission: 0, expectedCommissionFrequency: 'MONTHLY',
          pretax401kPct: 0.10, healthInsuranceMonthlyPremium: 400, dependentCareFsaMonthly: 0,
          hsaMonthlyContribution: 300, hsaEligible: true },
        { id: 2, householdId: 1, name: 'Bob', dateOfBirth: '1988-01-01', targetRetirementAge: 65,
          annualSalaryPretax: 50000, expectedCommission: 0, expectedCommissionFrequency: 'MONTHLY',
          pretax401kPct: 0.04, healthInsuranceMonthlyPremium: 200, dependentCareFsaMonthly: 0,
          hsaMonthlyContribution: 0, hsaEligible: false },
      ],
      isLoading: false, error: null,
    });
    useDependentsStore.setState({ dependents: [], isLoading: false, error: null });
    useTaxRulesStore.setState({
      year: 2026,
      items: [
        { id: 1, year: 2026, jurisdictionType: 'FEDERAL', jurisdictionCode: 'US',
          filingStatus: FilingStatus.SINGLE, brackets: federalSingleBrackets, standardDeduction: 15000 },
        { id: 2, year: 2026, jurisdictionType: 'STATE', jurisdictionCode: 'CA',
          filingStatus: FilingStatus.SINGLE, brackets: caSingleBrackets, standardDeduction: 0 },
      ],
      isLoading: false, error: null,
    });
    render(<MemoryRouter><PaycheckCalculator /></MemoryRouter>);

    // Gross = 100,000 + 50,000 (SUM) — NOT 100,000 from persons[0].
    expect((await screen.findByLabelText(/Gross pay/i) as HTMLInputElement).value).toBe('150000');
    // 401(k) %: salary-blended (0.10·100k + 0.04·50k) / 150k = 8% — NOT Alice's 10%.
    expect((screen.getByLabelText(/Pre-tax 401\(k\) contribution/i) as HTMLInputElement).value).toBe('8');
    // Health premium: 400 + 200 = 600/mo (summed across both earners).
    expect((screen.getByLabelText(/Health premium/i) as HTMLInputElement).value).toBe('600');
  });

  // DCFSA carry-through (spec §4 default source): the page has no dependent-care
  // FSA input, but a profile DCFSA election is pre-tax and must lower take-home
  // — proving it's no longer hardcoded to 0. Same $120k SINGLE profile rendered
  // with and without a $400/mo DCFSA; the FSA election reduces net pay.
  it('carries dependent-care FSA from the profile into take-home (no longer dropped)', async () => {
    const household = {
      filingStatus: FilingStatus.SINGLE, state: 'CA', city: null,
      monthlyExpenseBaseline: 5000, withdrawalRate: 0.04, inflationAssumption: 0.03,
      growthScenarios: [],
    };
    const taxRules = {
      year: 2026,
      items: [
        { id: 1, year: 2026, jurisdictionType: 'FEDERAL', jurisdictionCode: 'US',
          filingStatus: FilingStatus.SINGLE, brackets: federalSingleBrackets, standardDeduction: 15000 },
        { id: 2, year: 2026, jurisdictionType: 'STATE', jurisdictionCode: 'CA',
          filingStatus: FilingStatus.SINGLE, brackets: caSingleBrackets, standardDeduction: 0 },
      ],
      isLoading: false, error: null,
    };
    const personWith = (dcfsaMonthly: number) => ({
      id: 1, householdId: 1, name: 'Alice', dateOfBirth: '1990-01-01', targetRetirementAge: 65,
      annualSalaryPretax: 120000, expectedCommission: 0, expectedCommissionFrequency: 'MONTHLY',
      pretax401kPct: 0, healthInsuranceMonthlyPremium: 0, dependentCareFsaMonthly: dcfsaMonthly,
      hsaMonthlyContribution: 0, hsaEligible: false,
    });
    const readTakeHome = async () =>
      parseFloat((await screen.findByTestId('paycheck-calc-takehome')).textContent!.replace(/[$,]/g, ''));

    // No DCFSA.
    useHouseholdStore.setState({ household, isLoading: false, error: null });
    usePersonsStore.setState({ persons: [personWith(0)], isLoading: false, error: null });
    useDependentsStore.setState({ dependents: [], isLoading: false, error: null });
    useTaxRulesStore.setState(taxRules);
    const { unmount } = render(<MemoryRouter><PaycheckCalculator /></MemoryRouter>);
    const withoutDcfsa = await readTakeHome();
    unmount();

    // With a $400/mo ($4,800/yr) dependent-care FSA.
    usePersonsStore.setState({ persons: [personWith(400)], isLoading: false, error: null });
    render(<MemoryRouter><PaycheckCalculator /></MemoryRouter>);
    const withDcfsa = await readTakeHome();

    expect(withDcfsa).toBeLessThan(withoutDcfsa);
  });
});
