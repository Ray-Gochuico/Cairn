import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { PaycheckCard } from '@/pages/calculators/PaycheckCard';
import { useHouseholdStore } from '@/stores/household-store';
import { usePersonsStore } from '@/stores/persons-store';
import { useDependentsStore } from '@/stores/dependents-store';
import { useTaxRulesStore } from '@/stores/tax-rules-store';
import { FilingStatus } from '@/types/enums';
import { CONTRIBUTION_LIMITS_2026 } from '@/lib/contribution-limits';
import { aggregateHouseholdPretax } from '@/lib/calculators/supplemental-wage';

// Federal SINGLE brackets (2026 approximate) — same as the supplemental-pay suite
const federalSingleBrackets = [
  { min: 0,       max: 11925,  rate: 0.10 },
  { min: 11925,   max: 48475,  rate: 0.12 },
  { min: 48475,   max: 103350, rate: 0.22 },
  { min: 103350,  max: 197300, rate: 0.24 },
  { min: 197300,  max: 250525, rate: 0.32 },
  { min: 250525,  max: 626350, rate: 0.35 },
  { min: 626350,  max: null,   rate: 0.37 },
];

// CA SINGLE brackets (2026 approximate)
const caSingleBrackets = [
  { min: 0,       max: 10412,  rate: 0.01 },
  { min: 10412,   max: 24684,  rate: 0.02 },
  { min: 24684,   max: 38959,  rate: 0.04 },
  { min: 38959,   max: 54081,  rate: 0.06 },
  { min: 54081,   max: 68350,  rate: 0.08 },
  { min: 68350,   max: 349137, rate: 0.093 },
  { min: 349137,  max: 418961, rate: 0.103 },
  { min: 418961,  max: 698271, rate: 0.113 },
  { min: 698271,  max: null,   rate: 0.123 },
];

function resetStores() {
  useHouseholdStore.setState({ household: null, isLoading: false, error: null });
  usePersonsStore.setState({ persons: [], isLoading: false, error: null });
  useDependentsStore.setState({ dependents: [], isLoading: false, error: null });
  useTaxRulesStore.setState({ year: null, items: [], isLoading: false, error: null });
}

function primeStores() {
  useHouseholdStore.setState({
    household: {
      filingStatus: FilingStatus.SINGLE,
      state: 'CA',
      city: null,
      monthlyExpenseBaseline: 5000,
      withdrawalRate: 0.04,
      inflationAssumption: 0.03,
      growthScenarios: [],
    },
    isLoading: false,
    error: null,
  });

  usePersonsStore.setState({
    persons: [
      {
        id: 1,
        householdId: 1,
        name: 'Alice',
        dateOfBirth: '1990-01-01',
        targetRetirementAge: 65,
        annualSalaryPretax: 100000,
        expectedCommission: 0,
        expectedCommissionFrequency: 'MONTHLY',
        pretax401kPct: 0,
        healthInsuranceMonthlyPremium: 0,
        dependentCareFsaMonthly: 0,
        hsaMonthlyContribution: 0,
        hsaEligible: false,
      },
    ],
    isLoading: false,
    error: null,
  });

  useDependentsStore.setState({ dependents: [], isLoading: false, error: null });

  useTaxRulesStore.setState({
    year: 2026,
    items: [
      {
        id: 1,
        year: 2026,
        jurisdictionType: 'FEDERAL',
        jurisdictionCode: 'US',
        filingStatus: FilingStatus.SINGLE,
        brackets: federalSingleBrackets,
        standardDeduction: 15000,
      },
      {
        id: 2,
        year: 2026,
        jurisdictionType: 'STATE',
        jurisdictionCode: 'CA',
        filingStatus: FilingStatus.SINGLE,
        brackets: caSingleBrackets,
        standardDeduction: 0,
      },
    ],
    isLoading: false,
    error: null,
  });
}

// The wave-9 F1 two-earner fixture (dual $150k MFJ), extracted so the Wave-15
// "N earners, combined" qualifier tests reuse it instead of duplicating.
function primeStoresTwoEarners() {
  primeStores();
  useHouseholdStore.setState({
    household: {
      ...useHouseholdStore.getState().household!,
      filingStatus: FilingStatus.MFJ,
    },
    isLoading: false,
    error: null,
  });
  const alice = usePersonsStore.getState().persons[0];
  usePersonsStore.setState({
    persons: [
      { ...alice, id: 1, name: 'Alice', annualSalaryPretax: 150000, pretax401kPct: 0 },
      { ...alice, id: 2, name: 'Bob', annualSalaryPretax: 150000, pretax401kPct: 0 },
    ],
    isLoading: false,
    error: null,
  });
  const items = useTaxRulesStore.getState().items.map((i) => ({
    ...i,
    filingStatus: FilingStatus.MFJ,
  }));
  useTaxRulesStore.setState({ year: 2026, items, isLoading: false, error: null });
}

describe('PaycheckCard', () => {
  beforeEach(() => {
    resetStores();
  });

  it('the headline result region is a polite live region (W10 T8)', () => {
    primeStores();
    render(<MemoryRouter><PaycheckCard cardId="paycheck" /></MemoryRouter>);
    const region = screen.getByTestId('paycheck-headline');
    expect(region).toHaveAttribute('role', 'status');
  });

  it('renders monthly take-home by default for $100k CA SINGLE', async () => {
    primeStores();
    render(
      <MemoryRouter>
        <PaycheckCard />
      </MemoryRouter>,
    );

    const headline = await screen.findByTestId('paycheck-takehome');
    // T21: pin the EXACT monthly take-home AND the FICA + state rows so a
    // mutation to either withholding leg (or deleting a row) breaks the test —
    // the range assertion let those regress silently. Figures are the engine's
    // own output for this $100k CA SINGLE fixture.
    const monthlyValue = parseFloat(headline.textContent!.replace(/[$,]/g, ''));
    expect(monthlyValue).toBeCloseTo(6065, 0);

    // FICA is 7.65% of $100k = $7,650/yr → $638/mo. Deleting the FICA row (the
    // "stays green" mutation) removes this exact value from the breakdown.
    expect(screen.getByText('$638')).toBeInTheDocument();
    // The state-tax row value (CA on $100k) must be present too — pin it exact
    // so deleting/zeroing the state leg fails the test.
    const stateValue = parseFloat(
      (screen.getByText('Estimated state tax').nextElementSibling?.textContent ?? '').replace(/[$,]/g, ''),
    );
    expect(stateValue).toBeCloseTo(496, 0);
  });

  it('switches to bi-weekly when the period selector changes', async () => {
    const user = userEvent.setup();
    primeStores();
    render(
      <MemoryRouter>
        <PaycheckCard />
      </MemoryRouter>,
    );

    // Wave-18 A5: the period select is a Radix combobox now.
    await user.click(screen.getByRole('combobox', { name: /period/i }));
    await user.click(await screen.findByRole('option', { name: /^bi-weekly$/i }));
    const headline = screen.getByTestId('paycheck-takehome');
    const value = parseFloat(headline.textContent!.replace(/[$,]/g, ''));
    // T21: exact — same annual take-home spread over 26 pay periods.
    expect(value).toBeCloseTo(2799, 0);
  });

  it('still renders with stale (non-current) tax-rule year via getCurrentTaxYear fallback', async () => {
    // Seed household + person, but tax rules ONLY for 2025 (older than current
    // calendar year). The card's getCurrentTaxYear() resolver should pick 2025
    // as the most-recent seeded year and the lookup must still find the rules.
    useHouseholdStore.setState({
      household: {
        filingStatus: FilingStatus.SINGLE,
        state: 'CA',
        city: null,
        monthlyExpenseBaseline: 5000,
        withdrawalRate: 0.04,
        inflationAssumption: 0.03,
        growthScenarios: [],
      },
      isLoading: false,
      error: null,
    });
    usePersonsStore.setState({
      persons: [
        {
          id: 1,
          householdId: 1,
          name: 'Alice',
          dateOfBirth: '1990-01-01',
          targetRetirementAge: 65,
          annualSalaryPretax: 100000,
          expectedCommission: 0,
          expectedCommissionFrequency: 'MONTHLY',
          pretax401kPct: 0,
          healthInsuranceMonthlyPremium: 0,
          dependentCareFsaMonthly: 0,
          hsaMonthlyContribution: 0,
          hsaEligible: false,
        },
      ],
      isLoading: false,
      error: null,
    });
    useTaxRulesStore.setState({
      year: 2025,
      items: [
        {
          id: 1,
          year: 2025,
          jurisdictionType: 'FEDERAL',
          jurisdictionCode: 'US',
          filingStatus: FilingStatus.SINGLE,
          brackets: federalSingleBrackets,
          standardDeduction: 15000,
        },
        {
          id: 2,
          year: 2025,
          jurisdictionType: 'STATE',
          jurisdictionCode: 'CA',
          filingStatus: FilingStatus.SINGLE,
          brackets: caSingleBrackets,
          standardDeduction: 0,
        },
      ],
      isLoading: false,
      error: null,
    });

    render(<MemoryRouter><PaycheckCard /></MemoryRouter>);

    // Card renders the headline using the stale 2025 rules — no crash, no empty state.
    const headline = await screen.findByTestId('paycheck-takehome');
    const monthlyValue = parseFloat(headline.textContent!.replace(/[$,]/g, ''));
    expect(monthlyValue).toBeGreaterThan(5500);
    expect(monthlyValue).toBeLessThan(7000);
  });

  it('shows placeholder when no household is set', async () => {
    // Stores already reset — no household
    render(
      <MemoryRouter>
        <PaycheckCard />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Set up your household profile/i)).toBeInTheDocument();
  });

  it('empty-state CTA links to the destination it names (Wave 15 T10)', async () => {
    // Stores already reset — no household ⇒ empty state
    render(
      <MemoryRouter>
        <PaycheckCard />
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole('link', { name: /set up your household profile/i }),
    ).toHaveAttribute('href', '/inputs/household');
  });

  it('links to the full calculator page', async () => {
    primeStores();
    render(<MemoryRouter><PaycheckCard /></MemoryRouter>);
    const link = await screen.findByRole('link', { name: /open full calculator/i });
    expect(link).toHaveAttribute('href', '/calculators/paycheck');
  });

  it('household FICA caps Social Security per earner (wave-9 F1)', async () => {
    // Dual $150k: SS = 2 × 150k × 6.2% = $18,600; Medicare 300k × 1.45% =
    // $4,350; AddMed MFJ over 250k = $450 → FICA $23,400. The combined-base
    // bug showed min(300k, 184.5k) × 6.2% + medicare = $16,239.
    const user = userEvent.setup();
    primeStoresTwoEarners();

    render(<MemoryRouter><PaycheckCard /></MemoryRouter>);
    await screen.findByTestId('paycheck-takehome');
    // Annual period so the FICA row shows the yearly figure verbatim.
    await user.click(screen.getByRole('combobox', { name: /period/i }));
    await user.click(await screen.findByRole('option', { name: /^annual$/i }));
    expect(screen.getByText('$23,400')).toBeInTheDocument();
    expect(screen.queryByText('$16,239')).not.toBeInTheDocument();
  });

  it('dual-earner DCFSA/HSA cap once per return on the paycheck card (round-3 M1)', async () => {
    // Two MFJ earners, each electing $400/mo DCFSA + $500/mo HSA (eligible).
    // Household pretax must carry DCFSA $7,500 (not $9,600) and HSA $8,750
    // (not $12,000). Assert via the lib oracle so the caps stay exact.
    const user = userEvent.setup();
    primeStores();
    useHouseholdStore.setState({
      household: {
        ...useHouseholdStore.getState().household!,
        filingStatus: FilingStatus.MFJ,
      },
      isLoading: false,
      error: null,
    });
    const alice = usePersonsStore.getState().persons[0];
    const personsFixture = [
      { ...alice, id: 1, name: 'Alice', dependentCareFsaMonthly: 400, hsaMonthlyContribution: 500, hsaEligible: true },
      { ...alice, id: 2, name: 'Bob', dependentCareFsaMonthly: 400, hsaMonthlyContribution: 500, hsaEligible: true },
    ];
    usePersonsStore.setState({ persons: personsFixture, isLoading: false, error: null });
    useDependentsStore.setState({
      dependents: [{ id: 1, householdId: 1, name: 'Kid', dateOfBirth: '2020-01-01' }] as never,
      isLoading: false,
      error: null,
    });
    const items = useTaxRulesStore.getState().items.map((i) => ({
      ...i,
      filingStatus: FilingStatus.MFJ,
    }));
    useTaxRulesStore.setState({ year: 2026, items, isLoading: false, error: null });

    const expected = aggregateHouseholdPretax(personsFixture as never, {
      filingStatus: FilingStatus.MFJ,
      personCount: 2,
      dependentCount: 1,
    });
    expect(expected.pretax.pretaxDcfsa).toBe(7_500); // sanity: the fixture bites
    expect(expected.pretax.pretaxHsa).toBe(8_750);

    render(<MemoryRouter><PaycheckCard /></MemoryRouter>);
    await screen.findByTestId('paycheck-takehome');
    // Annual period so the pretax rows show the yearly caps verbatim.
    await user.click(screen.getByRole('combobox', { name: /period/i }));
    await user.click(await screen.findByRole('option', { name: /^annual$/i }));
    expect(screen.getByText('$7,500')).toBeInTheDocument();
    expect(screen.getByText('$8,750')).toBeInTheDocument();
    expect(screen.queryByText('$9,600')).not.toBeInTheDocument();
    expect(screen.queryByText('$12,000')).not.toBeInTheDocument();
  });

  it('disclosure copy cites the live SS wage base, not the stale $168,600, and does not falsely disclaim Additional Medicare', async () => {
    primeStores();
    render(<MemoryRouter><PaycheckCard /></MemoryRouter>);
    await screen.findByTestId('paycheck-takehome');
    const wageBase = new RegExp(
      `\\$${CONTRIBUTION_LIMITS_2026.SOCIAL_SECURITY_WAGE_BASE.toLocaleString('en-US')}`,
    );
    expect(screen.getByText(wageBase, { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(/168,600/)).not.toBeInTheDocument();
    // Additional Medicare IS modeled (tax.ts) — it must not appear in the "not modeled" list.
    expect(screen.queryByText(/Additional Medicare/)).not.toBeInTheDocument();
  });

  it('headline carries the display-period unit (Wave 15: never a bare number)', async () => {
    primeStores();
    render(<MemoryRouter><PaycheckCard /></MemoryRouter>);
    const headline = await screen.findByTestId('paycheck-takehome');
    expect(headline.textContent).toMatch(/\/\s*monthly/i); // default period MONTHLY
  });

  it('shows the "N earners, combined" qualifier only for multi-person households', async () => {
    primeStoresTwoEarners(); // the wave-9 F1 two-earner fixture, extracted above
    render(<MemoryRouter><PaycheckCard /></MemoryRouter>);
    await screen.findByTestId('paycheck-takehome');
    expect(screen.getByText(/2 earners, combined/i)).toBeInTheDocument();
  });

  it('single-earner household shows NO combined qualifier', async () => {
    primeStores();
    render(<MemoryRouter><PaycheckCard /></MemoryRouter>);
    await screen.findByTestId('paycheck-takehome');
    expect(screen.queryByText(/earners, combined/i)).not.toBeInTheDocument();
  });

  it('hourly + salaried household shows NO combined qualifier — hourly pay is not summed (Wave 15 review)', async () => {
    // HOURLY persons persist annualSalaryPretax = 0 (their pay isn't salary),
    // so the headline is Alice's salary alone: captioning it "2 earners,
    // combined" would be false.
    primeStoresTwoEarners();
    const [alice, bob] = usePersonsStore.getState().persons;
    usePersonsStore.setState({
      persons: [
        alice,
        { ...bob, annualSalaryPretax: 0, employmentType: 'HOURLY', hourlyRate: 30 },
      ],
      isLoading: false,
      error: null,
    });
    render(<MemoryRouter><PaycheckCard /></MemoryRouter>);
    await screen.findByTestId('paycheck-takehome');
    expect(screen.queryByText(/earners, combined/i)).not.toBeInTheDocument();
    // The NOT-modeled disclosure names the exclusion.
    expect(
      screen.getByText(/hourly earner's pay is not included/i),
    ).toBeInTheDocument();
  });

  it('salaried + non-earning household member shows NO combined qualifier', async () => {
    primeStoresTwoEarners();
    const [alice, bob] = usePersonsStore.getState().persons;
    usePersonsStore.setState({
      persons: [alice, { ...bob, annualSalaryPretax: 0 }],
      isLoading: false,
      error: null,
    });
    render(<MemoryRouter><PaycheckCard /></MemoryRouter>);
    await screen.findByTestId('paycheck-takehome');
    expect(screen.queryByText(/earners, combined/i)).not.toBeInTheDocument();
  });

  it('caption counts salaried earners only and flags salary-only scope when a non-salaried person exists', async () => {
    // Two salaried + one hourly: the caption must count the two people whose
    // salary is actually in the headline, and say so.
    primeStoresTwoEarners();
    const [alice, bob] = usePersonsStore.getState().persons;
    usePersonsStore.setState({
      persons: [
        alice,
        bob,
        { ...bob, id: 3, name: 'Cam', annualSalaryPretax: 0, employmentType: 'HOURLY', hourlyRate: 30 },
      ],
      isLoading: false,
      error: null,
    });
    render(<MemoryRouter><PaycheckCard /></MemoryRouter>);
    await screen.findByTestId('paycheck-takehome');
    expect(
      screen.getByText(/2 earners, combined — salary only/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/3 earners/i)).not.toBeInTheDocument();
  });

  it('federal row carries the withholding-vs-liability caveat the full page has', async () => {
    primeStores();
    render(<MemoryRouter><PaycheckCard /></MemoryRouter>);
    await screen.findByTestId('paycheck-takehome');
    expect(screen.getByText(/annualized estimate, not payroll withholding/i)).toBeInTheDocument();
  });
});

describe('PaycheckCard Combined | per-person view (Wave 18 D16)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetStores();
  });

  it('single-person household renders no earner picker', async () => {
    primeStores();
    render(<MemoryRouter><PaycheckCard cardId="paycheck" /></MemoryRouter>);
    await screen.findByTestId('paycheck-takehome');
    expect(screen.queryByRole('group', { name: /paycheck view/i })).not.toBeInTheDocument();
  });

  it('two-person household renders Combined + one segment per person, Combined default', async () => {
    primeStoresTwoEarners();
    render(<MemoryRouter><PaycheckCard cardId="paycheck" /></MemoryRouter>);
    await screen.findByTestId('paycheck-takehome');
    const group = screen.getByRole('group', { name: /paycheck view/i });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Combined' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Alice' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Bob' })).toHaveAttribute('aria-pressed', 'false');
  });

  it("per-person view shows the person's own gross and the engine's marginal per-earner FICA", async () => {
    // Dual $150k MFJ, no pretax. Bob's marginal FICA (with/without his salary,
    // per-earner wage bases): SS 150k × 6.2% = $9,300 + Medicare 150k × 1.45%
    // = $2,175 + Additional Medicare (300k − 250k) × 0.9% = $450 → $11,925/yr.
    const user = userEvent.setup();
    primeStoresTwoEarners();
    render(<MemoryRouter><PaycheckCard cardId="paycheck" /></MemoryRouter>);
    await screen.findByTestId('paycheck-takehome');
    await user.click(screen.getByRole('combobox', { name: /period/i }));
    await user.click(await screen.findByRole('option', { name: /^annual$/i }));
    await user.click(screen.getByRole('button', { name: 'Bob' }));

    // Bob's own gross (not the household's $300k).
    expect(screen.getByText('$150,000')).toBeInTheDocument();
    // The engine's marginal per-earner FICA figure.
    expect(screen.getByText('$11,925')).toBeInTheDocument();
    // The D16 estimate label.
    expect(
      screen.getByText(/marginal share attributed to Bob's pay/i),
    ).toBeInTheDocument();
  });

  it("review fix 2: per-person federal stays BELOW the household federal when the person has a 401(k) election (difference method carries full pretax on both legs)", async () => {
    const user = userEvent.setup();
    primeStoresTwoEarners();
    // Alice $60k / Bob $200k with a 12% 401(k) ($24k deferral). Pre-fix the
    // with-leg dropped Bob's own pretax: on these MFJ brackets (SD $30k) the
    // buggy diff is federal($230k taxable) − federal($30k taxable) =
    // $50,663 − $3,362 = $47,302 — ABOVE the household's true federal
    // ($206k taxable → $42,983). The difference method with full pretax on
    // the with-leg yields $42,983 − $3,362 = $39,622 < household.
    const [alice, bob] = usePersonsStore.getState().persons;
    usePersonsStore.setState({
      persons: [
        { ...alice, annualSalaryPretax: 60000 },
        { ...bob, annualSalaryPretax: 200000, pretax401kPct: 0.12 },
      ],
      isLoading: false,
      error: null,
    });
    render(<MemoryRouter><PaycheckCard cardId="paycheck" /></MemoryRouter>);
    await screen.findByTestId('paycheck-takehome');
    await user.click(screen.getByRole('combobox', { name: /period/i }));
    await user.click(await screen.findByRole('option', { name: /^annual$/i }));

    const readFederal = () =>
      parseFloat(
        (screen
          .getByText(/Estimated federal tax/)
          .closest('div')!
          .parentElement!.querySelector('.tabular-nums')!.textContent ?? '')
          .replace(/[$,]/g, ''),
      );
    const combinedFederal = readFederal();
    await user.click(screen.getByRole('button', { name: 'Bob' }));
    const perPersonFederal = readFederal();
    expect(perPersonFederal).toBeGreaterThan(0);
    expect(perPersonFederal).toBeLessThan(combinedFederal);
  });

  it('headline stays the Combined take-home in the per-person view', async () => {
    const user = userEvent.setup();
    primeStoresTwoEarners();
    render(<MemoryRouter><PaycheckCard cardId="paycheck" /></MemoryRouter>);
    const headline = await screen.findByTestId('paycheck-takehome');
    const combined = headline.textContent;
    await user.click(screen.getByRole('button', { name: 'Bob' }));
    expect(screen.getByTestId('paycheck-takehome').textContent).toBe(combined);
  });

  it('Combined view stays byte-identical after switching away and back', async () => {
    const user = userEvent.setup();
    primeStoresTwoEarners();
    render(<MemoryRouter><PaycheckCard cardId="paycheck" /></MemoryRouter>);
    await screen.findByTestId('paycheck-takehome');
    const combinedFica = screen.getByText('$1,950'); // 23,400 / 12 monthly
    expect(combinedFica).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Bob' }));
    await user.click(screen.getByRole('button', { name: 'Combined' }));
    expect(screen.getByText('$1,950')).toBeInTheDocument();
    expect(screen.queryByText(/marginal share attributed/i)).not.toBeInTheDocument();
  });
});

describe('PaycheckCard — D7 salary ripple (Wave 18)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetStores();
  });

  it('a bar salary override moves the take-home; the persons store is untouched', async () => {
    const { __resetScenarioAssumptionsForTests } = await import(
      '@/lib/calculators/use-scenario-assumptions'
    );
    primeStores(); // Alice $100k
    __resetScenarioAssumptionsForTests();
    const { unmount } = render(<MemoryRouter><PaycheckCard cardId="paycheck" /></MemoryRouter>);
    const baseline = (await screen.findByTestId('paycheck-takehome')).textContent;
    unmount();

    sessionStorage.setItem('calc-scenario:salaries', JSON.stringify({ 1: 150000 }));
    __resetScenarioAssumptionsForTests();
    render(<MemoryRouter><PaycheckCard cardId="paycheck" /></MemoryRouter>);
    const overridden = (await screen.findByTestId('paycheck-takehome')).textContent;
    expect(overridden).not.toBe(baseline);
    // Scenario-layer only (constraint 5): the store keeps the real salary.
    expect(usePersonsStore.getState().persons[0].annualSalaryPretax).toBe(100000);
    // D6: the override raises the scenario tick.
    expect(screen.getByTestId('paycheck-scenario-tick')).toBeInTheDocument();
    // Clean the module-level salary cache for later tests.
    sessionStorage.removeItem('calc-scenario:salaries');
    __resetScenarioAssumptionsForTests();
  });
});

describe('PaycheckCard waymark meaning (Wave 17)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetStores();
  });

  it('renders the waymark meaning line from already-rendered values (Wave 17)', () => {
    primeStores();
    render(<MemoryRouter><PaycheckCard cardId="paycheck" /></MemoryRouter>);
    expect(screen.getByTestId('paycheck-meaning')).toHaveTextContent(
      /after taxes and pretax deductions on .* gross/i,
    );
  });

  it('empty state: headline —, cairn glyph, CTA sentence in the meaning slot', () => {
    // No stores primed → no household → empty waymark.
    render(<MemoryRouter><PaycheckCard cardId="paycheck" /></MemoryRouter>);
    expect(screen.getByTestId('paycheck-headline')).toHaveTextContent('—');
    expect(document.querySelector('[data-testid="cairn-glyph"]')).toBeInTheDocument();
    expect(screen.getByTestId('paycheck-meaning')).toHaveTextContent(
      /set up your household profile \+ tax rules to see take-home/i,
    );
  });
});
